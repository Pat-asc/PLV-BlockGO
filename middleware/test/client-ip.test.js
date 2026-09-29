const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { clientIp, normalizeIp } = require('../src/shared/client-ip');

async function observedIp(trust, forwardedFor) {
    const app = express();
    app.set('trust proxy', trust);
    app.get('/', (req, res) => res.json({ ip: clientIp(req), protocol: req.protocol }));
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
        const headers = forwardedFor ? { 'x-forwarded-for': forwardedFor, 'x-forwarded-proto': 'https' } : {};
        return await (await fetch(`http://127.0.0.1:${server.address().port}/`, { headers })).json();
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

test('direct and missing-forwarded-header requests use the socket address', async () => {
    const result = await observedIp(['loopback'], null);
    assert.equal(result.ip, '127.0.0.1');
    assert.equal(result.protocol, 'http');
});

test('a trusted proxy supplies the original IPv4 client and protocol', async () => {
    const result = await observedIp(['loopback'], '203.0.113.25');
    assert.equal(result.ip, '203.0.113.25');
    assert.equal(result.protocol, 'https');
});

test('multiple trusted hops resolve from right to left', async () => {
    const result = await observedIp(['loopback', '35.191.0.0/16'], '203.0.113.25, 35.191.10.9');
    assert.equal(result.ip, '203.0.113.25');
});

test('an untrusted peer cannot spoof X-Forwarded-For or proto', async () => {
    const result = await observedIp(['10.72.0.0/16'], '203.0.113.99');
    assert.equal(result.ip, '127.0.0.1');
    assert.equal(result.protocol, 'http');
});

test('IPv4-mapped IPv6 is normalized while native IPv6 is preserved', () => {
    assert.equal(normalizeIp('::ffff:203.0.113.25'), '203.0.113.25');
    assert.equal(normalizeIp('2001:db8::25'), '2001:db8::25');
});
