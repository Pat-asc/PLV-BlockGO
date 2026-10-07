const SYSTEM_ADMIN_ROLE = 'system_admin';
const REGISTRAR_ROLE = 'registrar';
const BOOTSTRAP_LOCK_ID = 2026100701;

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function requireSingleAccount(rows, email, expectedRole) {
    if (rows.length > 1) {
        throw new Error(`Bootstrap found duplicate accounts for '${email}'. Resolve the duplicate records before continuing.`);
    }
    if (!rows.length) return null;
    const account = rows[0];
    if (String(account.role || '').trim().toLowerCase() !== expectedRole) {
        throw new Error(`Bootstrap account '${email}' exists with an unexpected role and was not modified.`);
    }
    return account;
}

async function findAccount(client, email) {
    const result = await client.query(
        `SELECT id, email, password_hash, role, status, is_active, auth_version
           FROM users
          WHERE LOWER(email) = LOWER($1)
          ORDER BY id
          FOR UPDATE`,
        [email]
    );
    return result.rows;
}

async function createAccount(client, { email, password, role, fullName, department }, hashPassword) {
    const passwordHash = await hashPassword(password);
    const result = await client.query(
        `INSERT INTO users (email, password_hash, role, status, is_active)
         VALUES ($1, $2, $3, 'APPROVED', TRUE)
         RETURNING id, email, password_hash, role, status, is_active, auth_version`,
        [email, passwordHash, role]
    );
    await client.query(
        `INSERT INTO adminprofiles (user_id, full_name, admin_level, department)
         VALUES ($1, $2, $3, $4)`,
        [result.rows[0].id, fullName, role, department || null]
    );
    return result.rows[0];
}

async function bootstrapAccounts({
    dbWrite,
    hashPassword,
    systemEmail,
    systemPassword,
    registrarEmail,
    registrarPassword,
    bootstrapRegistrarIdentity
}) {
    const normalizedSystemEmail = normalizeEmail(systemEmail);
    const normalizedRegistrarEmail = normalizeEmail(registrarEmail);
    if (!normalizedSystemEmail || !normalizedRegistrarEmail) throw new Error('Bootstrap account emails are required.');

    const client = await dbWrite.connect();
    let committed = false;
    let systemCreated = false;
    let registrarCreated = false;
    let registrar;
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK_ID]);

        let system = requireSingleAccount(
            await findAccount(client, normalizedSystemEmail), normalizedSystemEmail, SYSTEM_ADMIN_ROLE);
        if (!system) {
            system = await createAccount(client, {
                email: normalizedSystemEmail,
                password: systemPassword,
                role: SYSTEM_ADMIN_ROLE,
                fullName: 'System Administrator'
            }, hashPassword);
            systemCreated = true;
        }

        registrar = requireSingleAccount(
            await findAccount(client, normalizedRegistrarEmail), normalizedRegistrarEmail, REGISTRAR_ROLE);
        if (!registrar) {
            registrar = await createAccount(client, {
                email: normalizedRegistrarEmail,
                password: registrarPassword,
                role: REGISTRAR_ROLE,
                fullName: 'System Registrar',
                department: 'Registrar'
            }, hashPassword);
            registrarCreated = true;
        }

        await client.query('COMMIT');
        committed = true;
    } catch (error) {
        if (!committed) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    const registrarIsActive = String(registrar.role || '').toLowerCase() === REGISTRAR_ROLE &&
        String(registrar.status || '').toLowerCase() === 'approved' && registrar.is_active !== false;
    if (registrarIsActive) {
        await bootstrapRegistrarIdentity({ username: normalizedRegistrarEmail, password: registrarPassword });
    }

    return { systemCreated, registrarCreated };
}

module.exports = { BOOTSTRAP_LOCK_ID, bootstrapAccounts, normalizeEmail, requireSingleAccount };
