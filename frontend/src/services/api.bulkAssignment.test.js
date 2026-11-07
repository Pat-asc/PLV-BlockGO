import { buildBulkFacultyAssignmentRequest } from './api';

test('bulk assignment payload omits spreadsheet-supplied Section IDs', () => {
  const payload = buildBulkFacultyAssignmentRequest([{
    id: 'row-2',
    facultyUserId: 11,
    subjectCode: 'IT 101',
    program: 'BS Information Technology',
    sectionName: 'BSIT 1-1',
    academicSectionId: 999,
    schoolYear: '2026-2027',
    semester: 'FIRST',
    schedule: 'Monday | 08:00-10:00',
  }], { selectedAcademicSectionId: 42 });

  expect(payload.selectedAcademicSectionId).toBe(42);
  expect(payload.assignments[0]).toMatchObject({
    clientId: 'row-2',
    facultyUserId: 11,
    subjectCode: 'IT 101',
    program: 'BS Information Technology',
    section: 'BSIT 1-1',
    schoolYear: '2026-2027',
    semester: 'FIRST',
  });
  expect(payload.assignments[0]).not.toHaveProperty('academicSectionId');
});
