const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

function normalizedResetEmail(req) {
    return String(req.body?.email || '').trim().toLowerCase() || '<missing-email>';
}

function resetRequestKey(req) {
    const source = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
    return `${source}\u001f${normalizedResetEmail(req)}`;
}

function createPasswordResetLimiter({ max, windowMs = 15 * 60 * 1000, eventType, recordSecurityEvent }) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: resetRequestKey,
        handler: async (req, res) => {
            if (recordSecurityEvent) {
                await recordSecurityEvent(req, eventType, 'HIGH', normalizedResetEmail(req),
                    'A password recovery rate limit was exceeded.');
            }
            res.status(429).json({ error: 'Too many password recovery attempts. Please try again later.' });
        }
    });
}

module.exports = { createPasswordResetLimiter, normalizedResetEmail, resetRequestKey };
