const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { normalizeAuthRole } = require('./roles');
const { PasswordResetEmailError } = require('./email-service');

const CODE_TTL_MINUTES = 10;
const CODE_TTL_MS = CODE_TTL_MINUTES * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MAX_REQUESTS_PER_WINDOW = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const GENERIC_EMAIL_MESSAGE = 'If the account is eligible, password reset instructions have been sent to the registered email.';
const MANUAL_REQUEST_MESSAGE = 'If the account is eligible, a manual password recovery request is now pending with the Registrar.';

class PasswordResetError extends Error {
    constructor(message, status = 400, code = 'PASSWORD_RESET_FAILED') {
        super(message);
        this.name = 'PasswordResetError';
        this.status = status;
        this.code = code;
    }
}

function hashResetCode(code) {
    return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function eligibleRole(role) {
    return ['student', 'faculty'].includes(normalizeAuthRole(role));
}

function validateNewPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new PasswordResetError('The new password must be between 8 and 128 characters.');
    }
}

function createPasswordResetService({
    dbRead,
    dbWrite,
    emailService,
    bcryptImpl = bcrypt,
    now = () => Date.now(),
    generateCode = () => crypto.randomInt(100000, 1000000).toString()
}) {
    async function requestEmailReset({ email, requestedIp }) {
        const client = await dbWrite.connect();
        let transactionOpen = false;
        try {
            await client.query('BEGIN');
            transactionOpen = true;
            const accountResult = await client.query(`
                SELECT id, email, role, status, is_active
                  FROM users
                 WHERE LOWER(email) = LOWER($1)
                 LIMIT 1
                 FOR UPDATE`, [email]);
            const account = accountResult.rows[0];
            if (!account || account.is_active !== true || String(account.status).toLowerCase() !== 'approved' || !eligibleRole(account.role)) {
                await client.query('COMMIT');
                transactionOpen = false;
                return { message: GENERIC_EMAIL_MESSAGE, eligible: false, delivered: false };
            }

            const recent = await client.query(`
                SELECT COUNT(*)::int AS count
                  FROM password_reset_tokens
                 WHERE user_id = $1
                   AND created_at >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'`, [account.id]);
            if (Number(recent.rows[0]?.count || 0) >= MAX_REQUESTS_PER_WINDOW) {
                await client.query('COMMIT');
                transactionOpen = false;
                return { message: GENERIC_EMAIL_MESSAGE, eligible: true, delivered: false, rateLimited: true };
            }

            const code = String(generateCode()).padStart(6, '0');
            if (!/^\d{6}$/.test(code)) throw new Error('Reset code generator returned an invalid value.');
            const codeHash = hashResetCode(code);
            const expiresAt = new Date(now() + CODE_TTL_MS);
            await client.query(`
                UPDATE password_reset_tokens
                   SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
                 WHERE user_id = $1 AND used_at IS NULL`, [account.id]);
            await client.query(`
                INSERT INTO password_reset_tokens
                    (user_id, token_hash, expires_at, attempt_count, requested_ip)
                VALUES ($1, $2, $3, 0, $4)`, [account.id, codeHash, expiresAt, requestedIp || null]);

            await emailService.sendPasswordResetCode({
                to: account.email,
                code,
                expiresInMinutes: CODE_TTL_MINUTES
            });
            await client.query('COMMIT');
            transactionOpen = false;
            return { message: GENERIC_EMAIL_MESSAGE, eligible: true, delivered: true };
        } catch (error) {
            if (transactionOpen) await client.query('ROLLBACK');
            if (error instanceof PasswordResetEmailError) throw error;
            throw error;
        } finally {
            client.release();
        }
    }

    async function resetPassword({ email, code, newPassword }) {
        validateNewPassword(newPassword);
        if (!/^\d{6}$/.test(String(code || ''))) {
            throw new PasswordResetError('The verification code is invalid or expired.');
        }

        const client = await dbWrite.connect();
        let transactionOpen = false;
        try {
            await client.query('BEGIN');
            transactionOpen = true;
            const result = await client.query(`
                SELECT t.token_id, t.user_id, t.token_hash, t.expires_at, t.attempt_count,
                       u.role, u.status, u.is_active
                  FROM password_reset_tokens t
                  JOIN users u ON u.id = t.user_id
                 WHERE LOWER(u.email) = LOWER($1)
                   AND t.used_at IS NULL
                 ORDER BY t.created_at DESC
                 LIMIT 1
                 FOR UPDATE OF t, u`, [email]);
            const reset = result.rows[0];
            const stillEligible = reset && reset.is_active === true &&
                String(reset.status).toLowerCase() === 'approved' && eligibleRole(reset.role);
            if (!stillEligible) {
                await client.query('ROLLBACK');
                transactionOpen = false;
                throw new PasswordResetError('The verification code is invalid or expired.');
            }

            if (new Date(reset.expires_at).getTime() <= now()) {
                await client.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_id = $1', [reset.token_id]);
                await client.query('COMMIT');
                transactionOpen = false;
                throw new PasswordResetError('The verification code is invalid or expired.');
            }
            if (Number(reset.attempt_count) >= MAX_VERIFICATION_ATTEMPTS) {
                await client.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_id = $1', [reset.token_id]);
                await client.query('COMMIT');
                transactionOpen = false;
                throw new PasswordResetError('Too many verification attempts. Request a new code.', 429, 'PASSWORD_RESET_ATTEMPTS_EXCEEDED');
            }

            const submittedHash = Buffer.from(hashResetCode(code), 'hex');
            const storedHash = Buffer.from(String(reset.token_hash), 'hex');
            const matches = storedHash.length === submittedHash.length && crypto.timingSafeEqual(storedHash, submittedHash);
            if (!matches) {
                const nextAttempts = Number(reset.attempt_count) + 1;
                await client.query(`
                    UPDATE password_reset_tokens
                       SET attempt_count = $2,
                           used_at = CASE WHEN $2 >= $3 THEN CURRENT_TIMESTAMP ELSE used_at END
                     WHERE token_id = $1`, [reset.token_id, nextAttempts, MAX_VERIFICATION_ATTEMPTS]);
                await client.query('COMMIT');
                transactionOpen = false;
                if (nextAttempts >= MAX_VERIFICATION_ATTEMPTS) {
                    throw new PasswordResetError('Too many verification attempts. Request a new code.', 429, 'PASSWORD_RESET_ATTEMPTS_EXCEEDED');
                }
                throw new PasswordResetError('The verification code is invalid or expired.');
            }

            const passwordHash = await bcryptImpl.hash(newPassword, 10);
            await client.query(`
                UPDATE users
                   SET password_hash = $1,
                       password_reset_token = NULL,
                       password_reset_expires = NULL,
                       updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`, [passwordHash, reset.user_id]);
            await client.query(`
                UPDATE password_reset_tokens
                   SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
                 WHERE user_id = $1 AND used_at IS NULL`, [reset.user_id]);
            await client.query('COMMIT');
            transactionOpen = false;
            return { message: 'Password updated successfully. You can now sign in.', userId: reset.user_id };
        } catch (error) {
            if (transactionOpen) await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function requestManualAssistance({ email }) {
        const result = await dbRead.query(`
            SELECT id, email, role
              FROM users
             WHERE LOWER(email) = LOWER($1)
               AND is_active = TRUE
               AND LOWER(status) = 'approved'
             LIMIT 1`, [email]);
        const account = result.rows[0];
        if (account && eligibleRole(account.role)) {
            await dbWrite.query(`
                INSERT INTO password_reset_requests (user_id, email, request_status, request_reason)
                VALUES ($1, $2, 'PENDING', 'Manual assistance requested from the sign-in page.')
                ON CONFLICT (user_id) WHERE request_status IN ('PENDING', 'APPROVED')
                DO NOTHING`, [account.id, account.email]);
        }
        return { message: MANUAL_REQUEST_MESSAGE, eligible: Boolean(account && eligibleRole(account.role)) };
    }

    return { requestEmailReset, requestManualAssistance, resetPassword };
}

module.exports = {
    CODE_TTL_MINUTES,
    CODE_TTL_MS,
    GENERIC_EMAIL_MESSAGE,
    MANUAL_REQUEST_MESSAGE,
    MAX_REQUESTS_PER_WINDOW,
    MAX_VERIFICATION_ATTEMPTS,
    PasswordResetError,
    createPasswordResetService,
    eligibleRole,
    hashResetCode,
    validateNewPassword
};
