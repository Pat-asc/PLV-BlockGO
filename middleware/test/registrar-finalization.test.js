const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrarServiceBootstrap, REGISTRAR_SERVICE_LABEL } = require('../src/fabric/registrar-service-identity');
const { classifyLedgerError, safeFabricReason } = require('../src/fabric/ledger-errors');
const { resilientWallet } = require('../src/fabric/wallet-manager');

function bootstrapFixture(options = {}) {
    let identity = options.identity || null;
    let registrations = 0;
    let enrollments = 0;
    const wallet = { get: async () => identity };
    const ensure = createRegistrarServiceBootstrap({
        getWallet: async () => {
            if (options.walletUnavailable) throw new Error('CouchDB wallet unavailable');
            return wallet;
        },
        enrollIdentity: async (label, secret, role) => {
            assert.equal(label, REGISTRAR_SERVICE_LABEL);
            assert.equal(role, 'registrar');
            assert.equal(secret, 'configured-secret');
            enrollments += 1;
            if (options.staleSecret || (options.mustRegister && !registrations))
                throw new Error('Enrollment authorization failure');
            identity = { mspId: 'RegistrarMSP', type: 'X.509' };
            return { identity };
        },
        ensureAdminEnrolled: async () => ({ client: { register: async () => {
            registrations += 1;
            if (options.alreadyRegistered) throw new Error('Identity already registered');
        } } }),
        adminUser: async () => ({}),
        registrationPayload: () => ({ enrollmentID: REGISTRAR_SERVICE_LABEL })
    });
    return { ensure, stats: () => ({ registrations, enrollments, identity }) };
}

test('existing Registrar service identity is reused without CA registration or enrollment', async () => {
    const fixture = bootstrapFixture({ identity: { mspId: 'RegistrarMSP', type: 'X.509' } });
    assert.deepEqual(await fixture.ensure('configured-secret'), { created: false, mspId: 'RegistrarMSP' });
    assert.deepEqual(fixture.stats(), { registrations: 0, enrollments: 0,
        identity: { mspId: 'RegistrarMSP', type: 'X.509' } });
});

test('missing identity is registered, enrolled, saved, and reused on retry', async () => {
    const fixture = bootstrapFixture({ mustRegister: true });
    assert.equal((await fixture.ensure('configured-secret')).created, true);
    assert.deepEqual(fixture.stats(), { registrations: 1, enrollments: 2,
        identity: { mspId: 'RegistrarMSP', type: 'X.509' } });
    assert.equal((await fixture.ensure('configured-secret')).created, false);
    assert.equal(fixture.stats().registrations, 1);
});

test('missing wallet copy can be restored from an existing CA registration', async () => {
    const fixture = bootstrapFixture();
    assert.equal((await fixture.ensure('configured-secret')).created, true);
    assert.equal(fixture.stats().registrations, 0);
});

test('stale CA secret, missing bootstrap secret, and wrong MSP fail without overwriting a wallet', async () => {
    await assert.rejects(bootstrapFixture({ staleSecret: true, alreadyRegistered: true }).ensure('configured-secret'),
        /cannot be enrolled with the configured secret/);
    await assert.rejects(bootstrapFixture().ensure(''), /BOOTSTRAP_REGISTRAR_PASS is unavailable/);
    await assert.rejects(bootstrapFixture({ identity: { mspId: 'FacultyMSP', type: 'X.509' } }).ensure('configured-secret'),
        /unexpected MSP/);
    await assert.rejects(bootstrapFixture({ walletUnavailable: true }).ensure('configured-secret'), /wallet unavailable/);
});

test('only genuine ReadGrade absence is NOT_FOUND; wallet, channel, and issue errors stay distinct', () => {
    assert.equal(classifyLedgerError(new Error('Record not found'), 'ReadGrade').code, 'GRADE_NOT_FOUND');
    assert.equal(classifyLedgerError(new Error('Record already exists'), 'IssueGrade').code, 'LEDGER_RECORD_EXISTS');
    assert.equal(classifyLedgerError(new Error("Access Denied: Wallet identity for 'system-admin-registrar' not found"), 'ReadGrade').code,
        'WALLET_IDENTITY_MISSING');
    assert.equal(classifyLedgerError(new Error("Wallet identity for 'system-admin-registrar' not found; Record not found"), 'ReadGrade').code,
        'WALLET_IDENTITY_MISSING');
    assert.equal(classifyLedgerError(new Error('DiscoveryService registrar-channel access denied'), 'ReadGrade').code,
        'CHANNEL_ACCESS_DENIED');
    assert.equal(classifyLedgerError(new Error('Endorsement failed'), 'IssueGrade').code, 'FABRIC_COMMIT_FAILED');
    assert.notEqual(classifyLedgerError(new Error('Record not found'), 'IssueGrade').code, 'GRADE_NOT_FOUND');
    assert.ok(!safeFabricReason(new Error('password=secret123')).includes('secret123'));
});

test('a swallowed CouchDB get error is not mistaken for a missing Registrar identity', async () => {
    const label = REGISTRAR_SERVICE_LABEL;
    const inaccessible = resilientWallet('registrar', {
        get: async () => undefined, list: async () => { throw Object.assign(new Error('unauthorized'), { statusCode: 401 }); }
    });
    await assert.rejects(inaccessible.get(label), /unauthorized/);
    const unreadable = resilientWallet('registrar', { get: async () => undefined, list: async () => [label] });
    await assert.rejects(unreadable.get(label), /exists but could not be read/);
    const trulyMissing = resilientWallet('registrar', { get: async () => undefined, list: async () => [] });
    assert.equal(await trulyMissing.get(label), undefined);
});
