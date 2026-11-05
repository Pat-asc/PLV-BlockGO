const test = require('node:test');
const assert = require('node:assert/strict');
const { bootstrapAccounts } = require('../src/shared/bootstrap-service');

function databaseFixture(initialAccounts = []) {
    const state = {
        accounts: initialAccounts.map((account) => ({ auth_version: 1, ...account })),
        profiles: [],
        hashes: [],
        identityBootstraps: []
    };
    const client = {
        async query(sql, values = []) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized) || normalized.includes('pg_advisory_xact_lock')) return { rows: [] };
            if (normalized.startsWith('SELECT id, email, password_hash')) {
                return { rows: state.accounts
                    .filter((account) => account.email.toLowerCase() === String(values[0]).toLowerCase())
                    .sort((left, right) => left.id - right.id)
                    .map((account) => ({ ...account })) };
            }
            if (normalized.startsWith('INSERT INTO users')) {
                const account = {
                    id: state.accounts.reduce((maximum, current) => Math.max(maximum, current.id), 0) + 1,
                    email: values[0], password_hash: values[1], role: values[2],
                    status: 'APPROVED', is_active: true, auth_version: 1
                };
                state.accounts.push(account);
                return { rows: [{ ...account }] };
            }
            if (normalized.startsWith('INSERT INTO adminprofiles')) {
                state.profiles.push({ userId: values[0], fullName: values[1], role: values[2], department: values[3] });
                return { rows: [] };
            }
            throw new Error(`Unexpected bootstrap SQL: ${normalized}`);
        },
        release() {}
    };
    return {
        state,
        options: {
            dbWrite: { connect: async () => client },
            hashPassword: async (password) => {
                state.hashes.push(password);
                return `hashed:${password}`;
            },
            systemEmail: 'system-admin@plv.edu.ph', systemPassword: 'existing-secret',
            registrarEmail: 'registrar@plv.edu.ph', registrarPassword: 'registrar-secret',
            bootstrapRegistrarIdentity: async (identity) => state.identityBootstraps.push(identity)
        }
    };
}

test('existing System Administrator survives repeated bootstrap unchanged and without duplicates', async () => {
    const fixture = databaseFixture([
        { id: 41, email: 'SYSTEM-ADMIN@plv.edu.ph', password_hash: 'original-hash', role: 'system_admin', status: 'APPROVED', is_active: true, auth_version: 7 },
        { id: 42, email: 'registrar@plv.edu.ph', password_hash: 'registrar-hash', role: 'registrar', status: 'APPROVED', is_active: true, auth_version: 3 }
    ]);

    const first = await bootstrapAccounts(fixture.options);
    const second = await bootstrapAccounts(fixture.options);

    assert.deepEqual(first, { systemCreated: false, registrarCreated: false });
    assert.deepEqual(second, { systemCreated: false, registrarCreated: false });
    assert.equal(fixture.state.accounts.length, 2);
    assert.deepEqual(fixture.state.accounts[0], {
        id: 41, email: 'SYSTEM-ADMIN@plv.edu.ph', password_hash: 'original-hash', role: 'system_admin',
        status: 'APPROVED', is_active: true, auth_version: 7
    });
    assert.deepEqual(fixture.state.hashes, []);
});

test('first bootstrap creates one account per role and the next run creates none', async () => {
    const fixture = databaseFixture();
    assert.deepEqual(await bootstrapAccounts(fixture.options), { systemCreated: true, registrarCreated: true });
    assert.deepEqual(await bootstrapAccounts(fixture.options), { systemCreated: false, registrarCreated: false });
    assert.equal(fixture.state.accounts.filter((account) => account.role === 'system_admin').length, 1);
    assert.equal(fixture.state.accounts.filter((account) => account.role === 'registrar').length, 1);
    assert.equal(fixture.state.hashes.length, 2);
});

test('duplicate or wrong-role System Administrator records fail without being overwritten', async () => {
    const duplicates = databaseFixture([
        { id: 1, email: 'system-admin@plv.edu.ph', password_hash: 'one', role: 'system_admin', status: 'APPROVED', is_active: true },
        { id: 2, email: 'SYSTEM-ADMIN@plv.edu.ph', password_hash: 'two', role: 'system_admin', status: 'APPROVED', is_active: true }
    ]);
    await assert.rejects(bootstrapAccounts(duplicates.options), /duplicate accounts/);
    assert.deepEqual(duplicates.state.hashes, []);

    const wrongRole = databaseFixture([
        { id: 1, email: 'system-admin@plv.edu.ph', password_hash: 'unchanged', role: 'faculty', status: 'APPROVED', is_active: true }
    ]);
    await assert.rejects(bootstrapAccounts(wrongRole.options), /unexpected role/);
    assert.equal(wrongRole.state.accounts[0].password_hash, 'unchanged');
});
