const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { closePools, getPools } = require('../shared/database');
const { jwtKey, required, serviceUrl, corsOrigins } = require('../shared/config');
const { requireInternalKey } = require('../shared/auth');
const { requestJson } = require('../shared/internal-http');
const createLogger = require('../shared/logger');
const { normalizeAuthRole } = require('../shared/roles');
const { createLoginLimiter } = require('../shared/login-rate-limit');
const { createEmailService, PasswordResetEmailError } = require('../shared/email-service');
const { createPasswordResetLimiter } = require('../shared/password-reset-rate-limit');
const { PasswordResetError, createPasswordResetService } = require('../shared/password-reset-service');
const { validatePassword } = require('../shared/password-policy');
const { createServiceApp, installErrorHandler, listen } = require('../shared/service-app');
const { clientIp } = require('../shared/client-ip');
const { bootstrapAccounts } = require('../shared/bootstrap-service');

const serviceName = 'auth-service';
const logger = createLogger(serviceName);
const { app } = createServiceApp(serviceName, logger);
const { read: dbRead, write: dbWrite } = getPools();
const emailService = createEmailService();

async function recordSecurityEvent(req, eventType, severity, attemptedIdentity, details) {
    const verifiedIp = clientIp(req);
    let client;
    let committed = false;
    try {
        client = await dbWrite.connect();
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(2026100702)');
        if (verifiedIp) {
            await client.query(
                `INSERT INTO ip_tracker_mappings (tracker_id, ip_address)
                 SELECT COALESCE(MAX(tracker_id), 0) + 1, $1
                   FROM ip_tracker_mappings
                 HAVING NOT EXISTS (
                     SELECT 1 FROM ip_tracker_mappings WHERE ip_address = $1
                 )`,
                [verifiedIp]
            );
        }
        await client.query(
            `WITH inserted AS (
             INSERT INTO security_events
                (event_type, severity, attempted_identity, ip_address, request_path, request_method, details)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING security_event_id, event_type, severity, attempted_identity, created_at
             )
             SELECT pg_notify('blockgo_security_event', json_build_object(
                'eventId', security_event_id,
                'eventType', event_type,
                'severity', severity,
                'attemptedIdentity', attempted_identity,
                'createdAt', created_at
             )::text) FROM inserted`,
            [eventType, severity, attemptedIdentity || null, verifiedIp, req.originalUrl || req.path, req.method, details]
        );
        await client.query('COMMIT');
        committed = true;
    } catch (error) {
        if (client && !committed) await client.query('ROLLBACK').catch(() => {});
        logger.warn({ err: error, eventType }, 'Security event could not be persisted');
    } finally {
        client?.release();
    }
}

async function recordLoginAudit(req, account, role) {
    try {
        await dbWrite.query(
            `INSERT INTO audit_logs
                (user_id, actor_role, action, entity_type, entity_id, new_values, description, ip_address, timestamp)
             VALUES ($1, $2, 'LOGIN_SUCCESS', 'authentication', $3,
                     '{"result":"success"}', $4, $5, CURRENT_TIMESTAMP)`,
            [account.id, role, String(account.id),
                role === 'system_admin' ? 'System Administrator login succeeded.' : 'Account login succeeded.',
                clientIp(req)]
        );
    } catch (error) {
        logger.warn({ err: error, accountId: account.id }, 'Successful login audit could not be persisted');
    }
}

async function activeUser(username) {
    if (!username) return null;
    const result = await dbRead.query(
        `SELECT u.id, u.email, u.role, u.status, u.is_active, u.auth_version,
                ap.department, p.program_code, p.program_name
           FROM users u
           LEFT JOIN adminprofiles ap ON ap.user_id = u.id
           LEFT JOIN academic_programs p
             ON LOWER(p.program_name) = LOWER(ap.department)
             OR LOWER(p.program_code) = LOWER(ap.department)
          WHERE LOWER(u.email) = LOWER($1)
            AND LOWER(u.status) = 'approved'
            AND u.is_active = TRUE
          LIMIT 1`,
        [username]
    );
    if (!result.rows.length) return null;
    const user = result.rows[0];
    return {
        id: user.id,
        username: user.email,
        email: user.email,
        dbRole: normalizeAuthRole(user.role),
        authVersion: Number(user.auth_version || 1),
        scope: {
            department: user.department || null,
            programCode: user.program_code || null,
            programName: user.program_name || null
        }
    };
}

