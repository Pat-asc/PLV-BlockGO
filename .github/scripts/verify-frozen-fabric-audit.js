const fs = require('fs');
const path = require('path');

const EXPECTED = Object.freeze({
  fabricNetwork: '2.2.20',
  fabricCaClient: '2.2.20',
  fabricCommon: '2.2.20',
  vulnerableJsrsasign: '10.9.0',
});

const auditArgument = process.argv[2] || 'npm-audit.json';
const auditPath = auditArgument === '-' ? '-' : path.resolve(auditArgument);
const packagePath = path.resolve('package.json');
const lockPath = path.resolve('package-lock.json');

function fail(message) {
  console.error(`BLOCK: ${message}`);
  process.exit(1);
}

function readJson(file, label) {
  if (file === '-') {
    try {
      return JSON.parse(fs.readFileSync(0, 'utf8'));
    } catch (error) {
      fail(`${label} from stdin is not valid JSON: ${error.message}`);
    }
  }
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

const manifest = readJson(packagePath, 'middleware/package.json');
const lock = readJson(lockPath, 'middleware/package-lock.json');
const audit = readJson(auditPath, 'npm audit report');

if (audit.error || audit.message || audit.auditReportVersion !== 2) {
  fail(`npm audit did not return a valid audit v2 report: ${audit.error?.summary || audit.message || 'unknown response'}`);
}

const packages = lock.packages || {};
const lockedVersion = (name) => packages[`node_modules/${name}`]?.version;
const nestedJsrsasign = packages['node_modules/fabric-ca-client/node_modules/jsrsasign'];
const caDependencies = packages['node_modules/fabric-ca-client']?.dependencies || {};
const networkDependencies = packages['node_modules/fabric-network']?.dependencies || {};

const assertions = [
  ['package.json fabric-network pin', manifest.dependencies?.['fabric-network'], EXPECTED.fabricNetwork],
  ['package.json fabric-ca-client pin', manifest.dependencies?.['fabric-ca-client'], EXPECTED.fabricCaClient],
  ['locked fabric-network', lockedVersion('fabric-network'), EXPECTED.fabricNetwork],
  ['locked fabric-ca-client', lockedVersion('fabric-ca-client'), EXPECTED.fabricCaClient],
  ['locked fabric-common', lockedVersion('fabric-common'), EXPECTED.fabricCommon],
  ['fabric-network -> fabric-common', networkDependencies['fabric-common'], EXPECTED.fabricCommon],
  ['fabric-ca-client -> fabric-common', caDependencies['fabric-common'], EXPECTED.fabricCommon],
  ['fabric-ca-client nested jsrsasign', nestedJsrsasign?.version, EXPECTED.vulnerableJsrsasign],
];

console.log('\nFabric SDK version assertions');
for (const [label, actual, expected] of assertions) {
  console.log(`${label}: expected ${expected}; actual ${actual || '<missing>'}`);
  if (actual !== expected) fail(`${label} changed; the temporary exception is invalid.`);
}
console.log('PASS: Fabric SDK 2.2.20 dependency chain is VERIFIED/FROZEN.');

const exceptions = Object.freeze({
  'fabric-ca-client': {
    severity: 'high',
    range: '*',
    nodes: ['node_modules/fabric-ca-client'],
    viaStrings: ['fabric-common', 'jsrsasign'],
    advisoryIds: [],
    parent: 'validated BlockGo Fabric SDK family',
    parentVersion: EXPECTED.fabricNetwork,
    reason: 'Validated Fabric CA SDK component tied to the frozen Hyperledger Fabric integration',
  },
  jsrsasign: {
    severity: 'critical',
    range: '<=11.1.0',
    nodes: ['node_modules/fabric-ca-client/node_modules/jsrsasign'],
    viaStrings: [],
    advisoryIds: [
      'GHSA-rh63-9qcf-83gf',
      'GHSA-w8q8-93cx-6h7r',
      'GHSA-464q-cqxq-xhgr',
      'GHSA-8qwj-4jxw-m8jw',
      'GHSA-5jx8-q4cp-rhh6',
      'GHSA-8g7p-jf3g-gxcp',
      'GHSA-wvqx-v3f6-w8rh',
    ],
    parent: 'fabric-ca-client',
    parentVersion: EXPECTED.fabricCaClient,
    reason: 'Nested transitive dependency of the validated/frozen Fabric CA SDK',
  },
});

function sorted(values) {
  return [...values].sort();
}

function sameValues(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

function advisoryId(via) {
  if (!via || typeof via !== 'object') return null;
  for (const value of [via.url, via.title, via.name]) {
    const match = String(value || '').match(/GHSA-[0-9A-Za-z]+-[0-9A-Za-z]+-[0-9A-Za-z]+/);
    if (match) return match[0];
  }
  return null;
}

const vulnerabilities = audit.vulnerabilities || {};
const approved = [];
const blocking = [];

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  const severity = String(vulnerability.severity || '').toLowerCase();
  if (!['high', 'critical'].includes(severity)) continue;

  const exception = exceptions[name];
  if (!exception) {
    blocking.push({ package: name, severity, reason: 'not an approved temporary Fabric SDK exception' });
    continue;
  }

  const strings = (vulnerability.via || []).filter((via) => typeof via === 'string');
  const ids = (vulnerability.via || []).filter((via) => typeof via === 'object').map(advisoryId);
  const reasons = [];
  if (severity !== exception.severity) reasons.push(`severity ${severity} != ${exception.severity}`);
  if (vulnerability.range !== exception.range) reasons.push(`range ${vulnerability.range} != ${exception.range}`);
  if (!sameValues(vulnerability.nodes || [], exception.nodes)) reasons.push('affected package path changed');
  if (!sameValues(strings, exception.viaStrings)) reasons.push('transitive source chain changed');
  if (ids.some((id) => !id) || !sameValues(ids, exception.advisoryIds)) reasons.push('advisory set changed');

  const entry = {
    package: name,
    severity,
    range: vulnerability.range,
    parent: `${exception.parent}@${exception.parentVersion}`,
    temporaryException: true,
    reason: exception.reason,
  };
  if (reasons.length) blocking.push({ ...entry, reason: reasons.join('; ') });
  else approved.push(entry);
}

for (const name of Object.keys(exceptions)) {
  if (!approved.some((entry) => entry.package === name) && !blocking.some((entry) => entry.package === name)) {
    blocking.push({ package: name, severity: exceptions[name].severity, reason: 'expected finding is absent; exception requires explicit review/removal' });
  }
}

console.log('\nApproved temporary Fabric SDK exceptions');
if (approved.length) console.table(approved);
else console.log('None');

console.log('\nUnapproved high/critical vulnerabilities');
if (blocking.length) {
  console.table(blocking);
  fail(`${blocking.length} high/critical finding or exception mismatch requires review.`);
}
console.log('0');
console.log('PASS: No blocking vulnerabilities; approved exceptions remain temporary, exact, and fail-closed.');
