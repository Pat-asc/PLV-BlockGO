const fs = require('fs');
const path = require('path');

const auditArgument = process.argv[2] || 'npm-audit.json';
const auditPath = path.resolve(auditArgument);

function fail(message) {
  console.error(`BLOCK: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(auditPath)) {
  fail(`npm audit report is missing: ${auditPath}`);
}

let audit;
try {
  audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
} catch (error) {
  fail(`npm audit report is not valid JSON: ${error.message}`);
}

if (audit.error || audit.message || audit.auditReportVersion !== 2) {
  fail(
    `npm audit did not return a valid audit v2 report: ${
      audit.error?.summary || audit.message || 'unknown response'
    }`
  );
}

const blocking = Object.entries(audit.vulnerabilities || {})
  .filter(([, vulnerability]) =>
    ['high', 'critical'].includes(
      String(vulnerability.severity || '').toLowerCase()
    )
  )
  .map(([name, vulnerability]) => ({
    package: name,
    severity: vulnerability.severity,
    direct: Boolean(vulnerability.isDirect),
    range: vulnerability.range || 'unknown',
    nodes: (vulnerability.nodes || []).join(', '),
  }));

console.log('\nHigh/critical production dependency findings');
if (blocking.length) {
  console.table(blocking);
  fail(`${blocking.length} high/critical production dependency finding(s).`);
}

console.log('0');
console.log('PASS: No high or critical production dependency vulnerabilities found.');
