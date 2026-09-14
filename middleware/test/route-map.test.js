const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { allowedMethods, resolveRoute, routeDefinitions } = require('../src/shared/route-map');
const { normalizeAuthRole } = require('../src/shared/roles');
const { isRetryableCouchDbError } = require('../src/fabric/wallet-manager');

const expected = {
    '/api/login': 'auth', '/api/crypto/hash-password': 'auth', '/api/forgot-password': 'auth', '/api/reset-password': 'auth', '/api/bootstrap': 'auth',
    '/api/fabric/register-user': 'identity', '/api/enroll': 'identity', '/api/register': 'identity', '/api/revoke': 'identity', '/api/wallet/person@example.edu': 'identity',
    '/api/all-grades': 'ledger', '/api/student-transactions': 'ledger', '/api/admin/ledger-transactions': 'ledger', '/api/grade-history/GRADE-1': 'ledger',
    '/api/fabric/audit-event': 'ledger', '/api/issue-grade': 'ledger', '/api/get-grade/GRADE-1': 'ledger',
    '/api/update-grade': 'ledger', '/api/approve-grade/GRADE-1': 'ledger', '/api/finalize-grade/GRADE-1': 'ledger',
    '/api/return-grade/GRADE-1': 'ledger', '/api/batch-issue-grade': 'ledger',
    '/api/batch-upload': 'upload', '/api/upload-grades': 'upload',
    '/api/SystemSettings': 'settings', '/api/SystemSettings/EncodingPeriod': 'settings', '/api/SystemSettings/reset-season': 'settings'
};

test('every compatibility route has exactly one owning service', () => {
    for (const [path, service] of Object.entries(expected)) {
        assert.equal(resolveRoute(path), service, path);
        assert.equal(routeDefinitions.filter((definition) => definition.paths.some((pattern) => pattern.test(path))).length, 1, path);
    }
});

test('unknown routes are not forwarded', () => assert.equal(resolveRoute('/api/not-a-real-route'), null));

test('documented compatibility routes expose their intended HTTP methods', () => {
    assert.deepEqual(allowedMethods('/api/health'), ['GET']);
    assert.deepEqual(allowedMethods('/api/bootstrap'), ['GET']);
    assert.deepEqual(allowedMethods('/api/admin/ledger-transactions'), ['GET']);
    assert.deepEqual(allowedMethods('/api/crypto/hash-password'), ['POST']);
    assert.deepEqual(allowedMethods('/api/SystemSettings/EncodingPeriod'), ['GET']);
    assert.deepEqual(allowedMethods('/api/SystemSettings/reset-season'), ['POST']);
});

test('legacy role labels normalize consistently across services', () => {
    assert.equal(normalizeAuthRole('Chairperson'), 'department_admin');
    assert.equal(normalizeAuthRole('Dept Admin'), 'department_admin');
    assert.equal(normalizeAuthRole('System Administrator'), 'system_admin');
    assert.equal(normalizeAuthRole('Instructor'), 'faculty');
});

test('CouchDB transport failures are retried without retrying authentication failures', () => {
    assert.equal(isRetryableCouchDbError({ code: 'ECONNRESET' }), true);
    assert.equal(isRetryableCouchDbError({ statusCode: 503 }), true);
    assert.equal(isRetryableCouchDbError({ statusCode: 401, message: 'unauthorized' }), false);
});

test('password reset routes use the approval workflow schema', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/services/auth-service.js'), 'utf8');
    assert.match(source, /request_status[\s\S]*request_reason/);
    assert.doesNotMatch(source, /\botp_code\b|\bexpires_at\b|\bused_at\b/);
});

test('deployed authentication uses the tested account-aware login limiter', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/services/auth-service.js'), 'utf8');
    assert.match(source, /createLoginLimiter\(\{ recordSecurityEvent \}\)/);
});

test('the runtime image installs the Fabric CA client used by identity routes', () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
    assert.match(dockerfile, /fabric-ca-client@2\.2\.20/);
    assert.match(dockerfile, /require\('\/app\/node_modules\/fabric-ca-client\/package\.json'\)/);
});
