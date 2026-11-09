const net = require('net');
const proxyaddr = require('proxy-addr');

let trustedClientHeaderProxySetting;
let trustedClientHeaderProxyCidrs;

function normalizeIp(value) {
    const address = String(value || '').trim();
    if (!address) return null;
    if (address.toLowerCase().startsWith('::ffff:') && net.isIPv4(address.slice(7))) return address.slice(7);
    return net.isIP(address) ? address : null;
}

function clientIp(req) {
    const proxyResolvedIp = normalizeIp(req.ip) || normalizeIp(req.socket?.remoteAddress);
    if (!proxyResolvedIp) return null;

    const headerName = String(process.env.TRUSTED_CLIENT_IP_HEADER || '').trim().toLowerCase();
    const trustedProxyCidrs = String(process.env.TRUSTED_CLIENT_IP_PROXY_CIDRS || '').trim();
    if (!headerName || !trustedProxyCidrs) return proxyResolvedIp;

    if (trustedClientHeaderProxyCidrs !== trustedProxyCidrs) {
        trustedClientHeaderProxyCidrs = trustedProxyCidrs;
        trustedClientHeaderProxySetting = proxyaddr.compile(
            trustedProxyCidrs.split(',').map((value) => value.trim()).filter(Boolean)
        );
    }
    if (!trustedClientHeaderProxySetting(proxyResolvedIp, 0)) return proxyResolvedIp;

    const headerValue = req.headers?.[headerName];
    if (Array.isArray(headerValue)) return proxyResolvedIp;
    return normalizeIp(headerValue) || proxyResolvedIp;
}

function trustProxySetting() {
    const configured = String(process.env.TRUST_PROXY_CIDRS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return configured.length ? configured : ['loopback'];
}

module.exports = { clientIp, normalizeIp, trustProxySetting };
