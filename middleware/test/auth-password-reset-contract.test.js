const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const fs = require('node:fs');
const path = require('node:path');
const { PasswordResetEmailError } = require('../src/shared/email-service');
const {
    CODE_TTL_MS, GENERIC_EMAIL_MESSAGE, MAX_VERIFICATION_ATTEMPTS,
    PasswordResetError, createPasswordResetService, hashResetCode
} = require('../src/shared/password-reset-service');

function harness({ role = 'student', status = 'APPROVED', active = true, exists = true, smtpFailure = false } = {}) {
    let clock = Date.parse('2026-09-25T00:00:00Z');
    const account = exists ? {
        id: 7, email: 'person@plv.edu.ph', role, status, is_active: active,
        password_hash: bcrypt.hashSync('OldPassword1!', 4)
    } : null;
    const state = { tokens: [], manualRequests: [], sent: [] };
    let snapshot;

    const query = async (sql, params = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized === 'BEGIN') {
            snapshot = { tokens: structuredClone(state.tokens), password_hash: account?.password_hash };
            return { rows: [] };
        }
        if (normalized === 'COMMIT') { snapshot = undefined; return { rows: [] }; }
        if (normalized === 'ROLLBACK') {
            state.tokens = snapshot?.tokens || state.tokens;
            if (account && snapshot) account.password_hash = snapshot.password_hash;
            snapshot = undefined;
            return { rows: [] };
        }
        if ((normalized.includes('SELECT id, email, role, status, is_active') || normalized.includes('SELECT id, email, role')) && normalized.includes('FROM users')) {
            return { rows: account && account.email === String(params[0]).toLowerCase() ? [{ ...account }] : [] };
        }
        if (normalized.includes('COUNT(*)::int AS count')) {
            return { rows: [{ count: state.tokens.filter((item) => item.user_id === params[0] && clock - item.created_at < 15 * 60 * 1000).length }] };
        }
        if (normalized.startsWith('UPDATE password_reset_tokens') && normalized.includes('WHERE user_id = $1 AND used_at IS NULL')) {
            for (const token of state.tokens) if (token.user_id === params[0] && !token.used_at) token.used_at = clock;
            return { rows: [] };
        }
        if (normalized.startsWith('INSERT INTO password_reset_tokens')) {
            state.tokens.push({ token_id: state.tokens.length + 1, user_id: params[0], token_hash: params[1],
                expires_at: params[2], attempt_count: 0, requested_ip: params[3], used_at: null, created_at: clock });
            return { rows: [] };
        }
        if (normalized.includes('SELECT t.token_id') && normalized.includes('FROM password_reset_tokens')) {
            const token = [...state.tokens].reverse().find((item) => !item.used_at);
            return { rows: token && account && account.email === String(params[0]).toLowerCase()
                ? [{ ...token, role: account.role, status: account.status, is_active: account.is_active }] : [] };
        }
        if (normalized.startsWith('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_id')) {
            const token = state.tokens.find((item) => item.token_id === params[0]);
            if (token) token.used_at = clock;
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE password_reset_tokens') && normalized.includes('attempt_count = $2')) {
            const token = state.tokens.find((item) => item.token_id === params[0]);
            if (token) { token.attempt_count = params[1]; if (params[1] >= params[2]) token.used_at = clock; }
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE users') && normalized.includes('SET password_hash = $1')) {
            account.password_hash = params[0];
            return { rows: [] };
        }
        if (normalized.includes('INSERT INTO password_reset_requests')) {
            state.manualRequests.push({ userId: params[0], email: params[1] });
            return { rows: [] };
        }
        throw new Error(`Unhandled test SQL: ${normalized}`);
    };

    const client = { query, release() {} };
    const dbWrite = { connect: async () => client, query };
    const dbRead = { query };
    const emailService = { async sendPasswordResetCode(message) {
        if (smtpFailure) throw new PasswordResetEmailError();
        state.sent.push(message);
    } };
    const service = createPasswordResetService({ dbRead, dbWrite, emailService,
        now: () => clock, generateCode: () => '123456' });
    return { account, service, state, advance: (milliseconds) => { clock += milliseconds; } };
}

test('1. Student can request SMTP reset', async () => {
    const h = harness({ role: 'student' });
    const result = await h.service.requestEmailReset({ email: h.account.email, requestedIp: '192.0.2.1' });
    assert.equal(result.delivered, true); assert.equal(h.state.sent.length, 1);
});

test('2. Faculty can request SMTP reset', async () => {
    const h = harness({ role: 'faculty' });
    assert.equal((await h.service.requestEmailReset({ email: h.account.email })).delivered, true);
});

for (const [number, role, label] of [[3, 'registrar', 'Registrar'], [4, 'system_admin', 'System Administrator'], [5, 'department_admin', 'Chairperson']]) {
    test(`${number}. ${label} cannot use self-service reset`, async () => {
        const h = harness({ role });
        const result = await h.service.requestEmailReset({ email: h.account.email });
        assert.equal(result.message, GENERIC_EMAIL_MESSAGE); assert.equal(result.eligible, false);
        assert.equal(h.state.tokens.length, 0); assert.equal(h.state.sent.length, 0);
    });
}

