const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmailService, PasswordResetEmailError } = require('../src/shared/email-service');

const environment = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'user', SMTP_PASS: 'pass', EMAIL_FROM: 'sender@example.test' };

test('SMTP health verifies the configured TLS transport without sending mail', async () => {
  let verified = 0;
  let sent = 0;
  const service = createEmailService(environment, { createTransport: () => ({ verify: async () => { verified += 1; }, sendMail: async () => { sent += 1; } }) });
  assert.equal(await service.verifyConnection(), true);
  assert.equal(verified, 1);
  assert.equal(sent, 0);
});

test('SMTP health sanitizes configuration and transport failures', async () => {
  const service = createEmailService(environment, { createTransport: () => ({ verify: async () => { throw new Error('credential detail'); } }) });
  await assert.rejects(service.verifyConnection(), (error) => error instanceof PasswordResetEmailError && !error.message.includes('credential detail'));
});
