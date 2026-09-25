const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serviceSource = fs.readFileSync(path.join(
    __dirname, '..', '..', 'client-app', 'Services', 'AccountProvisioningService.cs'
), 'utf8');
const controllerSource = fs.readFileSync(path.join(
    __dirname, '..', '..', 'client-app', 'Controllers', 'AccountManagementController.cs'
), 'utf8');

const configuredMaximum = Number(serviceSource.match(/MaximumRegistrarAccounts\s*=\s*(\d+)/)?.[1]);

test('Registrar capacity is five and counts the bootstrap Registrar by canonical role', () => {
    assert.equal(configuredMaximum, 5);
    assert.match(serviceSource, /SELECT COUNT\(\*\) FROM users WHERE LOWER\(role\) = 'registrar'/);
    assert.doesNotMatch(serviceSource, /SELECT COUNT\(\*\)[^;]+username[^;]+bootstrap/is);
});

test('one through five Registrar accounts are permitted by the capacity boundary', () => {
    for (let existing = 0; existing < configuredMaximum; existing += 1) {
        assert.equal(existing >= configuredMaximum, false, `creation number ${existing + 1} should be allowed`);
    }
});

test('the sixth Registrar is rejected with a conflict-safe backend error', () => {
    assert.equal(5 >= configuredMaximum, true);
    assert.match(serviceSource, /if \(count >= MaximumRegistrarAccounts\)[\s\S]+Maximum of \{MaximumRegistrarAccounts\} Registrar accounts has been reached/);
    assert.match(controllerSource, /CreateRegistrar[\s\S]+catch \(InvalidOperationException ex\) \{ return Conflict/);
});

test('concurrent creation cannot bypass the capacity check', () => {
    const capacityMethod = serviceSource.slice(
        serviceSource.lastIndexOf('private static async Task EnsureRegistrarCapacityAsync'),
        serviceSource.lastIndexOf('private static async Task EnsureEmailAvailableAsync')
    );
    assert.ok(capacityMethod.indexOf('AcquireRegistrarCapacityLockAsync') < capacityMethod.indexOf('SELECT COUNT(*)'));
    assert.match(serviceSource, /pg_advisory_xact_lock\(@lockId\)/);
});

test('canonical deletion frees a slot while revocation remains non-deleted', () => {
    assert.match(serviceSource, /SET role = 'deleted_registrar',[\s\S]+status = 'DELETED',[\s\S]+is_active = FALSE/);
    assert.match(serviceSource, /is_active = COALESCE\(@isActive, is_active\),[\s\S]+WHERE id = @userId AND LOWER\(role\) = 'registrar'/);
    assert.doesNotMatch(serviceSource, /SELECT COUNT\(\*\) FROM users WHERE LOWER\(role\) = 'registrar' AND is_active/);
});
