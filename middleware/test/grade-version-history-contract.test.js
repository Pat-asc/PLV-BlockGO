const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyLedgerError } = require('../src/fabric/ledger-errors');

const root = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('finalized corrections remain Chairperson-only across application, middleware, and chaincode', () => {
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  const ledger = read('middleware', 'src', 'services', 'ledger-service.js');
  const chaincode = read('chaincode', 'main.go');
  assert.match(controller, /HttpPost\("correct-finalized"\)[\s\S]{0,100}Authorize\(Roles = "department_admin"\)/);
  assert.match(ledger, /correct-finalized-grade', \['department_admin'\], 'CorrectFinalizedGrade'/);
  assert.match(chaincode, /Only an authorized Chairperson can correct a finalized grade/);
  assert.doesNotMatch(ledger.match(/submitRoute\('\/api\/correct-finalized-grade[^\n]+/)?.[0] || '', /registrar|faculty|student/);
});

test('history uses Fabric key history and projects finalized versions without deleting old state', () => {
  const chaincode = read('chaincode', 'main.go');
  const history = chaincode.slice(chaincode.indexOf('func (cc *SmartContract) getGradeHistory'));
  assert.match(history, /GetHistoryForKey\(recordID\)/);
  assert.match(history, /"Superseded"/);
  assert.match(history, /"Current"/);
  assert.doesNotMatch(history, /DelState|DeleteGradeHistory|ClearPreviousVersions/);
});

test('stale correction versions are a conflict and release metadata is grade-version scoped', () => {
  assert.deepEqual(classifyLedgerError(new Error('grade version conflict: expected 1 but current version is 2'), 'CorrectFinalizedGrade'), {
    code: 'GRADE_VERSION_CONFLICT', status: 409,
    reason: 'The finalized grade changed; refresh before submitting another correction.'
  });
  const migration = read('migrations', '025_versioned_grade_releases.sql');
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  assert.match(migration, /PRIMARY KEY \(record_id, grade_version\)/);
  assert.match(controller, /ON CONFLICT \(record_id, grade_version\) DO NOTHING/);
});
