const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const readRepositoryFile = (...parts) => fs.readFileSync(path.join(repositoryRoot, ...parts), 'utf8');

test('reset-password OpenAPI contract uses the active code field and documented responses', () => {
    const openapi = yaml.load(readRepositoryFile('security', 'openapi-ci.yaml'));
    const operation = openapi.paths['/api/reset-password'].post;
    const schema = operation.requestBody.content['application/json'].schema;

    assert.deepEqual(schema.required, ['email', 'code', 'newPassword']);
    assert.equal(schema.properties.code.pattern, '^[0-9]{6}$');
    assert.equal(schema.properties.otp, undefined);
    assert.equal(schema.additionalProperties, false);
    assert.match(operation.summary, /email verification code/i);
    assert.ok(operation.responses['200']);
    assert.ok(operation.responses['400']);
    assert.ok(operation.responses['429']);
    assert.equal(operation.responses['410'], undefined);
});

test('reset-password runtime accepts code and rejects the retired otp field', () => {
    const authService = readRepositoryFile('middleware', 'src', 'services', 'auth-service.js');
    const route = authService.slice(
        authService.indexOf("app.post('/api/reset-password'"),
        authService.indexOf("app.post('/api/password-reset-assistance'")
    );

    assert.match(route, /\['email', 'code', 'newPassword'\]\.includes\(key\)/);
    assert.match(route, /code:\s*req\.body\?\.code/);
    assert.doesNotMatch(route, /req\.body\?\.otp|['"]otp['"]/);
});

test('Schemathesis keeps all checks and filters only the exact nonexistent reset-code ST202', () => {
    const workflow = readRepositoryFile('.github', 'workflows', 'feature and api-endpoints-Testing.yml');
    const hooks = readRepositoryFile('security', 'schemathesis_hooks.py');
    const hookTests = readRepositoryFile('security', 'test_schemathesis_hooks.py');

    assert.match(workflow, /version:\s*4\.33\.1/);
    assert.match(workflow, /hooks:\s*security\.schemathesis_hooks/);
    assert.match(workflow, /checks:\s*all/);
    assert.match(workflow, /python3 -m unittest security\.test_schemathesis_hooks/);
    assert.match(hooks, /case\.path != RESET_PASSWORD_PATH/);
    assert.match(hooks, /str\(case\.method\)\.upper\(\) != "POST"/);
    assert.match(hooks, /getattr\(failure, "code", None\) != "ST202"/);
    assert.match(hooks, /"positive_data_acceptance" not in getattr\(failure, "checks", \(\)\)/);
    assert.match(hooks, /response\.status_code != 400/);
    assert.match(hooks, /response\.json\(\) == INVALID_OR_EXPIRED_CODE_RESPONSE/);
    assert.match(hookTests, /test_keeps_other_methods_paths_failure_codes_statuses_and_bodies/);
    assert.doesNotMatch(workflow, /exclude-checks|checks:\s*not_a_server_error/);
});

test('fresh CI bootstrap mirrors current password-reset and IP-tracking migrations', () => {
    const bootstrap = readRepositoryFile('network', 'init-db-schema.sql');
    const resetMigration = readRepositoryFile('migrations', '018_password_reset_tokens.sql');
    const authVersionMigration = readRepositoryFile('migrations', '020_auth_version.sql');
    const trackerMigration = readRepositoryFile('migrations', '026_ip_tracker_mappings.sql');

    for (const pattern of [
        /CREATE TABLE IF NOT EXISTS password_reset_tokens/,
        /token_hash CHAR\(64\) NOT NULL/,
        /requested_ip VARCHAR\(100\)/,
        /ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1/,
        /ADD CONSTRAINT ck_users_auth_version_positive CHECK \(auth_version > 0\)/,
        /CREATE TABLE IF NOT EXISTS ip_tracker_mappings/,
        /ip_address VARCHAR\(100\) NOT NULL UNIQUE/,
    ]) assert.match(bootstrap, pattern);

    assert.match(resetMigration, /CREATE TABLE IF NOT EXISTS password_reset_tokens/);
    assert.match(authVersionMigration, /ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1/);
    assert.match(trackerMigration, /CREATE TABLE IF NOT EXISTS ip_tracker_mappings/);
});
