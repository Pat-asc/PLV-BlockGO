const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');
const { isContainerized, middlewareRoot, parsePositiveInt } = require('../shared/config');
const { findIdentity } = require('./wallet-manager');
const { safeFabricReason } = require('./ledger-errors');
const createLogger = require('../shared/logger');

const logger = createLogger('fabric-gateway');

const gatewayCache = new Map();
const idleTimeout = parsePositiveInt(process.env.GATEWAY_IDLE_TIMEOUT_MS, 5 * 60 * 1000);
const maxUsers = parsePositiveInt(process.env.GATEWAY_CACHE_MAX_USERS, 500);
let baseProfile;
let pruneTimer;
let Gateway;

function gatewayConstructor() {
    if (!Gateway) ({ Gateway } = require('fabric-network'));
    return Gateway;
}

function readPem(candidates) {
    const file = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    return file ? fs.readFileSync(file, 'utf8') : '';
}

function profilePath() {
    const candidates = [
        process.env.CONNECTION_PROFILE_PATH,
        path.join(middlewareRoot, 'connection.json'),
        path.resolve(middlewareRoot, '..', 'network', 'connection-profile.json')
    ];
    const selected = candidates.find((candidate) => candidate && fs.existsSync(candidate) && fs.statSync(candidate).size > 0);
    if (!selected) throw new Error('A non-empty Fabric connection profile was not found.');
    return selected;
}

function loadBaseProfile() {
    if (!baseProfile) baseProfile = JSON.parse(fs.readFileSync(profilePath(), 'utf8'));
    return baseProfile;
}

function localTls(name) {
    const cryptoBase = path.resolve(middlewareRoot, '..', 'network', 'crypto-config-final-v2');
    const paths = {
        registrar: path.join(cryptoBase, 'peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/ca.crt'),
        faculty: path.join(cryptoBase, 'peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/ca.crt'),
        department: path.join(cryptoBase, 'peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/ca.crt'),
        orderer: path.join(cryptoBase, 'ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/ca.crt')
    };
    return readPem([paths[name]]);
}

function kubernetesTls(name) {
    const root = process.env.FABRIC_GATEWAY_TLS_ROOTS || '/etc/hyperledger/fabric-gateway-tls';
    const files = {
        registrar: 'registrar-peer-ca.crt', faculty: 'faculty-peer-ca.crt',
        department: 'department-peer-ca.crt', orderer: 'orderer-ca.crt'
    };
    return readPem([path.join(root, files[name])]);
}

function endpoint(url, pem, serverName) {
    if (!pem) throw new Error(`Fabric Gateway TLS root for ${serverName} is missing.`);
    return {
        url,
        tlsCACerts: { pem },
        grpcOptions: {
            'ssl-target-name-override': serverName,
            'grpc.keepalive_time_ms': 120000,
            'grpc.keepalive_timeout_ms': 20000,
            'grpc.keepalive_permit_without_calls': 1,
            'grpc.max_send_message_length': -1,
            'grpc.max_receive_message_length': -1
        }
    };
}

