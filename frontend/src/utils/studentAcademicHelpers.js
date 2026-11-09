import { getGradeEquivalent } from './gradingHelpers';

export const normalizeAcademicSemester = (value = '') => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

export const canonicalAcademicSchoolYear = (value) => {
  const trimmed = String(value || '').trim().replace(/[‐‑‒–—―−]/g, '-');
  if (/^\d{4}$/.test(trimmed) && Number(trimmed) < 9999)
    return `${trimmed}-${Number(trimmed) + 1}`;
  const range = trimmed.match(/^(\d{4})\s*[-/]\s*(\d{4})$/);
  return range && Number(range[2]) === Number(range[1]) + 1 ? `${range[1]}-${range[2]}` : trimmed;
};

export const canonicalAcademicSemester = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]/g, ' ');
  if (['first', '1', '1st', 'first semester', '1st semester'].includes(normalized)) return 'FIRST';
  if (['second', '2', '2nd', 'second semester', '2nd semester'].includes(normalized)) return 'SECOND';
  if (['midyear', 'mid year', 'summer'].includes(normalized)) return 'MIDYEAR';
  return String(value || '').trim();
};

export const finalizedSubjectGrades = (grades = []) => {
  const bySubject = new Map();
  grades.filter((record) => String(record.status).toLowerCase() === 'finalized').forEach((record) => {
    const code = String(record.subjectCode || '').trim().toUpperCase();
    if (!code) return;
    const existing = bySubject.get(code);
    const grade = record.finalAverage || (String(record.term).toLowerCase() === 'finals' ? record.grade : '');
    if (!grade || !Number.isFinite(Number(grade))) return;
    const period = `${canonicalAcademicSchoolYear(record.schoolYear)}|${canonicalAcademicSemester(record.semester)}`;
    if (!existing || period >= existing.period) bySubject.set(code, { ...record, grade, period });
  });
  return bySubject;
};

export const isCrossCurriculumSubject = (subject) =>
  Boolean(
    subject?.isCrossAssigned ||
    subject?.isNonRegular ||
    subject?.isCrossDepartmentAssigned ||
    Number(subject?.priority) === 0 ||
    String(subject?.subjectClassification || '').toUpperCase() === 'NON-REGULAR'
  );

const semesterSortOrder = (semester) => {
  const canonical = canonicalAcademicSemester(semester);
  if (canonical === 'FIRST') return 1;
  if (canonical === 'SECOND') return 2;
  if (canonical === 'MIDYEAR') return 3;
  return 99;
};

export const sortCurriculumSubjects = (subjects = []) =>
  [...(Array.isArray(subjects) ? subjects : [])].sort((a, b) => {
    const priorityDiff = (isCrossCurriculumSubject(a) ? 0 : 1) - (isCrossCurriculumSubject(b) ? 0 : 1);
    if (priorityDiff !== 0) return priorityDiff;
    const yearDiff = (Number(a?.yearLevel) || 0) - (Number(b?.yearLevel) || 0);
    if (yearDiff !== 0) return yearDiff;
    const semDiff = semesterSortOrder(a?.semester) - semesterSortOrder(b?.semester);
    if (semDiff !== 0) return semDiff;
    return String(a?.subjectCode || '').localeCompare(String(b?.subjectCode || ''));
  });

export const curriculumProgress = (subjects = [], currentSubjects = [], grades = [], currentEnrollment = null) => {
  const finalized = finalizedSubjectGrades(grades);
  const enrolled = new Set(currentSubjects.map((subject) => String(subject.subjectCode || '').trim().toUpperCase()));
  const progress = {};
  subjects.forEach((subject) => {
    const code = String(subject.subjectCode || '').trim().toUpperCase();
    const record = finalized.get(code);
    const backendCompleted = Boolean(
      subject?.isCompleted ||
      subject?.isCredited ||
      String(subject?.completionStatus || '').toUpperCase() === 'COMPLETED'
    );
    const backendNeedsRetake = Boolean(
      subject?.needsRetake ||
      String(subject?.completionStatus || '').toUpperCase() === 'NEEDS_RETAKE'
    );
    const backendGrade = subject?.finalGrade !== undefined && subject?.finalGrade !== null && subject?.finalGrade !== ''
      ? String(subject.finalGrade)
      : null;
    const equivalent = record
      ? Number(record.grade) > 5 ? Number(getGradeEquivalent(record.grade)) : Number(record.grade)
      : backendCompleted && backendGrade && Number.isFinite(Number(backendGrade))
      ? (Number(backendGrade) > 5 ? Number(getGradeEquivalent(backendGrade)) : Number(backendGrade))
      : null;
    const isCurrent = enrolled.has(code);
    const finalizedThisPeriod = record && currentEnrollment &&
      canonicalAcademicSchoolYear(record.schoolYear) === canonicalAcademicSchoolYear(currentEnrollment.schoolYear) &&
      canonicalAcademicSemester(record.semester) === canonicalAcademicSemester(currentEnrollment.semester);
    progress[code] = backendNeedsRetake
      ? { status: 'Needs Retake', grade: backendGrade || record?.grade || null }
      : isCurrent && !finalizedThisPeriod && !backendCompleted
      ? { status: 'In Progress', grade: null }
      : record
      ? { status: equivalent >= 5 ? 'Failed' : 'Completed', grade: record.grade, isCredited: Boolean(subject?.isCredited) }
      : backendCompleted
      ? { status: equivalent !== null && equivalent >= 5 ? 'Failed' : 'Completed', grade: backendGrade || 'Credited', isCredited: true }
      : { status: isCurrent ? 'In Progress' : 'Not Yet Taken', grade: null };
  });
  return progress;
};
