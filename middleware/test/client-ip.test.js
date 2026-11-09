const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { clientIp, normalizeIp } = require('../src/shared/client-ip');

async function observedIp(trust, forwardedFor, extraHeaders = {}) {
    const app = express();
    app.set('trust proxy', trust);
    app.get('/', (req, res) => res.json({ ip: clientIp(req), protocol: req.protocol }));
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
        const headers = forwardedFor ? { 'x-forwarded-for': forwardedFor, 'x-forwarded-proto': 'https' } : {};
        Object.assign(headers, extraHeaders);
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

test('the tracker preserves a 100.96 client address supplied by a trusted proxy', async () => {
    const result = await observedIp(['loopback'], '100.96.2.82');
    assert.equal(result.ip, '100.96.2.82');
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

test('a verified Cloudflare edge supplies the actual visitor IP', async () => {
    const previousHeader = process.env.TRUSTED_CLIENT_IP_HEADER;
    const previousCidrs = process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS;
    process.env.TRUSTED_CLIENT_IP_HEADER = 'cf-connecting-ip';
    process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS = '104.16.0.0/13,2606:4700::/32';
    try {
        const result = await observedIp(['loopback'], '104.16.10.20', { 'cf-connecting-ip': '112.200.236.67' });
        assert.equal(result.ip, '112.200.236.67');
    } finally {
        if (previousHeader === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
        else process.env.TRUSTED_CLIENT_IP_HEADER = previousHeader;
        if (previousCidrs === undefined) delete process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS;
        else process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS = previousCidrs;
    }
});

test('a non-Cloudflare client cannot spoof the trusted visitor header', async () => {
    const previousHeader = process.env.TRUSTED_CLIENT_IP_HEADER;
    const previousCidrs = process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS;
    process.env.TRUSTED_CLIENT_IP_HEADER = 'cf-connecting-ip';
    process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS = '104.16.0.0/13';
    try {
        const result = await observedIp(['loopback'], '198.51.100.44', { 'cf-connecting-ip': '112.200.236.67' });
        assert.equal(result.ip, '198.51.100.44');
    } finally {
        if (previousHeader === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
        else process.env.TRUSTED_CLIENT_IP_HEADER = previousHeader;
        if (previousCidrs === undefined) delete process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS;
        else process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS = previousCidrs;
    }
});

test('missing or invalid addresses remain unavailable instead of being fabricated', () => {
    assert.equal(clientIp({}), null);
    assert.equal(normalizeIp('not-an-ip-address'), null);
    assert.equal(normalizeIp(''), null);
});
