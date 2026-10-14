const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('manual and bulk Faculty assignment share transactional schedule-conflict enforcement', () => {
  const controller = read('client-app/Controllers/AuthController.cs');
  const service = read('client-app/Services/FacultyBulkAssignmentService.cs');
  const policy = read('client-app/Services/FacultyScheduleConflictPolicy.cs');
  assert.ok((controller.match(/FacultyBulkAssignmentService\.AssignAsync/g) || []).length >= 2);
  assert.match(service, /FOR UPDATE OF u/);
  assert.match(service, /FacultyScheduleConflictPolicy\.Overlaps/);
  assert.match(policy, /first\.StartMinutes < second\.EndMinutes && second\.StartMinutes < first\.EndMinutes/);
  assert.match(service, /school_year = @schoolYear[\s\S]*semester = @semester[\s\S]*is_active = TRUE/);
});

test('student names are presentation-normalized but are never a merge or uniqueness key', () => {
  const controller = read('client-app/Controllers/AuthController.cs');
  const policy = read('client-app/Services/StudentNamePolicy.cs');
  assert.match(controller, /DROP INDEX IF EXISTS ux_studentprofiles_normalized_full_name/);
  assert.doesNotMatch(controller, /CREATE UNIQUE INDEX IF NOT EXISTS ux_studentprofiles_normalized_full_name/);
  assert.doesNotMatch(controller, /LOWER\(REGEXP_REPLACE\(BTRIM\(full_name/);
  assert.match(policy, /SameStudentId/);
  assert.doesNotMatch(policy, /Replace\([^)]*\s[^)]*""/);
});

test('Year Level is strict numeric backend input and no longer falls back to Year 1', () => {
  const controller = read('client-app/Controllers/AuthController.cs');
  const policy = read('client-app/Services/YearLevelPolicy.cs');
  assert.match(controller, /YearLevelPolicy\.Parse/);
  assert.doesNotMatch(controller, /Any other unrecognized text: default to 1st year/);
  assert.match(policy, /short\.TryParse/);
  assert.match(policy, /yearLevel < Minimum \|\| yearLevel > Maximum/);
});

test('academic program creation uses the existing master table and does not fabricate curricula', () => {
  const controller = read('client-app/Controllers/CurriculumsController.cs');
  const action = controller.slice(controller.indexOf('[HttpPost("programs")]'), controller.indexOf('[HttpGet]', controller.indexOf('[HttpPost("programs")]')));
  assert.match(action, /Authorize\(Roles = "registrar"\)/);
  assert.match(action, /INSERT INTO academic_programs/);
  assert.doesNotMatch(action, /INSERT INTO curriculums|curriculum_subjects/);
  assert.match(action, /UniqueViolation/);
});

test('Faculty roster remains exact-section and exact-period scoped', () => {
  const service = read('client-app/Services/FacultyAssignmentRosterService.cs');
  assert.match(service, /e\.academic_section_id = @academicSectionId/);
  assert.match(service, /e\.school_year = @schoolYear/);
  assert.match(service, /e\.semester = @semester/);
  assert.match(service, /UPPER\(BTRIM\(e\.status\)\) = 'ENROLLED'/);
});
