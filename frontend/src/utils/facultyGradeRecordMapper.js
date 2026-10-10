const HIDDEN_IDENTIFIER_CHARACTERS = /[\u00a0\u200b\u2060\ufeff]/g;

const firstValue = (...values) => values.find(
  (value) => value !== null && value !== undefined && String(value).trim() !== ''
);

export const normalizeFacultyGradeIdentity = (value) => String(value ?? '')
  .replace(HIDDEN_IDENTIFIER_CHARACTERS, '')
  .trim()
  .toLowerCase();

const normalizeTerm = (value) => {
  const normalized = normalizeFacultyGradeIdentity(value);
  return normalized === 'final' || normalized === 'finals' ? 'finals' :
    normalized === 'midterm' || normalized === 'midterms' ? 'midterm' : '';
};

const parseGradeValue = (value) => {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  if (!normalized || Number.isNaN(Number(normalized))) return '';
  return normalized;
};

export const parseFacultyGradePayload = (rawGrade, recordTerm = '') => {
  const empty = {
    midterm: '',
    finals: '',
    standing: 'active',
    flagged: false,
  };
  if (rawGrade === null || rawGrade === undefined || rawGrade === '') return empty;

  let payload = rawGrade;
  if (typeof rawGrade === 'string' && rawGrade.trim().startsWith('{')) {
    try {
      payload = JSON.parse(rawGrade);
    } catch (_error) {
      return empty;
    }
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      midterm: parseGradeValue(firstValue(payload.midterm, payload.midterms)),
      finals: parseGradeValue(firstValue(payload.finals, payload.final)),
      standing: String(firstValue(payload.standing, payload.studentStatus, 'active')).trim().toLowerCase(),
      flagged: Boolean(firstValue(payload.flagged, payload.isFlagged, false)),
    };
  }

  const numericGrade = parseGradeValue(payload);
  if (!numericGrade) return empty;
  const term = normalizeTerm(recordTerm);
  return {
    ...empty,
    midterm: term === 'finals' ? '' : numericGrade,
    finals: term === 'midterm' ? '' : numericGrade,
  };
};

const recordAssignmentCycle = (record = {}) => String(firstValue(
  record.assignment_cycle_id,
  record.assignmentCycleId,
  record.AssignmentCycleId,
  record.faculty_section_id,
  record.facultySectionId
) ?? '').trim();

const recordSubject = (record = {}) => firstValue(
  record.subject_code,
  record.subjectCode,
  record.SubjectCode,
  record.course,
  record.Course
);

const recordSections = (record = {}) => [
  record.record_section,
  record.recordSection,
  record.section,
  record.Section,
].map(normalizeFacultyGradeIdentity).filter(Boolean);

export const facultyGradeRecordMatchesAssignment = (record = {}, assignment = {}) => {
  const expectedCycle = String(firstValue(
    assignment.assignmentCycleId,
    assignment.facultySectionId,
    assignment.id
  ) ?? '').trim();
  const actualCycle = recordAssignmentCycle(record);

  if (expectedCycle && actualCycle) return expectedCycle === actualCycle;
  if (expectedCycle && !actualCycle) {
    const expectedSubject = normalizeFacultyGradeIdentity(assignment.subjectCode);
    const expectedSections = [
      assignment.canonicalSection,
      assignment.section,
      assignment.sectionName,
    ].map(normalizeFacultyGradeIdentity).filter(Boolean);
    const subjectMatches = expectedSubject &&
      normalizeFacultyGradeIdentity(recordSubject(record)) === expectedSubject;
    const sectionMatches = recordSections(record).some((section) => expectedSections.includes(section));
    return Boolean(subjectMatches && sectionMatches);
  }

  return false;
};

const recordStudentIdentities = (record = {}) => [
  record.student_no,
  record.studentNo,
  record.StudentNo,
  record.student_id,
  record.studentId,
  record.StudentId,
  record.student_hash,
  record.studentHash,
  record.StudentHash,
].map(normalizeFacultyGradeIdentity).filter(Boolean);

const rosterStudentIdentities = (student = {}) => [
  student.studentNumber,
  student.studentNo,
  student.studentno,
  student.student_number,
  student.email,
  student.studentEmail,
].map(normalizeFacultyGradeIdentity).filter(Boolean);

const recordTimestamp = (record = {}) => {
  const value = firstValue(
    record.recorded_at,
    record.recordedAt,
    record.timestamp,
    record.Timestamp,
    record.date,
    record.Date
  );
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const recordVersion = (record = {}) => Number(firstValue(
  record.grade_version,
  record.gradeVersion,
  record.version,
  record.Version,
  0
)) || 0;

const parsedRecord = (record, index) => ({
  record,
  index,
  term: normalizeTerm(firstValue(record.term, record.Term)),
  payload: parseFacultyGradePayload(firstValue(record.grade, record.Grade), firstValue(record.term, record.Term)),
  timestamp: recordTimestamp(record),
  version: recordVersion(record),
});

const preferRecordForTerm = (records, term) => records
  .filter((entry) => entry.payload[term] !== '' ||
    (entry.term === term && entry.payload.standing !== 'active'))
  .sort((left, right) => {
    const leftExact = left.term === term ? 1 : 0;
    const rightExact = right.term === term ? 1 : 0;
    return rightExact - leftExact ||
      right.version - left.version ||
      right.timestamp - left.timestamp ||
      right.index - left.index;
  })[0] || null;

export const mergeFacultyStudentGradeRecords = (records = [], student = {}, activeTerm = 'midterm') => {
  const expectedIdentities = new Set(rosterStudentIdentities(student));
  const matchingRecords = records
    .filter((record) => recordStudentIdentities(record).some((identity) => expectedIdentities.has(identity)))
    .map(parsedRecord);
  const midtermRecord = preferRecordForTerm(matchingRecords, 'midterm');
  const finalsRecord = preferRecordForTerm(matchingRecords, 'finals');
  const activeRecord = normalizeTerm(activeTerm) === 'finals' ? finalsRecord : midtermRecord;
  const standingRecord = activeRecord || finalsRecord || midtermRecord;

  return {
    midterm: midtermRecord?.payload.midterm ?? '',
    finals: finalsRecord?.payload.finals ?? '',
    standing: standingRecord?.payload.standing || 'active',
    flagged: matchingRecords.some((entry) => entry.payload.flagged),
    matchedRecordCount: matchingRecords.length,
  };
};
