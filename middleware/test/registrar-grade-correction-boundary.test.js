const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const gradeController = fs.readFileSync(
  path.join(repositoryRoot, 'client-app', 'Controllers', 'GradeController.cs'),
  'utf8'
);
const frontendApi = fs.readFileSync(
  path.join(repositoryRoot, 'frontend', 'src', 'services', 'api.js'),
  'utf8'
);

test('registrars cannot bypass the Faculty and Chairperson correction workflow', () => {
  assert.doesNotMatch(gradeController, /registrar-correct/i);
  assert.doesNotMatch(gradeController, /CorrectFinalizedGradeAsRegistrar/);
  assert.doesNotMatch(frontendApi, /correctFinalizedGradeAsRegistrar/);
});

test('the approved returned-grade workflow remains available', () => {
  assert.match(gradeController, /HttpPost\("return\/\{recordId\}"\)/);
  assert.match(gradeController, /Authorize\(Roles\s*=\s*"department_admin,registrar"\)/);
  assert.match(gradeController, /Grade returned to faculty with correction remarks/);
});
