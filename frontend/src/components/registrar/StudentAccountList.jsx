import React, { useMemo, useState } from 'react';
import { getCanonicalProgramName } from '../../utils/studentSectioningHelpers';

const normalized = (value) => String(value || '').trim().toLowerCase().replace(/[,\s]+/g, ' ');
const yearOf = (student) => String(student.yearLevel || '').match(/^[1-4]/)?.[0] || '';
const sectionOf = (student) => {
  const section = String(student.section || '').trim();
  if (!section || /^unassigned$/i.test(section)) return '';
  const code = section.match(/(\d+)\s*-\s*(\d+)$/);
  return code ? `${code[1]}-${code[2]}` : section;
};
const controlClass = 'min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export const mergeStudentAccountEnrollments = (accounts, enrollments, period) => {
  const matching = enrollments.filter((student) => student.schoolYear === period.schoolYear && student.semester === period.semester);
  const current = new Map([...matching].sort((a, b) => Number(a.enrollmentId) - Number(b.enrollmentId))
    .map((student) => [String(student.id), student]));
  const all = new Map([...accounts, ...matching].map((student) => [String(student.id), student]));
  return [...all.values()].map((student) => current.get(String(student.id)) || {
    ...student,
    enrollmentId: null,
    academicSectionId: null,
    section: null,
    yearLevel: '',
    schoolYear: period.schoolYear,
    semester: period.semester,
    enrollmentStatus: null,
    enrollmentState: null,
    assignmentStatus: 'Unassigned',
    sectionStatus: 'Unassigned',
    crossDepartment: null,
    crossSubjectCode: null,
    crossSection: null,
    crossFacultyName: null,
    crossSubjects: [],
    nonRegularSubjects: [],
  });
};

export const resolveStudentAccountPeriod = (accounts, activePeriod) => {
  const rank = { FIRST: 1, SECOND: 2, MIDYEAR: 3 };
  const periods = accounts.filter((student) => student.enrollmentId &&
    String(student.enrollmentStatus).toUpperCase() === 'ENROLLED' &&
    /^\d{4}-\d{4}$/.test(student.schoolYear) && rank[student.semester]);
  const period = [...periods, ...(activePeriod ? [activePeriod] : [])].sort((a, b) =>
    b.schoolYear.localeCompare(a.schoolYear) || rank[b.semester] - rank[a.semester])[0];
  return period ? { schoolYear: period.schoolYear, semester: period.semester } : null;
};

export default function StudentAccountList({ students, programs, children, pageSize = 20, loading = false }) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [page, setPage] = useState(1);
  const programName = (value) => {
    const match = programs.find((program) => [program.name, program.code]
      .some((candidate) => normalized(candidate) === normalized(value)));
    return getCanonicalProgramName(match?.name || value);
  };
  const departmentOf = (student) => programName(student.department || student.homeProgram || student.programCode);
  // The API returns one current-period enrollment per account; retain stable account
  // identity if a legacy response nevertheless repeats a row.
  const accounts = useMemo(() => [...new Map(students.map((student) => [
    student.id ?? student.studentno, student,
  ])).values()], [students]);
  const departments = [...new Set(programs.map((program) => programName(program.name)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const scoped = accounts.filter((student) =>
    (!department || normalized(departmentOf(student)) === normalized(department)) &&
    (!year || yearOf(student) === year));
  const sections = [...new Set(scoped.map(sectionOf).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const query = normalized(search);
  const filtered = scoped.filter((student) => {
    const name = normalized(student.fullname || student.fullName);
    return (!query || normalized(student.studentno || student.studentNo).includes(query) ||
      query.split(' ').every((part) => name.includes(part))) &&
      (!section || (section === '__unassigned__' ? !sectionOf(student) : sectionOf(student) === section));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visiblePage = Math.min(page, pageCount);
  const change = (setter, value) => { setter(value); setPage(1); };
  const clear = () => { setSearch(''); setDepartment(''); setYear(''); setSection(''); setPage(1); };

  return (
    <>
      <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="relative">
          <input aria-label="Search student accounts" placeholder="Search by Student ID or Student Name..."
            value={search} onChange={(event) => change(setSearch, event.target.value)}
            className={`${controlClass} pr-12`} />
          {search && <button type="button" aria-label="Clear student search" onClick={() => change(setSearch, '')}
            className="absolute right-1 top-1 min-h-8 min-w-9 rounded text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">×</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.8fr_1fr_1fr_auto]">
          <select aria-label="Filter student department" value={department} className={controlClass}
            onChange={(event) => { change(setDepartment, event.target.value); setSection(''); }}>
            <option value="">All Departments</option>
            {departments.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filter student year level" value={year} className={controlClass}
            onChange={(event) => { change(setYear, event.target.value); setSection(''); }}>
            <option value="">All Year Levels</option>
            {['1st', '2nd', '3rd', '4th'].map((label, index) => <option key={label} value={index + 1}>{label} Year</option>)}
          </select>
          <select aria-label="Filter student section" value={section} className={controlClass}
            onChange={(event) => change(setSection, event.target.value)}>
            <option value="">All Sections</option>
            <option value="__unassigned__">Unassigned</option>
            {sections.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button type="button" onClick={clear} className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Clear Filters</button>
        </div>
        <p role="status" className="text-xs text-slate-600 dark:text-slate-300">{loading ? 'Loading student accounts...' : `${filtered.length} matching student${filtered.length === 1 ? '' : 's'}`}</p>
      </div>
      <div className="space-y-4 p-4">
        {loading ? null : filtered.length ? filtered.slice((visiblePage - 1) * pageSize, visiblePage * pageSize).map(children) :
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-300">No students found matching your search and filters</p>}
      </div>
      {pageCount > 1 && <nav aria-label="Student account pagination" className="flex items-center justify-end gap-3 px-4 pb-4 text-sm text-slate-700 dark:text-slate-200">
        <button type="button" disabled={visiblePage === 1} onClick={() => setPage(visiblePage - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Previous</button>
        <span>Page {visiblePage} of {pageCount}</span>
        <button type="button" disabled={visiblePage === pageCount} onClick={() => setPage(visiblePage + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Next</button>
      </nav>}
    </>
  );
}
