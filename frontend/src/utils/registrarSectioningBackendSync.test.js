import {
  buildAuthoritativePromotionRequest,
  getNextAcademicSchoolYear,
  mergePromotionResultIntoBatches,
  persistPromotedBatchesToBackend,
  refreshSectioningBatchFromBackend,
  syncSectioningBatchToBackend,
} from './registrarSectioningBackendSync';
import { assignStudentsToSection, batchEnrollStudentsToSection, createSection, fetchDepartmentSections, fetchSectionedEnrolledStudents, promoteStudentEnrollments } from '../services/api';

jest.mock('../services/api', () => ({
  assignStudentsToSection: jest.fn(),
  batchEnrollStudentsToSection: jest.fn(),
  createSection: jest.fn(),
  fetchDepartmentSections: jest.fn(),
  fetchSectionedEnrolledStudents: jest.fn(),
  promoteStudentEnrollments: jest.fn(),
}));

const authoritativeStudent = (index = 1, overrides = {}) => ({
  enrollmentId: 100 + index,
  id: 200 + index,
  studentNo: `27-${String(index).padStart(4, '0')}`,
  department: 'Bachelor of Science in Information Technology',
  schoolYear: '2027-2028',
  semester: 'FIRST',
  yearLevel: '1',
  academicSectionId: 7,
  section: '1-1',
  enrollmentState: 'PLANNING',
  ...overrides,
});

const batch = {
  program: 'BSIT', schoolYear: '2026-2027', semester: 'SECOND',
  sectionPlans: [{ yearLevel: '1st Year', sectionCode: '1-1' }],
  students: [{ studentId: '26-0001', yearLevel: '1st Year', sectionCode: '1-1' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  batch.students.forEach((student) => { delete student.academicSectionId; });
  batch.sectionPlans.forEach((section) => { delete section.id; delete section.academicSectionId; });
  fetchDepartmentSections.mockResolvedValue({ data: [{ id: '7', department: 'Information Technology', yearLevel: '1', sectionNum: '1' }] });
  createSection.mockResolvedValue({ id: 8 });
  assignStudentsToSection.mockResolvedValue({ status: 'Success', assignedCount: 1, errors: [] });
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [authoritativeStudent()] });
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
    sourceEnrollmentId: 101,
    studentUserId: 201,
    sourceAcademicSectionId: 7,
    studentId: '27-0001',
    program: 'Bachelor of Science in Information Technology',
    sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
    sourceYearLevel: '1', sourceSection: '1-1',
    targetSchoolYear: '2028-2029', targetSemester: 'FIRST',
    targetYearLevel: '2', targetSection: '2-1',
  }]);
});

test('promotes a 25-student roster once while preserving every student identity', async () => {
  const students = Array.from({ length: 25 }, (_, index) => ({
    studentId: `27-${String(index + 1).padStart(4, '0')}`,
    sourceSchoolYear: '2027-2028',
    sourceSemester: 'FIRST',
    sourceYearLevel: '1st Year',
    originSectionCode: '1-1',
    yearLevel: '2nd Year',
    sectionCode: '2-1',
  }));
  const promotedBatch = {
    program: 'Bachelor of Science in Information Technology',
    schoolYear: '2028-2029',
    semester: 'FIRST',
    students,
  };
  promoteStudentEnrollments.mockResolvedValue({ status: 'Success', promotedCount: 25 });
  fetchSectionedEnrolledStudents.mockResolvedValue({
    data: students.map((_, index) => authoritativeStudent(index + 1)),
  });

  await expect(persistPromotedBatchesToBackend([promotedBatch])).resolves.toEqual({
    status: 'Success', promotedCount: 25,
  });

  expect(promoteStudentEnrollments).toHaveBeenCalledTimes(1);
  const payload = promoteStudentEnrollments.mock.calls[0][0];
  expect(payload).toHaveLength(25);
  expect(new Set(payload.map((student) => student.studentId))).toEqual(
    new Set(students.map((student) => student.studentId))
  );
  expect(payload).toEqual(expect.arrayContaining([
    expect.objectContaining({
      studentId: '27-0001',
      sourceSchoolYear: '2027-2028',
      sourceYearLevel: '1',
      targetSchoolYear: '2028-2029',
      targetYearLevel: '2',
      targetSection: '2-1',
    }),
    expect.objectContaining({ studentId: '27-0025' }),
  ]));
  expect(promotedBatch.students).toEqual(students);
});

