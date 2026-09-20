const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { checkSocket, fabricEndpointUrls } = require('../src/fabric/gateway-manager');

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

test('repeated readiness checks destroy successful probe sockets', async (t) => {
    const connections = new Set();
    const server = net.createServer((socket) => {
        connections.add(socket);
        socket.once('close', () => connections.delete(socket));
    });
    t.after(() => {
        for (const socket of connections) socket.destroy();
        server.close();
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const { port } = server.address();
    for (let attempt = 0; attempt < 50; attempt += 1) {
        assert.deepEqual(await checkSocket('test', `tcp://127.0.0.1:${port}`), ['test', 'reachable']);
    }
    const deadline = Date.now() + 1000;
    while (connections.size && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(connections.size, 0);
});
