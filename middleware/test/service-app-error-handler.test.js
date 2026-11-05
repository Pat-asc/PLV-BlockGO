const test = require('node:test');
const assert = require('node:assert/strict');
const { createServiceApp, installErrorHandler } = require('../src/shared/service-app');

test('malformed JSON returns a generic 400 without parser details or a stack trace', async (context) => {
    const warnings = [];
    const errors = [];
    const logger = {
        warn: (...args) => warnings.push(args),
        error: (...args) => errors.push(args)
    };
    const { app } = createServiceApp('json-error-test', logger);
    app.post('/api/reset-password', (req, res) => res.json({ ok: true }));
    installErrorHandler(app, logger);
    const server = app.listen(0, '127.0.0.1');
    context.after(() => server.close());
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"email":'
    });
    const responseText = await response.text();

    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(responseText), { error: 'Malformed JSON request body.' });
    assert.doesNotMatch(responseText, /SyntaxError|Unexpected|stack|JSON\.parse/i);
    assert.equal(warnings.length, 1);
    assert.equal(errors.length, 0);
});
