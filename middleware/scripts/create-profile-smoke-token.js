const crypto = require('node:crypto');

const secret = String(process.env.JWT_SECRET || '').trim();
const email = String(process.env.ADMIN_EMAIL || '').trim();
if (!secret || !email) {
    throw new Error('JWT_SECRET and ADMIN_EMAIL are required.');
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    username: email,
    dbRole: 'system_admin',
    iat: now,
    exp: now + 300
})}`;
const key = crypto.createHash('sha256').update(secret).digest();
const signature = crypto.createHmac('sha256', key).update(unsigned).digest('base64url');

process.stdout.write(`${unsigned}.${signature}`);