test('deduplicates the same authoritative enrollment without mutating the source batches', async () => {
  const student = {
    studentId: '27-0001', sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
    sourceYearLevel: '1st Year', originSectionCode: '1-1', yearLevel: '2nd Year', sectionCode: '2-1',
  };
  const batches = [{ program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST', students: [student, { ...student }] }];
  const snapshot = JSON.parse(JSON.stringify(batches));

  const request = await buildAuthoritativePromotionRequest(batches);

  expect(request).toHaveLength(1);
  expect(request[0]).toEqual(expect.objectContaining({ sourceEnrollmentId: 101, studentUserId: 201 }));
  expect(batches).toEqual(snapshot);
});

test('rebuilds the payload from the refreshed row and ignores changed mutable lifecycle metadata', async () => {
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [authoritativeStudent(1, {
    enrollmentId: 101,
    id: 201,
    studentNo: '27-0001',
    enrollmentState: 'PLANNING',
    finalizedAt: null,
    finalizedBy: null,
    updatedAt: '2027-06-01T10:00:00Z',
  })] });
  const staleStudent = {
    id: 201,
    enrollmentId: 101,
    academicSectionId: 7,
    studentId: '27-0001',
    enrollmentState: 'FINALIZED',
    finalizedAt: '2027-05-01T10:00:00Z',
    updatedAt: '2027-05-01T10:00:00Z',
    sourceSchoolYear: '2027-2028',
    sourceSemester: 'FIRST',
    sourceYearLevel: '1st Year',
    originSectionCode: '1-1',
    yearLevel: '2nd Year',
    sectionCode: '2-1',
  };

  const request = await buildAuthoritativePromotionRequest([{
    program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST', students: [staleStudent],
  }]);

  expect(request).toEqual([expect.objectContaining({
    sourceEnrollmentId: 101,
    studentUserId: 201,
    sourceAcademicSectionId: 7,
    sourceSchoolYear: '2027-2028',
    targetSchoolYear: '2028-2029',
  })]);
  expect(staleStudent.enrollmentState).toBe('FINALIZED');
});

test('promotes after unlock when the immediate refresh returns the same identity in PLANNING state', async () => {
  const staleBeforeUnlock = {
    id: 201,
    enrollmentId: 101,
    academicSectionId: 7,
    studentId: '27-0001',
    enrollmentState: 'FINALIZED',
    finalizedAt: '2027-05-01T10:00:00Z',
    sourceSchoolYear: '2027-2028',
    sourceSemester: 'FIRST',
    sourceYearLevel: '1st Year',
    originSectionCode: '1-1',
    yearLevel: '2nd Year',
    sectionCode: '2-1',
  };
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [authoritativeStudent(1, {
    enrollmentId: 101,
    id: 201,
    studentNo: '27-0001',
    enrollmentState: 'PLANNING',
    finalizedAt: null,
    finalizedBy: null,
  })] });
  promoteStudentEnrollments.mockResolvedValue({
    status: 'Success', promotedCount: 1, newlyPromotedCount: 1,
  });

  await expect(persistPromotedBatchesToBackend([{
    program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST', students: [staleBeforeUnlock],
  }])).resolves.toEqual({ status: 'Success', promotedCount: 1, newlyPromotedCount: 1 });

  expect(promoteStudentEnrollments).toHaveBeenCalledWith([
    expect.objectContaining({
      sourceEnrollmentId: 101,
      studentUserId: 201,
      sourceAcademicSectionId: 7,
      targetSchoolYear: '2028-2029',
    }),
  ]);
});

test('does not fall back to the same student number when an exact enrollment ID is stale', async () => {
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [authoritativeStudent(1, {
    enrollmentId: 999,
    id: 201,
    studentNo: '27-0001',
  })] });
  const batches = [{
    program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST',
    students: [{
      id: 201, enrollmentId: 101, academicSectionId: 7, studentId: '27-0001',
      sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST', sourceYearLevel: '1st Year',
      originSectionCode: '1-1', yearLevel: '2nd Year', sectionCode: '2-1',
    }],
  }];

  await expect(buildAuthoritativePromotionRequest(batches)).rejects.toThrow(
    'no longer matches the current source enrollment'
  );
  expect(promoteStudentEnrollments).not.toHaveBeenCalled();
});

