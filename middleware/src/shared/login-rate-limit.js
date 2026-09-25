const { ipKeyGenerator } = require('express-rate-limit');

function normalizedLoginIdentity(req) {
    return String(req.body?.username || '').trim().toLowerCase() || '<missing-account>';
}

function loginSource(req) {
    // req.ip has already been resolved by Express's explicit trust-proxy policy.
    // Reading X-Forwarded-For or CF-Connecting-IP directly here would be spoofable.
    return ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
}

function loginAttemptKey(req) {
    return `${loginSource(req)}\u001f${normalizedLoginIdentity(req)}`;
}

function createLoginLimiter({ recordSecurityEvent, max = 5, sourceMax = Math.max(max * 20, 50), windowMs = 15 * 60 * 1000 }) {
    const accounts = new Map();
    const sources = new Map();
    const combined = new Map();
    const read = (map, key, now) => {
        const entry = map.get(key);
        if (!entry || entry.expiresAt <= now) { map.delete(key); return 0; }
        return entry.count;
    };
    const increment = (map, key, now) => {
        map.set(key, { count: read(map, key, now) + 1, expiresAt: now + windowMs });
    };

    return async function loginLimiter(req, res, next) {
        const now = Date.now();
        const account = normalizedLoginIdentity(req);
        const source = loginSource(req);
        const pair = `${source}\u001f${account}`;
        if (read(accounts, account, now) >= max || read(combined, pair, now) >= max || read(sources, source, now) >= sourceMax) {
            if (recordSecurityEvent) await recordSecurityEvent(req, 'LOGIN_RATE_LIMIT', 'HIGH', account,
                'Repeated failed login attempts exceeded an account or source safety threshold.');
            res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
            return res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
        }
        res.once('finish', () => {
            if (res.statusCode < 400) {
                accounts.delete(account);
                for (const key of combined.keys()) if (key.endsWith(`\u001f${account}`)) combined.delete(key);
            } else if (res.statusCode < 500) {
                const completedAt = Date.now();
                increment(accounts, account, completedAt);
                increment(sources, source, completedAt);
                increment(combined, pair, completedAt);
            }
        });
        return next();
    };
}

module.exports = { createLoginLimiter, loginAttemptKey, loginSource, normalizedLoginIdentity };