const loginLimiter = createLoginLimiter({ recordSecurityEvent });
const passwordResetService = createPasswordResetService({ dbRead, dbWrite, emailService });
const forgotPasswordLimiter = createPasswordResetLimiter({
    max: 5,
    eventType: 'PASSWORD_RESET_RATE_LIMITED',
    recordSecurityEvent
});
const verifyPasswordResetLimiter = createPasswordResetLimiter({
    max: 10,
    eventType: 'PASSWORD_RESET_VERIFICATION_RATE_LIMITED',
    recordSecurityEvent
});
const manualAssistanceLimiter = createPasswordResetLimiter({
    max: 5,
    eventType: 'PASSWORD_RESET_ASSISTANCE_RATE_LIMITED',
    recordSecurityEvent
});

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
        if (typeof username !== 'string' || typeof password !== 'string' || /[\u0000-\u001f\u007f]/.test(username) || /[\u0000-\u001f\u007f]/.test(password)) {
            return res.status(400).json({ error: 'Username and password contain invalid characters.' });
        }
        const normalizedUsername = String(username).trim().toLowerCase();
        const baseUsername = normalizedUsername.split('@')[0];
        const result = await dbRead.query(`
            SELECT u.*, sp.student_no
              FROM users u
              LEFT JOIN studentprofiles sp ON u.id = sp.user_id
             WHERE LOWER(u.email) = $1 OR LOWER(sp.student_no) = $1
                OR LOWER(u.email) = $2 OR LOWER(sp.student_no) = $2
             ORDER BY CASE
                WHEN LOWER(u.email) = $1 THEN 1 WHEN LOWER(sp.student_no) = $1 THEN 2
                WHEN LOWER(u.email) = $2 THEN 3 WHEN LOWER(sp.student_no) = $2 THEN 4 ELSE 5 END
             LIMIT 1`, [normalizedUsername, baseUsername]);
        if (!result.rows.length) {
            await recordSecurityEvent(req, 'FAILED_LOGIN', 'MEDIUM', normalizedUsername, 'Login failed for an unknown account identifier.');
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const account = result.rows[0];
        if (String(account.status).toLowerCase() !== 'approved' || account.is_active === false) {
            await recordSecurityEvent(req, 'INACTIVE_ACCOUNT_LOGIN', 'HIGH', account.email, 'A login was attempted for an inactive or unapproved account.');
            return res.status(403).json({ error: 'Account is not active or has not been approved.' });
        }
        if (!await bcrypt.compare(password, account.password_hash)) {
            await recordSecurityEvent(req, 'FAILED_LOGIN', 'MEDIUM', account.email, 'Login failed because the password did not match.');
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const role = normalizeAuthRole(account.role);
        if (role !== 'system_admin') {
            await requestJson(`${serviceUrl('IDENTITY_SERVICE_URL', 'fabric-identity-service', 4002)}/internal/identities/ensure`, {
                method: 'POST', timeoutMs: 45000,
                headers: { 'x-api-key': required('INTERNAL_API_KEY') },
                body: { username: account.email, password, role }
            });
        }
        const payload = { username: account.email, dbRole: role, authVersion: Number(account.auth_version || 1) };
        const jwtOptions = { expiresIn: process.env.JWT_EXPIRES_IN || '12h' };
        if (process.env.JWT_ISSUER) jwtOptions.issuer = process.env.JWT_ISSUER;
        if (process.env.JWT_AUDIENCE) jwtOptions.audience = process.env.JWT_AUDIENCE;
        const token = jwt.sign(payload, jwtKey(), jwtOptions);
        await recordSecurityEvent(req, 'LOGIN_SUCCESS', 'LOW', account.email,
            role === 'system_admin' ? 'System Administrator login succeeded.' : 'Account login succeeded.');
        await recordLoginAudit(req, account, role);
        res.status(200).json({ status: 'success', token, message: role === 'system_admin' ? 'System administrator logged in successfully.' : 'Use this token in the Authorization header: Bearer <token>' });
    } catch (error) {
        logger.error({ err: error }, 'Login failed');
        res.status(error.status && error.status < 500 ? error.status : 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message });
    }
});

