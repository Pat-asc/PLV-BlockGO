const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const supportTicketsController = fs.readFileSync(
  path.join(repositoryRoot, 'client-app', 'Controllers', 'SupportTicketsController.cs'),
  'utf8'
);
const supportTicketModels = fs.readFileSync(
  path.join(repositoryRoot, 'client-app', 'Models', 'SupportTicketModels.cs'),
  'utf8'
);
const monitoringController = fs.readFileSync(path.join(repositoryRoot, 'client-app', 'Controllers', 'SystemMonitoringController.cs'), 'utf8');
const auditLogService = fs.readFileSync(path.join(repositoryRoot, 'client-app', 'Services', 'AuditLogService.cs'), 'utf8');

test('ticket updates validate and persist System Administrator severity changes', () => {
  assert.match(supportTicketModels, /string\?\s+Severity/);
  assert.match(supportTicketsController, /"NORMAL",\s*"HIGH",\s*"CRITICAL"/);
  assert.match(supportTicketsController, /severity\s*=\s*COALESCE\(@severity,\s*severity\)/);
  assert.match(supportTicketsController, /Invalid ticket severity/);
});

test('System Administrator operations remain protected and read-only', () => {
  assert.match(monitoringController, /Authorize\(Roles = "system_admin"\)/);
  assert.match(monitoringController, /HttpGet\("couchdb\/{target}\/documents"\)/);
  assert.doesNotMatch(monitoringController, /Http(Post|Put|Patch|Delete)\("couchdb/);
  assert.match(monitoringController, /SensitiveDocumentTerms/);
  assert.match(monitoringController, /pageSize = 10/);
  assert.match(auditLogService, /SendAsync\("TransactionRecorded"/);
});
