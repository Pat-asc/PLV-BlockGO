const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const programIdOf = (record) => clean(record.program_id ?? record.programId);
const programCodeOf = (record) => clean(record.program_code ?? record.programCode ?? record.program);
const programNameOf = (record) => clean(record.program_name ?? record.programName ?? record.course);

export const canonicalizeLedgerPrograms = (records = [], programs = []) => {
  const canonicalPrograms = new Map();
  const programsByAlias = new Map();

  programs.forEach((program) => {
    const id = clean(program.programId ?? program.program_id);
    if (!id || canonicalPrograms.has(id)) return;
    const canonical = {
      id,
      code: clean(program.programCode ?? program.program_code),
      name: clean(program.programName ?? program.program_name),
    };
    canonicalPrograms.set(id, canonical);
    [canonical.code, canonical.name].filter(Boolean).forEach((alias) => programsByAlias.set(lower(alias), canonical));
  });

  return records.map((record) => {
    const exactId = programIdOf(record);
    const canonical = canonicalPrograms.get(exactId) || [
      record.program_code, record.programCode, record.program_name, record.programName,
      record.program, record.course,
    ].map((value) => programsByAlias.get(lower(value))).find(Boolean);
    if (!canonical) return record;
    return {
      ...record,
      program_id: Number(canonical.id),
      program_code: canonical.code,
      program_name: canonical.name,
      programId: Number(canonical.id),
      programCode: canonical.code,
      programName: canonical.name,
    };
  });
};

export const parseLedgerGrade = (rawGrade) => {
  if (rawGrade && typeof rawGrade === 'object') return { ...rawGrade };
  if (!clean(rawGrade)) return {};
  try {
    const parsed = JSON.parse(rawGrade);
    return parsed && typeof parsed === 'object' ? parsed : { finalAverage: rawGrade };
  } catch {
    return { finalAverage: rawGrade };
  }
};

const canonicalTerm = (value) => {
  const normalized = lower(value);
  if (normalized === 'final' || normalized === 'finals') return 'finals';
  if (normalized === 'midterm' || normalized === 'midterms') return 'midterm';
  return normalized;
};

const recordTerm = (record) => {
  const explicit = canonicalTerm(record.term || record.Term);
  if (explicit) return explicit;
  const payload = parseLedgerGrade(record.grade || record.Grade);
  return clean(payload.finals || payload.final) ? 'finals' : 'midterm';
};

const statusRank = (status) => {
  const normalized = lower(status).replace(/[\s_]/g, '');
  if (normalized === 'finalized' || normalized === 'issued' || normalized === 'corrected') return 4;
  if (normalized.includes('approved') || normalized === 'forwardedtoregistrar') return 3;
  if (normalized.includes('submitted')) return 2;
  return 1;
};

