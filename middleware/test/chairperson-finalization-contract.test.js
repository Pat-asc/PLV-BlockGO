const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registrationPayload } = require('../src/fabric/ca-manager');
const { classifyLedgerError } = require('../src/fabric/ledger-errors');

const root = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('finalization is Chairperson-only at every executable authorization boundary', () => {
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  const legacyController = read('client-app', 'Controllers', 'BulkUploadController.cs');
  const ledger = read('middleware', 'src', 'services', 'ledger-service.js');
  const chaincode = read('chaincode', 'main.go');
  const finalizeAction = controller.slice(
    controller.indexOf('[HttpPost("finalize/{recordId}")]'),
    controller.indexOf('[HttpGet("finalization-queue")]')
  );
  const retiredBulkAction = legacyController.slice(
    legacyController.indexOf('[HttpPost("finalize-grades")]'),
    legacyController.indexOf('[HttpGet("staged")]')
  );

  assert.match(finalizeAction, /Authorize\(Roles = "department_admin"\)/);
  assert.doesNotMatch(finalizeAction, /Authorize\(Roles = "[^"]*registrar/);
  assert.match(ledger, /finalize-grade\/:id', \['department_admin'\]/);
  assert.match(chaincode, /Only an authorized Chairperson can finalize records/);
  assert.match(chaincode, /mspID == "DepartmentMSP" && \(role == "department_admin" \|\| role == "deptAdmin"\)/);
  assert.doesNotMatch(chaincode.slice(chaincode.indexOf('func (cc *SmartContract) finalizeRecord'),
    chaincode.indexOf('func (cc *SmartContract) getAllGrades')), /isRegistrar|Master Registrar/);
  assert.match(chaincode, /academicScopeAllows\(stub, role, record\)/);
  assert.match(chaincode, /FinalizedBy\s+string/);
  assert.match(chaincode, /FinalizedAt\s+string/);
  assert.match(retiredBulkAction, /Authorize\(Roles = "department_admin"\)/);
  assert.match(retiredBulkAction, /StatusCodes\.Status410Gone/);
  assert.doesNotMatch(retiredBulkAction, /SubmitGradeAsync|FinalizeGradeAsync|DELETE FROM bulk_grade_staging/);
});

test('Chairperson enrollment embeds the canonical role and department in the signed Fabric certificate', () => {
  const payload = registrationPayload('chair@plv.edu.ph', 'not-logged', 'Chairperson', { department: 'BSIT' });
  assert.equal(payload.role, 'admin');
  assert.deepEqual(payload.attrs, [
    { name: 'role', value: 'department_admin', ecert: true },
    { name: 'grade.manage', value: 'false', ecert: true },
    { name: 'academic.department', value: 'BSIT', ecert: true }
  ]);
});

test('Finalize uses the authenticated Chairperson wallet identity and preserves structured denials', () => {
  const ledger = read('middleware', 'src', 'services', 'ledger-service.js');
  const route = ledger.slice(ledger.indexOf('function submitRoute'), ledger.indexOf("app.post('/api/batch-issue-grade'"));
  assert.match(route, /actor = await actorForRequest\(req\)/);
  assert.match(route, /contractForUser\(actor\.username, actor\.dbRole\)/);
  assert.match(route, /submitRoute\('\/api\/finalize-grade\/:id', \['department_admin'\], 'FinalizeRecord'/);
  assert.doesNotMatch(route, /system-admin-registrar|contractForUser\([^,]+,\s*['"]registrar['"]\)/);

  for (const reason of [
    'OBAC/ABAC Denied: Only an authorized Chairperson can finalize records to the ledger.',
    "ABAC Denied: Grade is outside the Chairperson's authoritative department scope",
    'Invalid grade transition: Chairperson may finalize only department-approved grades'
  ]) {
    assert.deepEqual(classifyLedgerError(new Error(reason), 'FinalizeRecord'), {
      code: 'CHAINCODE_DENIED', status: 403,
      reason: 'Fabric chaincode rejected the role or grade transition.'
    });
  }
});

test('application finalization keeps approval distinct, preserves cycle identity, and deletes staging only after verification', () => {
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  const action = controller.slice(
    controller.indexOf('[HttpPost("finalize/{recordId}")]'),
    controller.indexOf('[HttpGet("finalization-queue")]')
  );
  const approveCall = action.indexOf('ApproveGradeAsync(recordId, invokerId)');
  const finalizeCall = action.indexOf('FinalizeGradeAsync(recordId, invokerId)');
  const verifiedFinalized = action.indexOf('!string.Equals(finalizedRecord.Status, "Finalized"');
  const stagingDelete = action.indexOf('DELETE FROM pending_grade_records WHERE id = @id', verifiedFinalized);

  assert.ok(approveCall >= 0 && finalizeCall > approveCall, 'Fabric approval must precede the separate finalize call');
  assert.ok(verifiedFinalized > finalizeCall && stagingDelete > verifiedFinalized,
    'approved staging must survive until Fabric Finalized is read back and verified');
  assert.match(action, /status, assignment_cycle_id/);
  assert.match(action, /AssignmentCycleId = reader\.IsDBNull\(22\)/);
});

test('approval remains an intermediate Chairperson-only transition', () => {
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  const ledger = read('middleware', 'src', 'services', 'ledger-service.js');
  const approvalAction = controller.slice(
    controller.indexOf('[HttpPost("approve")]'),
    controller.indexOf('[HttpPost("finalize/{recordId}")]')
  );

  assert.match(approvalAction, /SET status = 'ChairpersonApproved'/);
  assert.doesNotMatch(approvalAction, /FinalizeGradeAsync|FinalizeRecord|status = 'Finalized'/);
  assert.doesNotMatch(approvalAction, /ApproveGradeAsync/);
  assert.match(ledger, /approve-grade\/:id', \['department_admin'\]/);
  assert.doesNotMatch(ledger, /approve-grade\/:id', \[[^\]]*registrar/);
});

test('Student and Registrar visibility remain Finalized-only', () => {
  const studentController = read('client-app', 'Controllers', 'StudentController.cs');
  const metadata = read('client-app', 'Services', 'RegistrarGradeLedgerMetadataService.cs');
  const ledger = read('middleware', 'src', 'services', 'ledger-service.js');

  assert.match(studentController, /string\.Equals\(record\.Status\?\.Trim\(\), "Finalized"/);
  assert.match(metadata, /return normalized is "finalized"/);
  assert.doesNotMatch(metadata, /"chairpersonapproved"|"departmentapproved"/);
  assert.match(ledger, /role === 'registrar'[\s\S]*grade\.status[\s\S]*=== 'finalized'/);
});

test('Registrar navigation exposes reports but no grade-finalization action', () => {
  const sidebar = read('frontend', 'src', 'components', 'registrar', 'RegistrarSidebar.jsx');
  assert.doesNotMatch(sidebar, /Grade Finalization/);
  assert.match(sidebar, /Reports & PDF/);
  assert.equal(
    fs.existsSync(path.join(root, 'frontend', 'src', 'components', 'registrar', 'GradeFinalization.jsx')),
    false
  );
});
