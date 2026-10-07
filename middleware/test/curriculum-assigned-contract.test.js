const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const controller = fs.readFileSync(
  path.join(root, 'client-app', 'Controllers', 'CurriculumsController.cs'),
  'utf8'
);
const start = controller.indexOf('public async Task<IActionResult> GetLatestAssigned');
const end = controller.indexOf('[HttpPost("programs")]', start);
const action = controller.slice(start, end);

test('assigned curriculum binds an omitted batch year as a typed nullable PostgreSQL integer', () => {
  assert.match(action, /Parameters\.Add\("batchYear", NpgsqlDbType\.Integer\)\.Value\s*=\s*[\s\S]*DBNull\.Value/);
  assert.doesNotMatch(action, /AddWithValue\("batchYear", \(object\?\)batchYear \?\? DBNull\.Value\)/);
});

test('assigned curriculum returns valid success responses for both data and no assignment', () => {
  assert.match(action, /if \(!curriculumId\.HasValue\)[\s\S]*return Ok\(new \{ status = "Success", data = \(object\?\)null \}\)/);
  assert.match(action, /curriculum = await LoadCurriculumAsync\(connection, curriculumId\.Value/);
  assert.match(action, /curriculum\.status IN \('PUBLISHED', 'ARCHIVED'\)/);
});

test('assigned curriculum keeps Department Admin authorization and program ownership checks', () => {
  assert.match(controller, /\[HttpGet\("assigned"\)\][\s\S]*Authorize\(Roles = "department_admin,registrar"\)/);
  assert.match(action, /LOWER\(actor\.email\) = LOWER\(@actor\)/);
  assert.match(action, /LOWER\(profile\.department\) IN \(LOWER\(academic_program\.program_code\), LOWER\(academic_program\.program_name\)\)/);
});