test('promotion still rejects nonexistent students if they somehow remain in a promotion batch', async () => {
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [] });
  const batches = [{
    program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST',
    students: [{
      studentId: '26-0099',
      sourceSchoolYear: '2027-2028',
      sourceSemester: 'FIRST',
      sourceYearLevel: '1st Year',
      originSectionCode: '1-1',
      yearLevel: '2nd Year',
      sectionCode: '2-1',
    }],
  }];

  await expect(buildAuthoritativePromotionRequest(batches)).rejects.toThrow(
    "Student '26-0099' no longer matches the current source enrollment. Refresh sections before promoting."
  );
  expect(promoteStudentEnrollments).not.toHaveBeenCalled();
});

test('rejects a true immutable student or academic-section mismatch after refresh', async () => {
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [authoritativeStudent(1, {
    enrollmentId: 101,
    id: 999,
    academicSectionId: 8,
    studentNo: '27-0001',
  })] });
  const batches = [{
    program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST',
    students: [{
      id: 201, enrollmentId: 101, academicSectionId: 7, studentId: '27-0001',
      sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST', sourceYearLevel: '1st Year',
      originSectionCode: '1-1', yearLevel: '2nd Year', sectionCode: '2-1',
    }],
  }];

  await expect(buildAuthoritativePromotionRequest(batches)).rejects.toThrow(
    'no longer matches the current source enrollment'
  );
});

test('rejects conflicting duplicate targets for one authoritative enrollment', async () => {
  const common = {
    studentId: '27-0001', sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
    sourceYearLevel: '1st Year', originSectionCode: '1-1', yearLevel: '2nd Year',
  };
  const batches = [{
    program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST',
    students: [{ ...common, sectionCode: '2-1' }, { ...common, sectionCode: '2-2' }],
  }];
  await expect(buildAuthoritativePromotionRequest(batches)).rejects.toThrow('conflicting promotion targets');
  expect(promoteStudentEnrollments).not.toHaveBeenCalled();
});

