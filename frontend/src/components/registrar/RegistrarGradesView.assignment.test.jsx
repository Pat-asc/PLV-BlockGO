import { buildFacultyAssignmentRequest } from './RegistrarGradesView';

test('builds an explicit pending placement request when Subject is blank', () => {
  expect(buildFacultyAssignmentRequest({
    department: 'BSIT',
    section: '1',
    yearLevel: '2',
    subject: '   ',
  })).toEqual({
    Department: 'BSIT',
    Section: '1',
    YearLevel: '2',
    Subject: null,
  });
});

test('preserves a supplied canonical subject code', () => {
  expect(buildFacultyAssignmentRequest({
    department: 'BSCS',
    section: '3',
    yearLevel: '1',
    subject: '  CS 101  ',
  })).toEqual({
    Department: 'BSCS',
    Section: '3',
    YearLevel: '1',
    Subject: 'CS 101',
  });
});

test.each([
  [{ section: '1', yearLevel: '1' }],
  [{ department: 'BSIT', yearLevel: '1' }],
  [{ department: 'BSIT', section: '1' }],
])('still requires department, section, and year level', (assignment) => {
  expect(buildFacultyAssignmentRequest(assignment)).toBeNull();
});
