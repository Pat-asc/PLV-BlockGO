const nodemailer = require('nodemailer');

class PasswordResetEmailError extends Error {
    constructor(message = 'Password reset email could not be delivered.') {
        super(message);
        this.name = 'PasswordResetEmailError';
        this.status = 503;
    }
}

function booleanSetting(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function createEmailService(environment = process.env, mailer = nodemailer) {
    const host = environment.SMTP_HOST || environment.EMAIL_HOST;
    const port = Number(environment.SMTP_PORT || environment.EMAIL_PORT || 587);
    const user = environment.SMTP_USER || environment.EMAIL_USER;
    const pass = environment.SMTP_PASS || environment.EMAIL_PASS;
    const secure = booleanSetting(environment.SMTP_SECURE, port === 465);
    const from = environment.EMAIL_FROM || (user ? `"PLV BlockGO" <${user}>` : '');
    let transporter;

    function configured() {
        return Boolean(host && Number.isInteger(port) && port > 0 && user && pass && from);
    }

    async function sendPasswordResetCode({ to, code, expiresInMinutes }) {
        if (!configured()) throw new PasswordResetEmailError('Password reset email is temporarily unavailable.');
        try {
            transporter ||= mailer.createTransport({
                host,
                port,
                secure,
                requireTLS: !secure,
                auth: { user, pass },
                tls: { minVersion: 'TLSv1.2' }
            });
            await transporter.sendMail({
                from,
                to,
                subject: 'PLV BlockGO Password Reset',
                text: [
                    'A password reset was requested for your PLV BlockGO account.',
                    '',
                    'Use the verification code below:',
                    '',
                    code,
                    '',
                    `This code expires in ${expiresInMinutes} minutes.`,
                    '',
                    'If you did not request a password reset, you can ignore this email.'
                ].join('\n')
            });
        } catch {
            throw new PasswordResetEmailError();
        }
    }

    return { configured, sendPasswordResetCode };
}

module.exports = { PasswordResetEmailError, createEmailService };
