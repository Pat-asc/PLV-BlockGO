const test = require('node:test');
const assert = require('node:assert/strict');

const { fabricEndpointUrls } = require('../src/fabric/gateway-manager');

function withEnvironment(values, action) {
    const original = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
    try {
        for (const [name, value] of Object.entries(values)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        return action();
    } finally {
        for (const [name, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

test('selected HA orderer client endpoints can be disabled without removing the primary', () => {
    withEnvironment({
        FABRIC_HA_ENABLED: 'true',
        FABRIC_DISABLED_ORDERERS: ' orderer5, orderer6, orderer '
    }, () => {
        const endpoints = fabricEndpointUrls();

        assert.ok(endpoints.orderer);
        assert.ok(endpoints.orderer2);
        assert.ok(endpoints.orderer3);
        assert.ok(endpoints.orderer4);
        assert.equal(endpoints.orderer5, undefined);
        assert.equal(endpoints.orderer6, undefined);
    });
});

test('HA orderer client endpoints remain enabled when the disable list is empty', () => {
    withEnvironment({ FABRIC_HA_ENABLED: 'true', FABRIC_DISABLED_ORDERERS: '' }, () => {
        const endpoints = fabricEndpointUrls();

        assert.ok(endpoints.orderer5);
        assert.ok(endpoints.orderer6);
    });
});
