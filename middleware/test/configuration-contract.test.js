const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..', '..');
const manifestDirectories = [
    path.join(repoRoot, 'network', 'k8s'),
    path.join(repoRoot, 'monitoring')
];

function loadResources() {
    const resources = [];
    for (const directory of manifestDirectories) {
        for (const name of fs.readdirSync(directory)) {
            if (!name.endsWith('.yaml')) continue;
            const source = fs.readFileSync(path.join(directory, name), 'utf8');
            yaml.loadAll(source, (document) => {
                if (document?.kind && document?.metadata?.name) {
                    resources.push({ ...document, __file: path.join(directory, name) });
                }
            });
        }
    }
    return resources;
}

const resources = loadResources();
const resourceKey = (resource) => `${resource.metadata.namespace || 'default'}/${resource.kind}/${resource.metadata.name}`;
const byKey = new Map(resources.map((resource) => [resourceKey(resource), resource]));

function workloadLabels(resource) {
    if (!['Deployment', 'StatefulSet', 'DaemonSet'].includes(resource.kind)) return null;
    return resource.spec?.template?.metadata?.labels || {};
}

function selectorMatches(labels, selector = {}) {
    return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function matchingWorkloads(service) {
    const namespace = service.metadata.namespace || 'default';
    return resources.filter((resource) =>
        (resource.metadata.namespace || 'default') === namespace &&
        workloadLabels(resource) &&
        selectorMatches(workloadLabels(resource), service.spec.selector)
    );
}

function containerPorts(workload) {
    return (workload.spec?.template?.spec?.containers || [])
        .flatMap((container) => container.ports || []);
}

test('every Kubernetes Service selects a workload and exposes a real container port', () => {
    for (const service of resources.filter((resource) => resource.kind === 'Service' && resource.spec?.selector)) {
        const workloads = matchingWorkloads(service);
        assert.ok(workloads.length > 0, `${resourceKey(service)} does not select any declared workload`);
        for (const servicePort of service.spec.ports || []) {
            const targetPort = servicePort.targetPort ?? servicePort.port;
            const matchesPort = workloads.some((workload) => containerPorts(workload).some((port) =>
                typeof targetPort === 'number'
                    ? port.containerPort === targetPort
                    : port.name === targetPort
            ));
            assert.ok(matchesPort, `${resourceKey(service)} targetPort ${targetPort} is not declared by its workload`);
        }
    }
});

test('every Ingress backend references an existing Service port', () => {
    for (const ingress of resources.filter((resource) => resource.kind === 'Ingress')) {
        const namespace = ingress.metadata.namespace || 'default';
        const paths = (ingress.spec?.rules || []).flatMap((rule) => rule.http?.paths || []);
        for (const route of paths) {
            const backend = route.backend?.service;
            assert.ok(backend, `${resourceKey(ingress)} route ${route.path} has no service backend`);
            const service = byKey.get(`${namespace}/Service/${backend.name}`);
            assert.ok(service, `${resourceKey(ingress)} route ${route.path} references missing Service ${backend.name}`);
            const requestedPort = backend.port?.number ?? backend.port?.name;
            assert.ok((service.spec?.ports || []).some((port) => port.port === requestedPort || port.name === requestedPort),
                `${resourceKey(ingress)} route ${route.path} references missing port ${requestedPort} on ${backend.name}`);
        }
    }
});

test('HTTP probes use ports declared by their own containers', () => {
    for (const workload of resources.filter((resource) => workloadLabels(resource))) {
        for (const container of workload.spec?.template?.spec?.containers || []) {
            for (const probeName of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
                const probe = container[probeName]?.httpGet;
                if (!probe) continue;
                const declared = (container.ports || []).some((port) =>
                    typeof probe.port === 'number' ? port.containerPort === probe.port : port.name === probe.port
                );
                assert.ok(declared, `${resourceKey(workload)} ${container.name} ${probeName} uses undeclared port ${probe.port}`);
                assert.match(probe.path, /^\//, `${resourceKey(workload)} ${container.name} ${probeName} path must be absolute`);
            }
        }
    }
});

test('Kubernetes service-discovery URLs in application ConfigMaps resolve to declared Service ports', () => {
    const applicationConfigs = resources.filter((resource) =>
        resource.kind === 'ConfigMap' && ['dotnet-service-config', 'middleware-service-config'].includes(resource.metadata.name)
    );
    const dnsPattern = /(?:\/dns4\/|https?:\/\/|grpcs?:\/\/)([a-z0-9-]+)\.([a-z0-9-]+)\.svc\.cluster\.local(?::|\/tcp\/)(\d+)/gi;
    for (const config of applicationConfigs) {
        for (const [name, value] of Object.entries(config.data || {})) {
            for (const match of String(value).matchAll(dnsPattern)) {
                const [, serviceName, namespace, rawPort] = match;
                const service = byKey.get(`${namespace}/Service/${serviceName}`);
                assert.ok(service, `${resourceKey(config)} ${name} references missing Service ${namespace}/${serviceName}`);
                const port = Number(rawPort);
                assert.ok((service.spec?.ports || []).some((candidate) => candidate.port === port),
                    `${resourceKey(config)} ${name} references missing port ${port} on ${namespace}/${serviceName}`);
            }
        }
    }
});

test('GKE Ingress sends every frontend API family to its owning gateway', () => {
    const ingress = byKey.get('plv-fabric/Ingress/main-ingress');
    assert.ok(ingress, 'main-ingress is missing');
    const routes = ingress.spec.rules.flatMap((rule) => rule.http?.paths || []);
    const backendFor = (requestPath) => routes
        .filter((route) => requestPath.startsWith(route.path))
        .sort((left, right) => right.path.length - left.path.length)[0]?.backend?.service?.name;

    const dotnetFamilies = new Set([
        'Auth', 'password-reset-requests', 'student', 'Student', 'AccountManagement',
        'Curriculums', 'SupportTickets', 'SystemMonitoring', 'Grades', 'GradeTemplate',
        'SystemSettings', 'BulkUpload', 'RegistrarDashboard', 'registrar'
    ]);
    const source = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'services', 'api.js'), 'utf8');
    const endpointPattern = /(?:fetchWithAuth|fetchPublic)\(\s*([`'"])(\/[^`'"]+)/g;
    for (const match of source.matchAll(endpointPattern)) {
        const relativePath = match[2].split('${')[0].split('?')[0];
        const family = relativePath.split('/').filter(Boolean)[0];
        const expectedBackend = dotnetFamilies.has(family) ? 'client-app-service' : 'middleware-api';
        assert.equal(backendFor(`/api${relativePath}`), expectedBackend,
            `frontend endpoint ${relativePath} is routed to the wrong GKE backend`);
    }
});

test('all ASP.NET API aliases are represented by YARP and GKE Ingress routes', () => {
    const topology = fs.readFileSync(path.join(repoRoot, 'client-app', 'Microservices', 'DotnetServiceTopology.cs'), 'utf8');
    const ingress = byKey.get('plv-fabric/Ingress/main-ingress');
    const ingressPaths = ingress.spec.rules.flatMap((rule) => rule.http?.paths || []).map((route) => route.path);
    const aliases = [
        '/api/password-reset-requests', '/api/bulk-faculty-load', '/api/bulk-faculty-sections',
        '/api/bulk-faculty-sections-upload', '/api/assign-faculty-bulk',
        '/api/chairperson/assign-faculty-bulk', '/api/bulk-faculty-load-chairperson'
    ];
    for (const alias of aliases) {
        assert.ok(topology.includes(`"${alias}"`), `${alias} is missing from the YARP route map`);
        assert.ok(ingressPaths.some((prefix) => alias.startsWith(prefix)), `${alias} is missing from main-ingress`);
    }
});

test('every ASP.NET controller base route is owned by YARP and GKE Ingress', () => {
    const topology = fs.readFileSync(path.join(repoRoot, 'client-app', 'Microservices', 'DotnetServiceTopology.cs'), 'utf8');
    const ingress = byKey.get('plv-fabric/Ingress/main-ingress');
    const ingressPaths = ingress.spec.rules.flatMap((rule) => rule.http?.paths || []).map((route) => route.path);
    const controllersDirectory = path.join(repoRoot, 'client-app', 'Controllers');

    for (const name of fs.readdirSync(controllersDirectory).filter((entry) => entry.endsWith('Controller.cs'))) {
        const source = fs.readFileSync(path.join(controllersDirectory, name), 'utf8');
        const className = source.match(/class\s+(\w+Controller)\b/)?.[1];
        const route = source.match(/\[Route\("([^"\r\n]+)"\)\]/)?.[1];
        assert.ok(className && route, `${name} must declare a controller class and base route`);
        const controllerName = className.slice(0, -'Controller'.length);
        const publicPath = `/${route.replace('[controller]', controllerName)}`;
        assert.ok(topology.includes(`"${publicPath}"`), `${publicPath} is missing from the YARP route map`);
        assert.ok(ingressPaths.some((prefix) => publicPath.startsWith(prefix)), `${publicPath} is missing from main-ingress`);
    }
});

test('production PostgreSQL policy permits every ASP.NET workload', () => {
    const policy = byKey.get('plv-main-campus/NetworkPolicy/firewall-main-dbs');
    assert.ok(policy, 'firewall-main-dbs is missing');
    const permitted = new Set();
    for (const rule of policy.spec.ingress || []) {
        if (!(rule.ports || []).some((port) => port.port === 5432)) continue;
        for (const source of rule.from || []) {
            const namespace = source.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'];
            if (namespace !== 'plv-fabric') continue;
            for (const expression of source.podSelector?.matchExpressions || []) {
                if (expression.key === 'app' && expression.operator === 'In') {
                    for (const value of expression.values || []) permitted.add(value);
                }
            }
        }
    }
    for (const app of [
        'dotnet-api-gateway', 'dotnet-auth-service', 'dotnet-academic-service',
        'dotnet-grade-service', 'dotnet-operations-service', 'dotnet-realtime-service'
    ]) {
        assert.ok(permitted.has(app), `${app} cannot reach production PostgreSQL`);
    }
});

test('IPFS GKE backend uses the router health endpoint', () => {
    const service = byKey.get('plv-fabric/Service/ipfs-ha-gateway');
    const backend = byKey.get('plv-fabric/BackendConfig/ipfs-ha-gateway-backend');
    assert.ok(service?.metadata?.annotations?.['cloud.google.com/backend-config'], 'IPFS gateway BackendConfig annotation is missing');
    assert.equal(backend?.spec?.healthCheck?.requestPath, '/router-health');
    assert.equal(backend?.spec?.healthCheck?.port, 8080);
    assert.equal(byKey.has('plv-fabric/Ingress/ipfs-ingress'), false, 'legacy hostless IPFS ingress must not be deployed');
});

test('production deployment validates the authenticated profile path', () => {
    const workflowPath = path.join(repoRoot, '.github', 'workflows', 'production.yml');
    const source = fs.readFileSync(workflowPath, 'utf8');
    const tokenScript = fs.readFileSync(path.join(repoRoot, 'middleware', 'scripts', 'create-profile-smoke-token.js'), 'utf8');
    assert.doesNotThrow(() => yaml.load(source), 'production workflow must be valid YAML');
    assert.match(source, /deployment\/dotnet-auth-service/, 'production must wait for the .NET auth rollout');
    assert.match(source, /\/api\/Auth\/user-profile/, 'production must smoke-test the authenticated profile route');
    assert.match(source, /--data-urlencode "email=\$\{admin_email\}"/, 'profile smoke must send the required email query value');
    assert.match(source, /--data-urlencode "role=system_admin"/, 'profile smoke must send the required role query value');
    assert.match(tokenScript, /createHash\('sha256'\)/, 'profile smoke token must use the shared hashed JWT key contract');

    const secret = 'configuration-contract-test-secret';
    const generated = spawnSync(process.execPath, [path.join(repoRoot, 'middleware', 'scripts', 'create-profile-smoke-token.js')], {
        encoding: 'utf8',
        env: { ...process.env, JWT_SECRET: secret, ADMIN_EMAIL: 'system-admin@plv.edu.ph' }
    });
    assert.equal(generated.status, 0, generated.stderr);
    const [header, payload, signature] = generated.stdout.split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'HS256');
    assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).dbRole, 'system_admin');
    const key = crypto.createHash('sha256').update(secret).digest();
    const expected = crypto.createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
    assert.equal(signature, expected);
});
