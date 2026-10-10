import {
  facultyGradeRecordMatchesAssignment,
  mergeFacultyStudentGradeRecords,
  normalizeFacultyGradeIdentity,
  parseFacultyGradePayload,
} from './facultyGradeRecordMapper';

const student = { studentNumber: '26-0001', email: 'student@plv.edu.ph' };
const assignment = {
  assignmentCycleId: '77',
  subjectCode: 'IT 101',
  canonicalSection: 'BSIT 1-1',
};

test('merges separate Midterm and Finals records without depending on response order', () => {
  const records = [
    {
      id: 'finals', assignment_cycle_id: '77', student_no: '26-0001', term: 'finals',
      grade: JSON.stringify({ midterm: '88.50', finals: '91.50', standing: 'active' }),
    },
    {
      id: 'midterm', assignment_cycle_id: '77', student_no: '26-0001', term: 'midterm',
      grade: JSON.stringify({ midterm: '88.50', standing: 'active' }),
    },
  ];

  expect(mergeFacultyStudentGradeRecords(records, student, 'finals')).toEqual(expect.objectContaining({
    midterm: '88.50', finals: '91.50', standing: 'active', matchedRecordCount: 2,
  }));
  expect(mergeFacultyStudentGradeRecords([...records].reverse(), student, 'finals')).toEqual(expect.objectContaining({
    midterm: '88.50', finals: '91.50', standing: 'active', matchedRecordCount: 2,
  }));
});

test('uses every student identity alias and strips hidden spreadsheet characters', () => {
  const records = [{
    assignment_cycle_id: '77', student_hash: 'student@plv.edu.ph', term: 'midterm',
    grade: JSON.stringify({ midterm: '86.00' }),
  }];
  expect(normalizeFacultyGradeIdentity('\uFEFF\u00a026-0001\u200b')).toBe('26-0001');
  expect(mergeFacultyStudentGradeRecords(records, student, 'midterm').midterm).toBe('86.00');
});

test('exact assignment cycle remains authoritative over display-label enrichment', () => {
  expect(facultyGradeRecordMatchesAssignment({
    assignment_cycle_id: '77', subject_code: 'LEGACY LABEL', record_section: 'Legacy Section',
  }, assignment)).toBe(true);
  expect(facultyGradeRecordMatchesAssignment({
    assignment_cycle_id: '78', subject_code: 'IT 101', record_section: 'BSIT 1-1',
  }, assignment)).toBe(false);
});

test('legacy records without a cycle require both exact subject and section', () => {
  expect(facultyGradeRecordMatchesAssignment({
    subject_code: 'IT 101', record_section: 'BSIT 1-1',
  }, assignment)).toBe(true);
  expect(facultyGradeRecordMatchesAssignment({
    subject_code: 'IT 102', record_section: 'BSIT 1-1',
  }, assignment)).toBe(false);
});

test('parses legacy scalar values only into their declared academic term', () => {
  expect(parseFacultyGradePayload('91.50', 'finals')).toEqual(expect.objectContaining({
    midterm: '', finals: '91.50',
  }));
  expect(parseFacultyGradePayload('88.50', 'midterm')).toEqual(expect.objectContaining({
    midterm: '88.50', finals: '',
  }));
});