app.post('/internal/auth/introspect', requireInternalKey, async (req, res) => {
    const originalRequest = {
        ip: req.body?.sourceIp,
        originalUrl: req.body?.requestPath,
        path: req.body?.requestPath,
        method: req.body?.requestMethod
    };
    let decoded;
    try {
        decoded = jwt.verify(req.body?.token, jwtKey());
    } catch (error) {
        const attempted = jwt.decode(req.body?.token || '')?.username || null;
        await recordSecurityEvent(originalRequest, 'INVALID_ACCESS_TOKEN', 'MEDIUM', attempted, 'An invalid or expired bearer token was rejected.');
        return res.status(403).json({ error: 'Invalid, expired, or revoked token.' });
    }
    try {
        const user = await activeUser(decoded.username || decoded.email);
        if (!user || user.dbRole !== normalizeAuthRole(decoded.dbRole || decoded.role) ||
            user.authVersion !== Number(decoded.authVersion || 1)) {
            await recordSecurityEvent(originalRequest, 'REVOKED_ACCOUNT_TOKEN', 'HIGH', decoded.username || decoded.email, 'A token for an inactive, renamed, or role-changed account was rejected.');
            return res.status(403).json({ error: 'This account is inactive, changed, or no longer authorized.' });
        }
        return res.json({ active: true, user: { ...decoded, ...user } });
    } catch (error) {
        logger.error({ err: error }, 'Active-account introspection failed');
        return res.status(503).json({ error: 'Account validation is temporarily unavailable.' });
    }
});

app.post('/internal/auth/identity', requireInternalKey, async (req, res) => {
    const user = await activeUser(req.body?.username);
    if (!user) return res.status(404).json({ error: 'Active account not found.' });
    res.json({ user });
});

const passwordHashLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
        error: 'Too many requests, please try again later.'
    })
});
app.post('/api/crypto/hash-password', passwordHashLimiter, async (req, res) => {
    const unexpectedFields = Object.keys(req.body || {}).filter((key) => key !== 'password');
    if (unexpectedFields.length) return res.status(400).json({ error: 'Unexpected request fields are not allowed.' });
    const password = req.body?.password;
    if (!password) return res.status(400).json({ error: 'Password is required.' });
    const policyError = validatePassword(password);
    if (policyError) return res.status(400).json({ error: policyError });
    res.json({ hash: await bcrypt.hash(password, 10) });
});

app.post('/api/forgot-password', forgotPasswordLimiter, async (req, res) => {
    const unexpectedFields = Object.keys(req.body || {}).filter((key) => key !== 'email');
    if (unexpectedFields.length) return res.status(400).json({ error: 'Unexpected request fields are not allowed.' });
    if (typeof req.body?.email !== 'string') return res.status(400).json({ error: 'Account identifier must be a string.' });
    const email = req.body.email.trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Account identifier is required.' });
    if (email.length > 255 || /[\u0000-\u001f\u007f]/.test(email)) return res.status(400).json({ error: 'Account identifier is invalid.' });
    await recordSecurityEvent(req, 'PASSWORD_RESET_REQUESTED', 'LOW', email,
        'A public self-service password reset was requested.');
    try {
        const result = await passwordResetService.requestEmailReset({ email, requestedIp: clientIp(req) });
        if (result.delivered) {
            await recordSecurityEvent(req, 'PASSWORD_RESET_EMAIL_SENT', 'LOW', email,
                'A password reset email was delivered to an eligible account.');
        } else if (result.rateLimited) {
            await recordSecurityEvent(req, 'PASSWORD_RESET_RATE_LIMITED', 'HIGH', email,
                'The account-level password reset issuance limit was exceeded.');
        }
        return res.json({ message: result.message });
    } catch (error) {
        if (error instanceof PasswordResetEmailError) {
            await recordSecurityEvent(req, 'PASSWORD_RESET_EMAIL_FAILED', 'MEDIUM', email,
                'Password reset email delivery failed; no new recovery code was committed.');
            return res.status(503).json({
                error: 'Password reset email could not be delivered at this time. Please try again later or request manual assistance.'
            });
        }
        throw error;
    }
});

