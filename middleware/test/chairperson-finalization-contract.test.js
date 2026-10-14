const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registrationPayload } = require('../src/fabric/ca-manager');
const { classifyLedgerError } = require('../src/fabric/ledger-errors');

const root = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('finalization is Registrar-only at every executable authorization boundary', () => {
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

  assert.match(finalizeAction, /Authorize\(Roles = "registrar"\)/);
  assert.doesNotMatch(finalizeAction, /Authorize\(Roles = "department_admin"\)/);
  assert.match(ledger, /finalize-grade\/:id', \['registrar'\]/);
  assert.match(ledger, /finalize-approved-grades', \['registrar'\]/);
  assert.match(chaincode, /Only an authorized Registrar can finalize records/);
  assert.match(chaincode, /isRegistrarIdentity\(mspID, role\)/);
  assert.match(chaincode, /academicScopeAllows\(stub, role, record\)/);
  assert.match(chaincode, /FinalizedBy\s+string/);
  assert.match(chaincode, /FinalizedAt\s+string/);
  assert.match(retiredBulkAction, /Authorize\(Roles = "registrar"\)/);
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

test('Finalize uses the authenticated Registrar wallet identity and preserves structured denials', () => {
  const ledger = read('middleware', 'src', 'services', 'ledger-service.js');
  const route = ledger.slice(ledger.indexOf('function submitRoute'), ledger.indexOf("app.post('/api/batch-issue-grade'"));
  assert.match(route, /actor = await actorForRequest\(req\)/);
  assert.match(route, /contractForUser\(actor\.username, actor\.dbRole\)/);
  assert.match(route, /submitRoute\('\/api\/finalize-grade\/:id', \['registrar'\], 'FinalizeRecord'/);
  assert.match(route, /submitRoute\('\/api\/finalize-approved-grades', \['registrar'\], 'FinalizeApprovedGrades'/);
  assert.doesNotMatch(route, /system-admin-registrar|contractForUser\([^,]+,\s*['"]registrar['"]\)/);

  for (const reason of [
    'OBAC/ABAC Denied: Only an authorized Registrar can finalize records to the ledger.',
    "ABAC Denied: Grade is outside the Registrar's authority",
    'Invalid grade transition: Registrar may finalize only department-approved grades'
  ]) {
    assert.deepEqual(classifyLedgerError(new Error(reason), 'FinalizeRecord'), {
      code: 'CHAINCODE_DENIED', status: 403,
      reason: 'Fabric chaincode rejected the role or grade transition.'
    });
  }
});

test('application batch finalization preserves approved snapshots and deletes staging only after verification', () => {
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  const action = controller.slice(controller.indexOf('[HttpPost("finalize")]'), controller.indexOf('[HttpPost("finalize/{recordId}")]'));
  const batchCall = action.indexOf('FinalizeApprovedGradesAsync(approvedRecords, invokerId)');
  const verifiedFinalized = action.indexOf('!string.Equals(finalized.Status, "Finalized"');
  const stagingDelete = action.indexOf('DELETE FROM pending_grade_records', verifiedFinalized);

  assert.ok(batchCall >= 0 && verifiedFinalized > batchCall && stagingDelete > verifiedFinalized,
    'approved staging must survive until the committed Fabric batch is verified');
  assert.match(action, /GradeLedgerMatch\.IsSameGrade\(staged, finalized\)/);
  assert.match(action, /RegistrarFinalizationScopeService\.GetCurrentApprovedAsync/);
  assert.match(read('chaincode', 'main.go'), /sameApprovedGradeSnapshot\(staged, record\)/);
  assert.match(read('chaincode', 'main.go'), /FinalizeApprovedGrades/);
});

test('approval remains an intermediate Chairperson-only transition', () => {
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  const ledger = read('middleware', 'src', 'services', 'ledger-service.js');
  const approvalAction = controller.slice(
    controller.indexOf('[HttpPost("approve")]'),
    controller.indexOf('[HttpPost("finalize")]')
  );

  assert.match(approvalAction, /SET status = 'ChairpersonApproved'/);
  assert.doesNotMatch(approvalAction, /FinalizeGradeAsync|FinalizeRecord|status = 'Finalized'/);
  assert.doesNotMatch(approvalAction, /ApproveGradeAsync/);
  assert.match(ledger, /approve-grade\/:id', \['department_admin'\]/);
  assert.doesNotMatch(ledger, /approve-grade\/:id', \[[^\]]*registrar/);
});

test('Chairperson handoff is idempotent and is the only transition into the Registrar queue', () => {
  const controller = read('client-app', 'Controllers', 'GradeController.cs');
  const queueScope = read('client-app', 'Services', 'RegistrarFinalizationScopeService.cs');
  const handoff = controller.slice(
    controller.indexOf('[HttpPost("send-to-registrar")]'),
    controller.indexOf('[HttpPost("finalize")]')
  );
  const finalization = controller.slice(
    controller.indexOf('[HttpPost("finalize")]'),
    controller.indexOf('[HttpGet("finalization-queue")]')
  );

  assert.match(handoff, /Authorize\(Roles = "department_admin"\)/);
  assert.match(handoff, /ChairpersonApproved/);
  assert.match(handoff, /DepartmentApproved/);
  assert.match(handoff, /idempotent = unsentCount == 0/);
  assert.doesNotMatch(handoff, /FinalizeApprovedGradesAsync|FinalizeGradeAsync|SubmitGradeAsync/);
  assert.match(queueScope, /WHERE LOWER\(TRIM\(pgr\.status\)\) = 'departmentapproved'/);
  assert.doesNotMatch(queueScope, /IN \('chairpersonapproved', 'departmentapproved'\)/);
  assert.doesNotMatch(finalization, /SET status = 'DepartmentApproved'/);
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

test('Registrar navigation exposes the approved grade-finalization action', () => {
  const sidebar = read('frontend', 'src', 'components', 'registrar', 'RegistrarSidebar.jsx');
  const view = read('frontend', 'src', 'components', 'registrar', 'RegistrarGradesView.jsx');
  assert.match(view, /gradeFinalization.*Finalize Grades/);
  assert.match(view, /RegistrarGradeFinalization/);
  assert.match(sidebar, /Reports & PDF/);
  assert.equal(
    fs.existsSync(path.join(root, 'frontend', 'src', 'components', 'registrar', 'RegistrarGradeFinalization.jsx')),
    true
  );
});