test('blocks promotion from a locked authoritative section before persistence', async () => {
  fetchSectionedEnrolledStudents.mockResolvedValue({ data: [authoritativeStudent(1, { enrollmentState: 'FINALIZED' })] });
  const promotedBatch = {
    program: 'BSIT', schoolYear: '2028-2029', semester: 'FIRST',
    students: [{ studentId: '27-0001', sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST', sourceYearLevel: '1st Year', originSectionCode: '1-1', yearLevel: '2nd Year', sectionCode: '2-1' }],
  };
  await expect(persistPromotedBatchesToBackend([promotedBatch])).rejects.toThrow('Unlock the section');
  expect(promoteStudentEnrollments).not.toHaveBeenCalled();
});

test('replaces stale source enrollment identifiers with canonical promoted enrollment identifiers', () => {
  const batches = [{ key: 'target', students: [
    { studentId: '27-0001', enrollmentId: 101, academicSectionId: 7 },
    { studentId: '27-0001', enrollmentId: 101, academicSectionId: 7 },
  ] }];
  const merged = mergePromotionResultIntoBatches(batches, [{
    studentNo: '27-0001', userId: 201, sourceEnrollmentId: 101,
    targetEnrollmentId: 501, academicSectionId: 12,
  }]);
  expect(merged[0].students[0]).toEqual(expect.objectContaining({
    id: 201, enrollmentId: 501, sourceEnrollmentId: 101, academicSectionId: 12, enrollmentState: 'PLANNING',
  }));
  expect(merged[0].students).toHaveLength(1);
  expect(batches[0].students[0]).toEqual({ studentId: '27-0001', enrollmentId: 101, academicSectionId: 7 });
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

test('retains the canonical section ID even when an empty section has no students', async () => {
  const emptyBatch = { ...batch, sectionPlans: [{ yearLevel: '1st Year', sectionCode: '1-1' }], students: [] };
  await syncSectioningBatchToBackend(emptyBatch);
  expect(emptyBatch.sectionPlans[0]).toEqual(expect.objectContaining({ id: 7, academicSectionId: 7 }));
  expect(assignStudentsToSection).not.toHaveBeenCalled();
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

test('syncSectioningBatchToBackend canonicalizes BAC to Bachelor of Arts in Communication and excludes removed or ineligible students', async () => {
  fetchDepartmentSections.mockResolvedValue({
    data: [{ id: '9', department: 'Bachelor of Arts in Communication', yearLevel: '1', sectionNum: '1' }],
  });
  assignStudentsToSection.mockResolvedValue({ status: 'Success', assignedCount: 1, errors: [] });

  const bacBatch = {
    program: 'BAC',
    schoolYear: '2026-2027',
    semester: 'FIRST',
    sectionPlans: [{ yearLevel: '1st Year', sectionCode: '1-1' }],
    students: [
      { studentId: '26-0005', yearLevel: '1st Year', sectionCode: '1-1' },
      { studentId: '26-0003', yearLevel: '1st Year', sectionCode: '1-1', isActive: false },
      { studentId: '26-0004', yearLevel: '1st Year', sectionCode: '1-1', status: 'DROPPED' },
      { studentId: '26-0001', yearLevel: '1st Year', sectionCode: '1-1' },
    ],
    removedStudents: [
      { studentId: '26-0005', removalReason: 'Duplicate student record' },
    ],
  };

  await syncSectioningBatchToBackend(bacBatch);

  expect(fetchDepartmentSections).toHaveBeenCalledWith('Bachelor of Arts in Communication');
  expect(assignStudentsToSection).toHaveBeenCalledWith('9', ['26-0001'], expect.any(Object));
});

test('buildAuthoritativePromotionRequest excludes removed and ineligible students from promotion', async () => {
  fetchSectionedEnrolledStudents.mockResolvedValue({
    data: [
      authoritativeStudent(1, { studentNo: '27-0001', department: 'Bachelor of Arts in Communication' }),
      authoritativeStudent(5, { studentNo: '26-0005', department: 'Bachelor of Arts in Communication' }),
    ],
  });

  const bacBatch = {
    program: 'BAC',
    schoolYear: '2028-2029',
    semester: 'FIRST',
    students: [
      {
        studentId: '26-0005', sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
        sourceYearLevel: '1st Year', originSectionCode: '1-1',
        yearLevel: '2nd Year', sectionCode: '2-1',
      },
      {
        studentId: '26-0003', sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
        sourceYearLevel: '1st Year', originSectionCode: '1-1',
        yearLevel: '2nd Year', sectionCode: '2-1',
        isActive: false,
      },
      {
        studentId: '27-0001', sourceSchoolYear: '2027-2028', sourceSemester: 'FIRST',
        sourceYearLevel: '1st Year', originSectionCode: '1-1',
        yearLevel: '2nd Year', sectionCode: '2-1',
      },
    ],
    removedStudents: [
      { studentId: '26-0005', removalReason: 'Duplicate student record' },
    ],
  };

  const requests = await buildAuthoritativePromotionRequest([bacBatch]);

  expect(requests).toHaveLength(1);
  expect(requests[0].studentId).toBe('27-0001');
  expect(requests[0].program).toBe('Bachelor of Arts in Communication');
});

test('refreshSectioningBatchFromBackend preserves existing removal history without synthetic records and excludes ineligible students', async () => {
  fetchSectionedEnrolledStudents.mockResolvedValue({
    data: [
      { studentNo: '26-0001', fullName: 'Juan Dela Cruz', yearLevel: '1', section: '1-1' },
      { studentNo: '26-0002', fullName: 'Maria Santos', yearLevel: '1', section: '1-1' },
      { studentNo: '26-0003', fullName: 'Inactive Student', yearLevel: '1', section: '1-1', isActive: false },
      { studentNo: '26-0005', fullName: 'Removed Student', yearLevel: '1', section: '1-1' },
    ],
  });
  fetchDepartmentSections.mockResolvedValue({
    data: [{ id: 9, yearLevel: 1, sectionNum: 1 }],
  });

  const batch = {
    program: 'BAC',
    schoolYear: '2026-2027',
    semester: 'FIRST',
    removedStudents: [
      {
        studentId: '26-0005',
        removalReason: 'Duplicate student record',
        removalNote: 'Duplicate student record',
        removedAt: '2026-11-10T08:00:00.000Z',
      },
    ],
  };

  const refreshed = await refreshSectioningBatchFromBackend(batch);

  expect(refreshed.program).toBe('Bachelor of Arts in Communication');
  expect(refreshed.students.map((s) => s.studentId)).toEqual(['26-0001', '26-0002']);
  expect(refreshed.removedStudents).toEqual([
    {
      studentId: '26-0005',
      removalReason: 'Duplicate student record',
      removalNote: 'Duplicate student record',
      removedAt: '2026-11-10T08:00:00.000Z',
    },
  ]);
});