app.get('/internal/smtp-health', requireInternalKey, async (req, res) => {
    try {
        await emailService.verifyConnection();
        res.json({ status: 'ready', smtp: 'authenticated' });
    } catch (error) {
        logger.warn({ error: error.name }, 'SMTP transport verification failed');
        res.status(503).json({ status: 'not_ready', smtp: 'unavailable' });
    }
});

app.post('/api/reset-password', verifyPasswordResetLimiter, async (req, res) => {
    const unexpectedFields = Object.keys(req.body || {}).filter((key) => !['email', 'code', 'newPassword'].includes(key));
    if (unexpectedFields.length) return res.status(400).json({ error: 'Unexpected request fields are not allowed.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    try {
        const result = await passwordResetService.resetPassword({
            email,
            code: req.body?.code,
            newPassword: req.body?.newPassword
        });
        await recordSecurityEvent(req, 'PASSWORD_RESET_COMPLETED', 'LOW', email,
            'An eligible account completed self-service password recovery.');
        return res.json({ message: result.message });
    } catch (error) {
        if (error instanceof PasswordResetError) {
            await recordSecurityEvent(req, 'PASSWORD_RESET_VERIFICATION_FAILED', 'MEDIUM', email,
                'A password reset verification attempt failed.');
            return res.status(error.status).json({ error: error.message });
        }
        throw error;
    }
});

app.post('/api/password-reset-assistance', manualAssistanceLimiter, async (req, res) => {
    const unexpectedFields = Object.keys(req.body || {}).filter((key) => key !== 'email');
    if (unexpectedFields.length) return res.status(400).json({ error: 'Unexpected request fields are not allowed.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || email.length > 255 || /[\u0000-\u001f\u007f]/.test(email)) return res.status(400).json({ error: 'A valid account identifier is required.' });
    const result = await passwordResetService.requestManualAssistance({ email });
    await recordSecurityEvent(req, 'PASSWORD_RESET_ASSISTANCE_REQUESTED', 'LOW', email,
        'A manual password recovery request was submitted; the public response remains generic.');
    return res.json({ message: result.message });
});

app.get('/api/bootstrap', requireInternalKey, async (req, res) => {
    const systemEmail = process.env.BOOTSTRAP_SYSTEM_ADMIN_EMAIL || 'system-admin@plv.edu.ph';
    const systemPassword = process.env.BOOTSTRAP_SYSTEM_ADMIN_PASS || 'sysadmin123';
    const registrarEmail = process.env.BOOTSTRAP_REGISTRAR_EMAIL || 'registrar@plv.edu.ph';
    const registrarPassword = process.env.BOOTSTRAP_REGISTRAR_PASS || 'adminpw';
    const result = await bootstrapAccounts({
        dbWrite,
        hashPassword: (password) => bcrypt.hash(password, 10),
        systemEmail,
        systemPassword,
        registrarEmail,
        registrarPassword,
        bootstrapRegistrarIdentity: async ({ username, password }) => {
            await requestJson(`${serviceUrl('IDENTITY_SERVICE_URL', 'fabric-identity-service', 4002)}/internal/identities/bootstrap-registrar`, {
                method: 'POST', timeoutMs: 45000,
                headers: { 'x-api-key': required('INTERNAL_API_KEY') },
                body: { username, password }
            });
        }
    });
    res.json({ status: 'success', message: 'System administrator and registrar bootstrap is complete.', data: result });
});

app.get('/api/ready', async (req, res) => {
    try { await dbRead.query('SELECT 1'); res.json({ status: 'ready', database: 'connected' }); }
    catch { res.status(503).json({ status: 'not_ready', database: 'unavailable' }); }
});

installErrorHandler(app, logger);
listen(app, serviceName, 4001, logger, closePools);
