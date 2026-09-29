const net = require('net');

function normalizeIp(value) {
    const address = String(value || '').trim();
    if (!address) return null;
    if (address.toLowerCase().startsWith('::ffff:') && net.isIPv4(address.slice(7))) return address.slice(7);
    return net.isIP(address) ? address : null;
}

function clientIp(req) {
    return normalizeIp(req.ip) || normalizeIp(req.socket?.remoteAddress);
}

function trustProxySetting() {
    const configured = String(process.env.TRUST_PROXY_CIDRS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return configured.length ? configured : ['loopback'];
}

module.exports = { clientIp, normalizeIp, trustProxySetting };