const recordTime = (record) => {
  const value = record.timestamp || record.recorded_at || record.date || '';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const nonEmptyPayload = (payload) => Object.fromEntries(
  Object.entries(payload).filter(([, value]) => value !== null && value !== undefined && clean(value) !== '')
);

const mergeStudentRecords = (current, incoming) => {
  if (!current) return { ...incoming, gradePayload: nonEmptyPayload(parseLedgerGrade(incoming.grade || incoming.Grade)) };
  const currentPayload = current.gradePayload || parseLedgerGrade(current.grade || current.Grade);
  const incomingPayload = nonEmptyPayload(parseLedgerGrade(incoming.grade || incoming.Grade));
  const incomingWins = statusRank(incoming.status || incoming.Status) > statusRank(current.status || current.Status) ||
    (statusRank(incoming.status || incoming.Status) === statusRank(current.status || current.Status) && recordTime(incoming) >= recordTime(current));
  const preferred = incomingWins ? incoming : current;
  return {
    ...current,
    ...preferred,
    gradePayload: { ...currentPayload, ...incomingPayload },
    sourceRecordIds: [...(current.sourceRecordIds || [current.id]), incoming.id].filter(Boolean),
  };
};

export const dedupeLogicalLedgerRecords = (records = []) => {
  const logicalRecords = new Map();

  records.forEach((record, index) => {
    const recordId = clean(record.id || record.Id);
    const transactionId = clean(record.transaction_id || record.transaction_hash || record.transactionId || record.transactionHash);
    const studentIdentity = clean(record.student_user_id || record.student_no || record.studentNo || record.studentId || record.student_hash);
    const stableKey = recordId
      ? `record:${lower(recordId)}`
      : transactionId
        ? `transaction:${lower(transactionId)}:${lower(studentIdentity)}:${lower(record.subject_code)}:${recordTerm(record)}`
        : `source-row:${index}`;
    logicalRecords.set(stableKey, mergeStudentRecords(logicalRecords.get(stableKey), record));
  });

  return Array.from(logicalRecords.values());
};

export const filterLedgerRecords = (records = [], filters = {}) => {
  const programId = clean(filters.programId || 'all');
  const schoolYear = clean(filters.schoolYear || 'all');
  const semester = lower(filters.semester || 'all');
  const term = canonicalTerm(filters.term || 'all');
  const status = lower(filters.status || 'all');
  const query = lower(filters.search);

  return records.filter((record) => {
    if (programId !== 'all' && programIdOf(record) !== programId) return false;
    if (schoolYear !== 'all' && clean(record.school_year || record.schoolYear) !== schoolYear) return false;
    if (semester !== 'all' && lower(record.semester) !== semester) return false;
    if (term !== 'all' && recordTerm(record) !== term) return false;
    if (status !== 'all' && lower(record.status) !== status) return false;
    if (!query) return true;
    return [
      record.professor_name, record.faculty_email, record.faculty_id, record.section,
      record.subject_code, record.subject_title, record.subject_name, record.student_no,
      record.studentNo, record.student_name, record.studentName,
    ].some((value) => lower(value).includes(query));
  });
};

export const buildLedgerHierarchy = (records = []) => {
  const programMap = new Map();

  dedupeLogicalLedgerRecords(records).forEach((record) => {
    const assignmentId = clean(record.assignment_cycle_id || record.faculty_section_id);
    const assignmentKey = assignmentId && lower(assignmentId) !== 'legacy'
      ? `assignment:${assignmentId}`
      : `legacy-assignment:${clean(record.id)}`;
    const exactProgramId = Number(programIdOf(record)) > 0 ? programIdOf(record) : '';
    const programKey = exactProgramId || 'unmapped';
    const exactFacultyId = Number(record.faculty_user_id) > 0 ? clean(record.faculty_user_id) : '';
    const facultyKey = exactFacultyId ? `faculty:${exactFacultyId}` : `unmapped-faculty:${assignmentKey}`;
    const exactAcademicSectionId = Number(record.academic_section_id) > 0 ? clean(record.academic_section_id) : '';
    const schoolYear = clean(record.school_year || record.schoolYear);
    const semester = clean(record.semester);
    const sectionKey = exactAcademicSectionId
      ? `section:${exactFacultyId}:${exactAcademicSectionId}:${lower(schoolYear)}:${lower(semester)}`
      : `unmapped-section:${facultyKey}:${assignmentKey}:${lower(schoolYear)}:${lower(semester)}`;
    const subjectCode = clean(record.subject_code) || 'Unknown Subject';
    const term = recordTerm(record);
    const subjectKey = clean(record.subject_code)
      ? `subject:${lower(subjectCode)}:${term}`
      : `unmapped-subject:${assignmentKey}:${term}`;
    const exactStudentId = Number(record.student_user_id) > 0 ? clean(record.student_user_id) : '';
    const officialStudentNumber = clean(record.student_no || record.studentNo || record.studentId);
    const studentKey = exactStudentId
      ? `student:${exactStudentId}`
      : officialStudentNumber ? `student-no:${lower(officialStudentNumber)}` : `record:${clean(record.id)}`;

    if (!programMap.has(programKey)) {
      programMap.set(programKey, {
        key: programKey,
        id: exactProgramId,
        code: programCodeOf(record) || 'Unmapped',
        name: programNameOf(record) || 'Unmapped historical records',
        facultyMap: new Map(),
      });
    }
    const program = programMap.get(programKey);
    if (!program.facultyMap.has(facultyKey)) {
      program.facultyMap.set(facultyKey, {
        key: facultyKey,
        userId: exactFacultyId,
        name: clean(record.professor_name) || clean(record.faculty_email || record.faculty_id) || 'Unknown Faculty',
        email: clean(record.faculty_email || record.faculty_id),
        facultyNumber: clean(record.faculty_number),
        sectionMap: new Map(),
      });
    }
    const faculty = program.facultyMap.get(facultyKey);
    if (!faculty.email) faculty.email = clean(record.faculty_email || record.faculty_id);
    if (!faculty.facultyNumber) faculty.facultyNumber = clean(record.faculty_number);
    if (faculty.name === 'Unknown Faculty' && clean(record.professor_name)) faculty.name = clean(record.professor_name);
    if (!faculty.sectionMap.has(sectionKey)) {
      faculty.sectionMap.set(sectionKey, {
        key: sectionKey,
        academicSectionId: exactAcademicSectionId,
        section: clean(record.section) || 'Unknown Section',
        schoolYear,
        semester,
        subjectMap: new Map(),
      });
    }
    const section = faculty.sectionMap.get(sectionKey);
    if (!section.subjectMap.has(subjectKey)) {
      section.subjectMap.set(subjectKey, {
        key: subjectKey,
        subjectCode,
        subjectName: clean(record.subject_title || record.subject_name),
        term,
        assignmentIds: new Set(),
        studentMap: new Map(),
      });
    }
    const subject = section.subjectMap.get(subjectKey);
    if (assignmentId) subject.assignmentIds.add(assignmentId);
    subject.studentMap.set(studentKey, mergeStudentRecords(subject.studentMap.get(studentKey), record));
  });

  return Array.from(programMap.values()).map((program) => {
    const faculties = Array.from(program.facultyMap.values()).map((faculty) => {
      const sections = Array.from(faculty.sectionMap.values()).map((section) => {
        const subjects = Array.from(section.subjectMap.values()).map((subject) => {
          const students = Array.from(subject.studentMap.entries()).map(([key, record]) => ({
            ...record,
            key,
            studentNumber: clean(record.student_no || record.studentNo || record.studentId) || 'N/A',
            studentName: clean(record.student_name || record.studentName) || 'Unknown Student',
          })).sort((left, right) => left.studentNumber.localeCompare(right.studentNumber));
          const statuses = [...new Set(students.map((student) => clean(student.status)).filter(Boolean))];
          return { ...subject, assignmentIds: [...subject.assignmentIds], students, statuses, gradeRecordCount: students.length };
        }).sort((left, right) => left.subjectCode.localeCompare(right.subjectCode) || left.term.localeCompare(right.term));
        const uniqueStudents = new Set(subjects.flatMap((subject) => subject.students.map((student) => student.key)));
        return {
          ...section,
          subjects,
          subjectCount: subjects.length,
          studentCount: uniqueStudents.size,
          gradeRecordCount: subjects.reduce((count, subject) => count + subject.gradeRecordCount, 0),
        };
      }).sort((left, right) => left.section.localeCompare(right.section) || left.schoolYear.localeCompare(right.schoolYear) || left.semester.localeCompare(right.semester));
      const uniqueStudents = new Set(sections.flatMap((section) => section.subjects.flatMap((subject) => subject.students.map((student) => student.key))));
      return {
        ...faculty,
        sections,
        sectionCount: sections.length,
        subjectCount: sections.reduce((count, section) => count + section.subjectCount, 0),
        studentCount: uniqueStudents.size,
        gradeRecordCount: sections.reduce((count, section) => count + section.gradeRecordCount, 0),
      };
    }).sort((left, right) => left.name.localeCompare(right.name));
    return {
      ...program,
      faculties,
      facultyCount: faculties.length,
      sectionCount: faculties.reduce((count, faculty) => count + faculty.sectionCount, 0),
      subjectCount: faculties.reduce((count, faculty) => count + faculty.subjectCount, 0),
      recordCount: faculties.reduce((count, faculty) => count + faculty.gradeRecordCount, 0),
    };
  }).sort((left, right) => left.code.localeCompare(right.code));
};

export const getLedgerFilterOptions = (records = []) => ({
  schoolYears: [...new Set(records.map((record) => clean(record.school_year || record.schoolYear)).filter(Boolean))].sort().reverse(),
  semesters: [...new Set(records.map((record) => clean(record.semester)).filter(Boolean))].sort(),
  statuses: [...new Set(records.map((record) => clean(record.status)).filter(Boolean))].sort(),
});
