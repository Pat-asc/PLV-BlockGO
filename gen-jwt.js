const crypto = require('crypto');

function base64url(str) {
    return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const header = { alg: 'HS256', typ: 'JWT' };
const payload = {
    userId: 2,
    email: 'registrar@plv.edu.ph',
    username: 'registrar@plv.edu.ph',
    role: 'registrar',
    dbRole: 'registrar',
    department: '',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
};

const rawSecret = '69d19178f703d20d9e17e207d0d8b3cc4712718f48532c7227498ea9d438a774';
const hashedSecret = crypto.createHash('sha256').update(rawSecret).digest();

const head = base64url(JSON.stringify(header));
const body = base64url(JSON.stringify(payload));
const signature = crypto.createHmac('sha256', hashedSecret)
    .update(head + '.' + body)
    .digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

console.log(head + '.' + body + '.' + signature);
