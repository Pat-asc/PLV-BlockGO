const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(chaincode, /academicScopeAllows\(stub, role, record\)/);
  assert.match(chaincode, /FinalizedBy\s+string/);
  assert.match(chaincode, /FinalizedAt\s+string/);
  assert.match(retiredBulkAction, /Authorize\(Roles = "department_admin"\)/);
  assert.match(retiredBulkAction, /StatusCodes\.Status410Gone/);
  assert.doesNotMatch(retiredBulkAction, /SubmitGradeAsync|FinalizeGradeAsync|DELETE FROM bulk_grade_staging/);
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
