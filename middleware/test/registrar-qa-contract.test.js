const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const actionBetween = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('Registrar student drop revokes access while preserving academic history', () => {
  const controller = read('client-app', 'Controllers', 'AuthController.cs');
  const action = actionBetween(controller, '[HttpDelete("students/{id}/drop")]', '[HttpGet("admins/department/approved")]');

  assert.match(action, /Authorize\(Roles = "registrar"\)/);
  assert.match(action, /UPDATE student_enrollments[\s\S]*SET status = 'DROPPED'/);
  assert.match(action, /role = 'revoked'/);
  assert.match(action, /status = 'REVOKED'/);
  assert.match(action, /is_active = FALSE/);
  assert.doesNotMatch(action, /DELETE FROM\s+(Users|StudentProfiles|student_enrollments)/i);
});

test('Registrar faculty and Chairperson revocation use exact role-scoped tombstones', () => {
  const controller = read('client-app', 'Controllers', 'AuthController.cs');
  const chairperson = actionBetween(controller, '[HttpDelete("admins/department/{id}/revoke")]', '[HttpGet("faculty/approved")]');
  const faculty = actionBetween(controller, '[HttpDelete("faculty/{id}/revoke")]', 'private string NormalizeDept');

  for (const action of [chairperson, faculty]) {
    assert.match(action, /Authorize\(Roles = "registrar"\)/);
    assert.match(action, /role = 'revoked'/);
    assert.match(action, /status = 'REVOKED'/);
    assert.match(action, /is_active = FALSE/);
    assert.match(action, /SafeNotifyAcademicDataChangedAsync/);
    assert.doesNotMatch(action, /DELETE FROM\s+(Users|student_enrollments|pending_grade_records)/i);
  }
  assert.match(chairperson, /WHERE u\.id = @id[\s\S]*department_admin[\s\S]*chairperson/);
  assert.match(faculty, /WHERE id = @id AND role = 'faculty'/);
  assert.match(faculty, /UPDATE FacultySections[\s\S]*SET is_active = FALSE/);
});

test('invalid role-drop targets are rejected before credentials or history change', () => {
  const controller = read('client-app', 'Controllers', 'AuthController.cs');
  const chairperson = actionBetween(controller, '[HttpDelete("admins/department/{id}/revoke")]', '[HttpGet("faculty/approved")]');
  const faculty = actionBetween(controller, '[HttpDelete("faculty/{id}/revoke")]', 'private string NormalizeDept');

  assert.ok(chairperson.indexOf('department admin/chairperson not found') < chairperson.indexOf('UPDATE Users'));
  assert.ok(faculty.indexOf('Faculty not found') < faculty.indexOf('UPDATE Users'));
  assert.match(chairperson, /return NotFound/);
  assert.match(faculty, /return NotFound/);
});

test('student enrollment derives its school year and semester from exactly one active period', () => {
  const controller = read('client-app', 'Controllers', 'AuthController.cs');
  const action = actionBetween(controller, '[HttpPost("students/bulk-upload")]', '[HttpPost("create-student")]');

  assert.match(action, /FROM academic_periods[\s\S]*UPPER\(status\) = 'ACTIVE'/);
  assert.match(action, /activeEnrollmentPeriods\.Count == 0/);
  assert.match(action, /activeEnrollmentPeriods\.Count > 1/);
  assert.match(action, /schoolYear = NormalizeSchoolYear\(activeEnrollmentPeriods\[0\]\.SchoolYear\)/);
  assert.match(action, /semester = NormalizeEnrollmentSemester\(activeEnrollmentPeriods\[0\]\.Semester\)/);
});

test('sectioning eligibility has no recency cutoff and remains exact-period scoped', () => {
  const service = read('client-app', 'Services', 'EnrollmentSectioningService.cs');
  const query = actionBetween(service, 'GetUnassignedAsync', 'GetSectionedAsync');

  assert.doesNotMatch(query, /created_at|updated_at|LIMIT\s+\d+/i);
  assert.match(query, /e\.status = 'ENROLLED'/);
  assert.match(query, /e\.academic_section_id IS NULL/);
  assert.match(query, /e\.school_year = @schoolYear/);
  assert.match(query, /e\.semester = @semester/);
});

test('approved-student scope closes the Registrar-or-Chairperson predicate before ordering', () => {
  const controller = read('client-app', 'Controllers', 'AuthController.cs');
  const action = actionBetween(controller, '[HttpGet("students/approved")]', '[HttpGet("students/enrollment-candidates")]');

  assert.match(action, /AND \(@isRegistrar OR EXISTS \([\s\S]*LOWER\(COALESCE\(prog\.program_name, sp\.department\)\)\)\)\)\s*ORDER BY sp\.full_name/);
});