function fabricEndpointUrls() {
    const container = isContainerized();
    const kubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
    const endpoints = {
        registrar: process.env.FABRIC_PEER_REGISTRAR_URL || (kubernetes ? 'grpcs://peer-registrar.plv-main-campus.svc.cluster.local:7051' : container ? 'grpcs://host.docker.internal:7051' : 'grpcs://localhost:7051'),
        faculty: process.env.FABRIC_PEER_FACULTY_URL || (kubernetes ? 'grpcs://peer-faculty.plv-annex-campus.svc.cluster.local:7051' : container ? 'grpcs://host.docker.internal:9051' : 'grpcs://localhost:9051'),
        department: process.env.FABRIC_PEER_DEPARTMENT_URL || (kubernetes ? 'grpcs://peer-department.plv-pubad-campus.svc.cluster.local:7051' : container ? 'grpcs://host.docker.internal:11051' : 'grpcs://localhost:11051'),
        orderer: process.env.FABRIC_ORDERER_URL || (kubernetes ? 'grpcs://orderer-1.plv-main-campus.svc.cluster.local:7050' : container ? 'grpcs://host.docker.internal:7050' : 'grpcs://localhost:7050')
    };
    if (['1', 'true', 'yes', 'on'].includes(String(process.env.FABRIC_HA_ENABLED || '').trim().toLowerCase())) {
        Object.assign(endpoints, {
            registrarSecondary: process.env.FABRIC_PEER_REGISTRAR_2_URL || 'grpcs://peer-registrar-2.plv-main-campus.svc.cluster.local:7051',
            facultySecondary: process.env.FABRIC_PEER_FACULTY_2_URL || 'grpcs://peer-faculty-2.plv-annex-campus.svc.cluster.local:7051',
            departmentSecondary: process.env.FABRIC_PEER_DEPARTMENT_2_URL || 'grpcs://peer-department-2.plv-pubad-campus.svc.cluster.local:7051',
            orderer2: process.env.FABRIC_ORDERER_2_URL || 'grpcs://orderer-2.plv-main-campus.svc.cluster.local:7050',
            orderer3: process.env.FABRIC_ORDERER_3_URL || 'grpcs://orderer-3.plv-annex-campus.svc.cluster.local:7050',
            orderer4: process.env.FABRIC_ORDERER_4_URL || 'grpcs://orderer-4.plv-annex-campus.svc.cluster.local:7050',
            orderer5: process.env.FABRIC_ORDERER_5_URL || 'grpcs://orderer-5.plv-pubad-campus.svc.cluster.local:7050',
            orderer6: process.env.FABRIC_ORDERER_6_URL || 'grpcs://orderer-6.plv-pubad-campus.svc.cluster.local:7050'
        });
    }

    const disabledOrderers = new Set(
        String(process.env.FABRIC_DISABLED_ORDERERS || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
    );

    for (const name of disabledOrderers) {
        if (name !== 'orderer' && name.startsWith('orderer')) {
            delete endpoints[name];
        }
    }

    return endpoints;
}

function fabricDiscoveryEnabled() {
    const configured = process.env.FABRIC_DISCOVERY_ENABLED;
    if (configured !== undefined) return ['1', 'true', 'yes', 'on'].includes(String(configured).trim().toLowerCase());
    return Boolean(process.env.KUBERNETES_SERVICE_HOST);
}

function profileForIdentity(identity) {
    const profile = structuredClone(loadBaseProfile());
    const organization = Object.entries(profile.organizations || {}).find(([, details]) => details.mspid === identity.mspId)?.[0];
    if (!organization) throw new Error(`Organization with MSP ID '${identity.mspId}' is absent from the connection profile.`);
    profile.client = { ...(profile.client || {}), organization };
    const container = isContainerized();
    const tls = container ? kubernetesTls : localTls;
    const urls = fabricEndpointUrls();
    profile.peers = {
        'peer0.registrar.capstone.com': endpoint(urls.registrar, tls('registrar'), 'peer0.registrar.capstone.com'),
        'peer0.faculty.capstone.com': endpoint(urls.faculty, tls('faculty'), 'peer0.faculty.capstone.com'),
        'peer0.department.capstone.com': endpoint(urls.department, tls('department'), 'peer0.department.capstone.com')
    };
    profile.orderers = {
        'orderer.capstone.com': endpoint(urls.orderer, tls('orderer'), 'orderer.capstone.com')
    };
    if (urls.registrarSecondary) {
        profile.peers['peer1.registrar.capstone.com'] = endpoint(urls.registrarSecondary, tls('registrar'), 'peer1.registrar.capstone.com');
        profile.peers['peer1.faculty.capstone.com'] = endpoint(urls.facultySecondary, tls('faculty'), 'peer1.faculty.capstone.com');
        profile.peers['peer1.department.capstone.com'] = endpoint(urls.departmentSecondary, tls('department'), 'peer1.department.capstone.com');
        for (let number = 2; number <= 6; number += 1) {
            const ordererUrl = urls[`orderer${number}`];
            if (ordererUrl) {
                profile.orderers[`orderer${number}.capstone.com`] = endpoint(ordererUrl, tls('orderer'), `orderer${number}.capstone.com`);
            }
        }
    }
    const channelName = process.env.CHANNEL_NAME || 'registrar-channel';
    profile.channels = {
        ...(profile.channels || {}),
        [channelName]: {
            ...(profile.channels?.[channelName] || {}),
            orderers: Object.keys(profile.orderers),
            peers: {
                'peer0.registrar.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true },
                'peer0.faculty.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true },
                'peer0.department.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true },
                ...(urls.registrarSecondary ? {
                    'peer1.registrar.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true },
                    'peer1.faculty.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true },
                    'peer1.department.capstone.com': { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true }
                } : {})
            }
        }
    };
    for (const details of Object.values(profile.organizations || {})) {
        details.peers = (details.peers || []).filter((peer) => profile.peers[peer]);
    }
    return profile;
}

function disconnect(username, reason = 'invalidated') {
    const cached = gatewayCache.get(username);
    if (!cached) return false;
    try { cached.gateway.disconnect(); } catch { /* already disconnected */ }
    gatewayCache.delete(username);
    return true;
}

function prune() {
    const now = Date.now();
    for (const [username, cached] of gatewayCache) {
        if (now - cached.lastAccessed > idleTimeout) disconnect(username, 'idle');
    }
}

function ensurePruner() {
    if (!pruneTimer) {
        pruneTimer = setInterval(prune, parsePositiveInt(process.env.GATEWAY_PRUNE_INTERVAL_MS, 60000));
        pruneTimer.unref();
    }
}

async function contractForUser(username, roleHint) {
    if (!username) throw new Error('A valid user identity is required for the Fabric transaction.');
    ensurePruner();
    let found;
    try { found = await findIdentity(username, roleHint); }
    catch (error) {
        logger.error({ identity: username, role: roleHint, stage: 'wallet', reason: safeFabricReason(error) }, 'Fabric wallet lookup failed');
        throw error;
    }
    if (!found) {
        disconnect(username, 'wallet-removed');
        logger.warn({ identity: username, role: roleHint, stage: 'wallet' }, 'Fabric wallet identity is missing');
        throw new Error(`Access Denied: Wallet identity for '${username}' not found. The Registrar must register this user first.`);
    }
    const cached = gatewayCache.get(username);
    if (cached && cached.mspId === found.identity.mspId && Date.now() - cached.lastAccessed <= idleTimeout) {
        cached.lastAccessed = Date.now();
        return cached.contract;
    }
    disconnect(username, 'reconnect');
    while (gatewayCache.size >= maxUsers) {
        const oldest = [...gatewayCache.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)[0];
        if (!oldest) break;
        disconnect(oldest[0], 'capacity');
    }
    const FabricGateway = gatewayConstructor();
    const gateway = new FabricGateway();
    const channel = process.env.CHANNEL_NAME || 'registrar-channel';
    const chaincode = process.env.CHAINCODE_NAME || 'registrar';
    let contract;
    try {
        await gateway.connect(profileForIdentity(found.identity), {
            wallet: found.wallet,
            identity: username,
            // Kubernetes DNS can route the explicit FQDNs in profileForIdentity. Fabric
            // discovery may return channel endpoints advertised for another namespace
            // (or external orderer hostnames), so it must be explicitly opt-in there.
            discovery: { enabled: fabricDiscoveryEnabled(), asLocalhost: !isContainerized() }
        });
        const network = await gateway.getNetwork(channel);
        contract = network.getContract(chaincode);
    } catch (error) {
        try { gateway.disconnect(); } catch { /* connection did not complete */ }
        logger.error({ identity: username, mspId: found.identity.mspId, channel, chaincode,
            stage: 'gateway-or-contract', reason: safeFabricReason(error) }, 'Fabric gateway connection failed');
        throw error;
    }
    logger.info({ identity: username, mspId: found.identity.mspId, channel, chaincode }, 'Fabric contract resolved');
    gatewayCache.set(username, { gateway, contract, mspId: found.identity.mspId, lastAccessed: Date.now() });
    return contract;
}

function cacheStats() {
    return { entries: gatewayCache.size, maxEntries: maxUsers };
}

function checkSocket(name, endpointUrl) {
    const target = new URL(endpointUrl);
    return new Promise((resolve, reject) => {
        const secure = target.protocol === 'grpcs:' || target.protocol === 'https:';
        const serverNames = {
            registrar: 'peer0.registrar.capstone.com',
            faculty: 'peer0.faculty.capstone.com',
            department: 'peer0.department.capstone.com',
            registrarSecondary: 'peer1.registrar.capstone.com',
            facultySecondary: 'peer1.faculty.capstone.com',
            departmentSecondary: 'peer1.department.capstone.com',
            orderer: 'orderer.capstone.com',
            orderer2: 'orderer2.capstone.com',
            orderer3: 'orderer3.capstone.com',
            orderer4: 'orderer4.capstone.com',
            orderer5: 'orderer5.capstone.com',
            orderer6: 'orderer6.capstone.com'
        };
        const tlsGroup = name.startsWith('orderer') ? 'orderer' : name.replace('Secondary', '');
        const tlsRoot = secure ? (isContainerized() ? kubernetesTls(tlsGroup) : localTls(tlsGroup)) : '';
        if (secure && !tlsRoot) {
            reject(new Error(`${name} TLS root is unavailable for readiness validation.`));
            return;
        }

        const options = { host: target.hostname, port: Number(target.port) };
        const socket = secure
            ? tls.connect({ ...options, ca: tlsRoot, servername: serverNames[name], rejectUnauthorized: true })
            : net.createConnection(options);
        const readyEvent = secure ? 'secureConnect' : 'connect';
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.removeListener(readyEvent, onReady);
            socket.removeListener('error', onError);
            // A readiness probe needs only to establish the connection. Destroy it
            // synchronously after that result so repeated probes cannot retain TLS
            // sockets and their native OpenSSL allocations while awaiting a peer's
            // close-notify response.
            socket.destroy();
            if (error) reject(new Error(`${name} is unreachable: ${error.message}`));
            else resolve([name, secure ? 'tls-ready' : 'reachable']);
        };
        const onReady = () => finish();
        const onError = (error) => finish(error);
        const timeout = setTimeout(
            () => finish(new Error('connection timed out.')),
            Number(process.env.FABRIC_READINESS_TIMEOUT_MS || 2000)
        );
        socket.once(readyEvent, onReady);
        socket.once('error', onError);
    });
}