test('6. Unknown email receives the generic response', async () => {
    const h = harness({ exists: false });
    assert.equal((await h.service.requestEmailReset({ email: 'unknown@plv.edu.ph' })).message, GENERIC_EMAIL_MESSAGE);
});

test('7. Disabled Student receives generic response and no token', async () => {
    const h = harness({ role: 'student', active: false });
    assert.equal((await h.service.requestEmailReset({ email: h.account.email })).eligible, false);
    assert.equal(h.state.tokens.length, 0);
});

test('8. Unapproved Faculty receives generic response and no token', async () => {
    const h = harness({ role: 'faculty', status: 'PENDING' });
    assert.equal((await h.service.requestEmailReset({ email: h.account.email })).eligible, false);
    assert.equal(h.state.tokens.length, 0);
});

test('9. Verification code expires after ten minutes', async () => {
    const h = harness(); await h.service.requestEmailReset({ email: h.account.email }); h.advance(CODE_TTL_MS + 1);
    await assert.rejects(h.service.resetPassword({ email: h.account.email, code: '123456', newPassword: 'NewPassword1!' }), PasswordResetError);
});

test('10. Verification code is single-use', async () => {
    const h = harness(); await h.service.requestEmailReset({ email: h.account.email });
    await h.service.resetPassword({ email: h.account.email, code: '123456', newPassword: 'NewPassword1!' });
    await assert.rejects(h.service.resetPassword({ email: h.account.email, code: '123456', newPassword: 'AnotherPassword1!' }), PasswordResetError);
});

test('11. Wrong code cannot reset the password', async () => {
    const h = harness(); const original = h.account.password_hash;
    await h.service.requestEmailReset({ email: h.account.email });
    await assert.rejects(h.service.resetPassword({ email: h.account.email, code: '654321', newPassword: 'NewPassword1!' }), PasswordResetError);
    assert.equal(h.account.password_hash, original);
});

test('12. Five failed verification attempts revoke the code', async () => {
    const h = harness(); await h.service.requestEmailReset({ email: h.account.email });
    for (let attempt = 1; attempt <= MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
        await assert.rejects(h.service.resetPassword({ email: h.account.email, code: '654321', newPassword: 'NewPassword1!' }));
    }
    assert.equal(h.state.tokens[0].attempt_count, 5); assert.ok(h.state.tokens[0].used_at);
});

test('13. New password is bcrypt hashed', async () => {
    const h = harness(); await h.service.requestEmailReset({ email: h.account.email });
    await h.service.resetPassword({ email: h.account.email, code: '123456', newPassword: 'NewPassword1!' });
    assert.match(h.account.password_hash, /^\$2[aby]\$/);
});

test('14. Raw verification code is never stored', async () => {
    const h = harness(); await h.service.requestEmailReset({ email: h.account.email });
    assert.equal(h.state.tokens[0].token_hash, hashResetCode('123456')); assert.notEqual(h.state.tokens[0].token_hash, '123456');
});

test('15. Raw code has no auth-service logging path', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'auth-service.js'), 'utf8');
    assert.doesNotMatch(source, /logger\.[a-z]+\([^\n]*(?:code|newPassword)/i);
    assert.doesNotMatch(source, /recordSecurityEvent\([^;]*(?:req\.body\?\.code|newPassword)/s);
});

test('16. Successful reset permits the new password', async () => {
    const h = harness(); await h.service.requestEmailReset({ email: h.account.email });
    await h.service.resetPassword({ email: h.account.email, code: '123456', newPassword: 'NewPassword1!' });
    assert.equal(await bcrypt.compare('NewPassword1!', h.account.password_hash), true);
});

test('17. Old password no longer works after reset', async () => {
    const h = harness(); await h.service.requestEmailReset({ email: h.account.email });
    await h.service.resetPassword({ email: h.account.email, code: '123456', newPassword: 'NewPassword1!' });
    assert.equal(await bcrypt.compare('OldPassword1!', h.account.password_hash), false);
});

test('18. Manual Registrar fallback remains separate and explicit', async () => {
    const h = harness({ role: 'student' }); await h.service.requestManualAssistance({ email: h.account.email });
    assert.equal(h.state.manualRequests.length, 1); assert.equal(h.state.tokens.length, 0);
});

test('19. SMTP failure rolls back the new recovery code', async () => {
    const h = harness({ smtpFailure: true }); const original = h.account.password_hash;
    await assert.rejects(h.service.requestEmailReset({ email: h.account.email }), PasswordResetEmailError);
    assert.equal(h.state.tokens.length, 0); assert.equal(h.account.password_hash, original);
});

test('20. Password recovery contains no Fabric or IPFS calls', () => {
    const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'auth-service.js'), 'utf8');
    const recoveryRoutes = authSource.slice(authSource.indexOf("app.post('/api/forgot-password'"), authSource.indexOf("app.get('/api/bootstrap'"));
    const recoveryService = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'password-reset-service.js'), 'utf8');
    assert.doesNotMatch(`${recoveryRoutes}\n${recoveryService}`, /fabric|ipfs|chaincode|_blockchainService/i);
});
