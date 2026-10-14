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
const grafanaSessionService = fs.readFileSync(path.join(repositoryRoot, 'client-app', 'Services', 'GrafanaSessionTokenService.cs'), 'utf8');
const authService = fs.readFileSync(path.join(repositoryRoot, 'middleware', 'src', 'services', 'auth-service.js'), 'utf8');
const ipTrackerMigration = fs.readFileSync(path.join(repositoryRoot, 'migrations', '026_ip_tracker_mappings.sql'), 'utf8');
const auditLogService = fs.readFileSync(path.join(repositoryRoot, 'client-app', 'Services', 'AuditLogService.cs'), 'utf8');
const ledgerService = fs.readFileSync(path.join(repositoryRoot, 'middleware', 'src', 'services', 'ledger-service.js'), 'utf8');

test('ticket updates validate and persist System Administrator severity changes', () => {
  assert.match(supportTicketModels, /string\?\s+Severity/);
  assert.match(supportTicketsController, /"NORMAL",\s*"HIGH",\s*"CRITICAL"/);
  assert.match(supportTicketsController, /severity\s*=\s*COALESCE\(@severity,\s*severity\)/);
  assert.match(supportTicketsController, /Invalid ticket severity/);
});

test('Registrar ticket creation preserves valid severity and retrieval returns it', () => {
  assert.match(supportTicketModels, /CreateSupportTicketRequest[\s\S]*string\?\s+Severity/);
  assert.match(supportTicketsController, /request\.Severity\.Trim\(\)\.ToUpperInvariant\(\)/);
  assert.match(supportTicketsController, /SELECT id, @title, @description, @severity, @assignedSpecialist FROM users/);
  assert.match(supportTicketsController, /command\.Parameters\.AddWithValue\("severity", severity\)/);
  assert.match(supportTicketsController, /SELECT t\.ticket_id, t\.title, t\.description, t\.severity/);
  assert.match(supportTicketsController, /severity = reader\.GetString\(3\)/);
  assert.match(supportTicketsController, /severity = COALESCE\(@severity, severity\)/);
  assert.doesNotMatch(supportTicketsController, /SELECT id, @title, @description, 'NORMAL', @assignedSpecialist FROM users/);
});

test('System Administrator operations remain protected and read-only', () => {
  assert.match(monitoringController, /Authorize\(Roles = "system_admin"\)/);
  assert.match(monitoringController, /HttpGet\("couchdb\/{target}\/documents"\)/);
  assert.doesNotMatch(monitoringController, /Http(Post|Put|Patch|Delete)\("couchdb/);
  assert.match(monitoringController, /SensitiveDocumentTerms/);
  assert.match(monitoringController, /pageSize = 10/);
  assert.match(auditLogService, /SendAsync\("TransactionRecorded"/);
});

test('security alert IP trackers are stable, incremental, and start at 100', () => {
  assert.match(monitoringController, /LEFT JOIN ip_tracker_mappings tracker ON tracker\.ip_address = event\.ip_address/);
  assert.match(monitoringController, /ipTracker = reader\.IsDBNull\(6\) \? null : IpTrackerFormatter\.Format\(reader\.GetInt64\(6\)\)/);
  assert.doesNotMatch(monitoringController, /summary = \$"[^\n]*reader\.GetString\(4\)[^\n]*reader\.GetString\(5\)/);
  assert.match(ipTrackerMigration, /ip_address VARCHAR\(100\) NOT NULL UNIQUE/);
  assert.match(ipTrackerMigration, /ORDER BY MIN\(security_event_id\), ip_address/);
  assert.doesNotMatch(ipTrackerMigration, /UPDATE\s+security_events|ALTER\s+TABLE\s+security_events/i);
  assert.match(authService, /pg_advisory_xact_lock\(2026100702\)/);
  assert.match(authService, /INSERT INTO ip_tracker_mappings \(tracker_id, ip_address\)/);
  assert.match(authService, /COALESCE\(MAX\(tracker_id\), 0\) \+ 1/);
  assert.match(authService, /INSERT INTO security_events[\s\S]*ip_address[\s\S]*VALUES \(\$1, \$2, \$3, \$4/);
});

test('Grafana proxy uses restart-safe signed cookies and remains restricted to System Administrators', () => {
  assert.match(monitoringController, /Authorize\(Roles = "system_admin"\)/);
  assert.match(monitoringController, /_grafanaSessions\.Create\(actor\)/);
  assert.match(monitoringController, /Request\.Cookies\.TryGetValue\(GrafanaSessionCookie[\s\S]*_grafanaSessions\.TryValidate/);
  assert.doesNotMatch(monitoringController, /GrafanaCacheKey|IMemoryCache|sessionToken"/);
  assert.match(grafanaSessionService, /HMACSHA256/);
  assert.match(grafanaSessionService, /CryptographicOperations\.FixedTimeEquals/);
  assert.match(grafanaSessionService, /role = RequiredRole/);
});

test('internal System Administrator audit events use the dedicated Registrar service identity', () => {
  assert.match(ledgerService, /const \{ REGISTRAR_SERVICE_LABEL \} = require\('\.\.\/fabric\/registrar-service-identity'\)/);
  const auditRoute = ledgerService.slice(
    ledgerService.indexOf("app.post('/api/fabric/audit-event'"),
    ledgerService.indexOf("app.post('/api/issue-grade'")
  );
  assert.match(auditRoute, /if \(req\.isInternal\)[\s\S]*ledgerIdentity = REGISTRAR_SERVICE_LABEL/);
  assert.match(auditRoute, /else \{[\s\S]*actor = await actorForRequest\(req\)[\s\S]*normalizeAuthRole\(actor\.dbRole\) !== 'registrar'/);
  assert.match(auditRoute, /contractForUser\(ledgerIdentity, 'registrar'\)/);
  assert.ok(auditRoute.indexOf('if (req.isInternal)') < auditRoute.indexOf('actor = await actorForRequest(req)'));
});
