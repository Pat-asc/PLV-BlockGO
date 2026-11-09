import { buildFacultyAssignmentRequest, buildStudentAssignmentRequest } from './RegistrarGradesView';

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

test('builds a student assignment request with a combined section or an unassigned section for random sectioning', () => {
  expect(buildStudentAssignmentRequest({
    department: 'Bachelor of Science in Accountancy',
    yearLevel: '2',
    sectionNum: '1',
  })).toEqual({
    Department: 'Bachelor of Science in Accountancy',
    YearLevel: '2',
    Section: '2-1',
  });

  expect(buildStudentAssignmentRequest({
    department: 'Bachelor of Science in Accountancy',
    yearLevel: '2',
    sectionNum: '',
  })).toEqual({
    Department: 'Bachelor of Science in Accountancy',
    YearLevel: '2',
    Section: null,
  });
});
