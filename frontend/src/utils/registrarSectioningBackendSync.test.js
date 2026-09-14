import {
  getNextAcademicSchoolYear,
  persistPromotedBatchesToBackend,
  syncSectioningBatchToBackend,
} from './registrarSectioningBackendSync';
import {
  assignStudentsToSection,
  batchEnrollStudentsToSection,
  createSection,
  fetchDepartmentSections,
  promoteStudentEnrollments,
} from '../services/api';

jest.mock('../services/api', () => ({
  assignStudentsToSection: jest.fn(),
  batchEnrollStudentsToSection: jest.fn(),
  createSection: jest.fn(),
  fetchDepartmentSections: jest.fn(),
  promoteStudentEnrollments: jest.fn(),
}));

const batch = {
  program: 'BSIT', schoolYear: '2026-2027', semester: 'SECOND',
  sectionPlans: [{ yearLevel: '1st Year', sectionCode: '1-1' }],
  students: [{ studentId: '26-0001', yearLevel: '1st Year', sectionCode: '1-1' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  batch.students.forEach((student) => { delete student.academicSectionId; });
  fetchDepartmentSections.mockResolvedValue({ data: [{ id: '7', department: 'Information Technology', yearLevel: '1', sectionNum: '1' }] });
  createSection.mockResolvedValue({ id: 8 });
  assignStudentsToSection.mockResolvedValue({ status: 'Success', assignedCount: 1, errors: [] });
});

test('advances only valid consecutive academic school years', () => {
  expect(getNextAcademicSchoolYear('2027-2028')).toBe('2028-2029');
  expect(() => getNextAcademicSchoolYear('2027-2029')).toThrow('valid consecutive school year');
});

test('persists promoted section rosters with source and target concurrency fields', async () => {
  promoteStudentEnrollments.mockResolvedValue({ status: 'Success', promotedCount: 1 });
  const promotedBatch = {
    program: 'Bachelor of Science in Information Technology',
    schoolYear: '2028-2029',
    semester: 'FIRST',
    students: [{
      studentId: '27-0001', sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
      sourceYearLevel: '1st Year', originSectionCode: '1-1',
      yearLevel: '2nd Year', sectionCode: '2-1',
    }],
  };

  await expect(persistPromotedBatchesToBackend([promotedBatch])).resolves.toEqual({
    status: 'Success', promotedCount: 1,
  });
  expect(promoteStudentEnrollments).toHaveBeenCalledWith([{
    studentId: '27-0001',
    program: 'Bachelor of Science in Information Technology',
    sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
    sourceYearLevel: '1', sourceSection: '1-1',
    targetSchoolYear: '2028-2029', targetSemester: 'FIRST',
    targetYearLevel: '2', targetSection: '2-1',
  }]);
});

test('uses an existing section returned for a program alias and assigns saved student IDs with their period', async () => {
  expect(await syncSectioningBatchToBackend(batch)).toEqual({ sectionsSynced: 0, studentsSynced: 1 });
  expect(createSection).not.toHaveBeenCalled();
  expect(assignStudentsToSection).toHaveBeenCalledWith('7', ['26-0001'], { schoolYear: '2026-2027', semester: 'SECOND' });
  expect(batchEnrollStudentsToSection).not.toHaveBeenCalled();
});

test('creates a section and assigns its enrolled roster without a file upload', async () => {
  fetchDepartmentSections.mockResolvedValue({ data: [] });
  expect(await syncSectioningBatchToBackend(batch)).toEqual({ sectionsSynced: 1, studentsSynced: 1 });
  expect(assignStudentsToSection).toHaveBeenCalledWith(8, ['26-0001'], expect.any(Object));
  expect(batchEnrollStudentsToSection).not.toHaveBeenCalled();
});

test('surfaces assignment errors without re-enrolling students', async () => {
  assignStudentsToSection.mockRejectedValue(new Error('Student already assigned'));
  await expect(syncSectioningBatchToBackend(batch)).rejects.toThrow('Student already assigned');
  expect(batchEnrollStudentsToSection).not.toHaveBeenCalled();
});

test('rejects partial success from an older backend', async () => {
  assignStudentsToSection.mockResolvedValue({ status: 'Success', assignedCount: 0, errors: ['No eligible enrollment'] });
  await expect(syncSectioningBatchToBackend(batch)).rejects.toThrow('No eligible enrollment');
  expect(batchEnrollStudentsToSection).not.toHaveBeenCalled();
});

test('requires the enrollment period instead of silently choosing a different period', async () => {
  await expect(syncSectioningBatchToBackend({ ...batch, semester: undefined })).rejects.toThrow('school year and semester');
  expect(assignStudentsToSection).not.toHaveBeenCalled();
});

test('an intentional section move supplies the previously saved section for conflict checking', async () => {
  const moved = { ...batch, students: [{ ...batch.students[0], academicSectionId: 3 }] };
  await syncSectioningBatchToBackend(moved);
  expect(assignStudentsToSection).toHaveBeenCalledWith('7', ['26-0001'], {
    schoolYear: '2026-2027', semester: 'SECOND', expectedSectionIds: { '26-0001': 3 },
  });
  expect(moved.students[0].academicSectionId).toBe(7);
});
