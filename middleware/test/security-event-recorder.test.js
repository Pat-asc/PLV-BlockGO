const test = require('node:test');
const assert = require('node:assert/strict');
const { SECURITY_EVENT_LIMITS } = require('../src/shared/audit-value-sanitizer');
const { createSecurityEventRecorder } = require('../src/shared/security-event-recorder');

function harness() {
    const calls = [];
    const warnings = [];
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            return { rows: [] };
        },
        release() {}
    };
    const record = createSecurityEventRecorder({
        dbWrite: { connect: async () => client },
        logger: { warn: (...args) => warnings.push(args) }
    });
    const insertedValues = () => calls.find(({ sql }) => sql.includes('INSERT INTO security_events'))?.params;
    return { calls, insertedValues, record, warnings };
}

test('normal security-event values and the verified client IP are preserved', async () => {
    const h = harness();
    await h.record(
        { ip: '203.0.113.17', socket: { remoteAddress: '127.0.0.1' }, originalUrl: '/api/login', method: 'POST' },
        'LOGIN_FAILED', 'MEDIUM', 'student@plv.edu.ph', 'The supplied credentials were invalid.'
    );

    assert.deepEqual(h.insertedValues(), [
        'LOGIN_FAILED', 'MEDIUM', 'student@plv.edu.ph', '203.0.113.17', '/api/login', 'POST',
        'The supplied credentials were invalid.'
    ]);
    assert.ok(h.calls.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(h.warnings.length, 0);
});

test('oversized and control-bearing audit values are bounded before persistence', async () => {
    const h = harness();
    const identity = `person\u0000\u0001${'x'.repeat(400)}@plv.edu.ph`;
    const path = `/api/reset-password\u0000\u0007?probe=${'p'.repeat(700)}`;
    const details = `line one\u0000\u0002\nline two${'d'.repeat(9000)}`;

    await h.record(
        { ip: '198.51.100.8', originalUrl: path, method: `POST\u0000${'M'.repeat(30)}` },
        `PASSWORD_RESET_VERIFICATION_FAILED${'E'.repeat(100)}`,
        'MEDIUM',
        identity,
        details
    );

    const [eventType, severity, persistedIdentity, ipAddress, persistedPath, method, persistedDetails] = h.insertedValues();
    assert.equal(eventType.length, SECURITY_EVENT_LIMITS.eventType);
    assert.equal(severity, 'MEDIUM');
    assert.equal(persistedIdentity.length, SECURITY_EVENT_LIMITS.attemptedIdentity);
    assert.equal(ipAddress, '198.51.100.8');
    assert.equal(persistedPath.length, SECURITY_EVENT_LIMITS.requestPath);
    assert.equal(method.length, SECURITY_EVENT_LIMITS.requestMethod);
    assert.equal(persistedDetails.length, SECURITY_EVENT_LIMITS.details);
    for (const value of [eventType, persistedIdentity, persistedPath, method, persistedDetails]) {
        assert.doesNotMatch(value, /\u0000|\u0001|\u0002|\u0007/);
    }
    assert.match(persistedIdentity, /\uFFFD/);
    assert.match(persistedPath, /\uFFFD/);
    assert.match(persistedDetails, /line one\uFFFD\uFFFD\nline two/);
});

test('unprintable detail values never make audit normalization throw', async () => {
    const h = harness();
    const circular = {};
    circular.self = circular;
    Object.defineProperty(circular, 'toString', { value() { throw new Error('hostile conversion'); } });

    await h.record(
        { ip: '192.0.2.5', originalUrl: '/api/reset-password', method: 'POST' },
        'PASSWORD_RESET_VERIFICATION_FAILED', 'MEDIUM', null, circular
    );

    assert.equal(h.insertedValues()[2], null);
    assert.equal(h.insertedValues()[6], '[unprintable value]');
    assert.ok(h.calls.some(({ sql }) => sql === 'COMMIT'));
});