async function checkFabricEndpoints() {
    const endpoints = fabricEndpointUrls();
    const settled = await Promise.allSettled(Object.entries(endpoints).map(([name, url]) => checkSocket(name, url)));
    const available = Object.fromEntries(settled.filter((result) => result.status === 'fulfilled').map((result) => result.value));
    const failures = settled.filter((result) => result.status === 'rejected').map((result) => result.reason.message);

    for (const org of ['registrar', 'faculty', 'department']) {
        if (!available[org] && !available[`${org}Secondary`]) {
            throw new Error(`No ${org} peer is reachable. ${failures.join(' ')}`);
        }
    }
    const ordererCount = Object.keys(endpoints).filter((name) => name.startsWith('orderer')).length;
    const availableOrderers = Object.keys(available).filter((name) => name.startsWith('orderer')).length;
    const requiredOrderers = Math.floor(ordererCount / 2) + 1;
    if (availableOrderers < requiredOrderers) {
        throw new Error(`Fabric orderer quorum is unavailable (${availableOrderers}/${ordererCount}, need ${requiredOrderers}). ${failures.join(' ')}`);
    }
    return available;
}

async function closeGateways() {
    if (pruneTimer) clearInterval(pruneTimer);
    for (const username of [...gatewayCache.keys()]) disconnect(username, 'shutdown');
}

module.exports = { cacheStats, checkFabricEndpoints, checkSocket, closeGateways, contractForUser, disconnect, fabricEndpointUrls, profileForIdentity };
