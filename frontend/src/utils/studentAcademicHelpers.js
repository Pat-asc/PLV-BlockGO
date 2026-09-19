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

export const curriculumProgress = (subjects = [], currentSubjects = [], grades = [], currentEnrollment = null) => {
  const finalized = finalizedSubjectGrades(grades);
  const enrolled = new Set(currentSubjects.map((subject) => String(subject.subjectCode || '').trim().toUpperCase()));
  const progress = {};
  subjects.forEach((subject) => {
    const code = String(subject.subjectCode || '').trim().toUpperCase();
    const record = finalized.get(code);
    const equivalent = record ? Number(record.grade) > 5 ? Number(getGradeEquivalent(record.grade)) : Number(record.grade) : null;
    const isCurrent = enrolled.has(code);
    const finalizedThisPeriod = record && currentEnrollment &&
      canonicalAcademicSchoolYear(record.schoolYear) === canonicalAcademicSchoolYear(currentEnrollment.schoolYear) &&
      canonicalAcademicSemester(record.semester) === canonicalAcademicSemester(currentEnrollment.semester);
    progress[code] = isCurrent && !finalizedThisPeriod
      ? { status: 'In Progress', grade: null }
      : record
      ? { status: equivalent >= 5 ? 'Failed' : 'Completed', grade: record.grade }
      : { status: isCurrent ? 'In Progress' : 'Not Yet Taken', grade: null };
  });
  return progress;
};
