import React, { useMemo, useState } from 'react';
import { getGradeEquivalent } from '../../utils/gradingHelpers';
import StatusBadge from '../shared/StatusBadge';

const VIEW_KEY = 'blockgo.student.grades.view';
const yearLabels = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
const semesterOrder = ['1st Semester', 'First Semester', 'FIRST', '2nd Semester', 'Second Semester', 'SECOND', 'Midyear', 'MIDYEAR', 'Summer'];

const displayEquivalent = (grade) => {
  const numericGrade = Number(grade.finalAverage || grade.finalGrade || grade.grade);
  if (!Number.isFinite(numericGrade)) return '—';
  return numericGrade > 5 ? getGradeEquivalent(numericGrade) : numericGrade.toFixed(2);
};

const mergeTerms = (grades) => {
  const records = new Map();
  grades.forEach((grade, index) => {
    const key = grade.recordId || `${grade.subjectCode}-${index}`;
    const current = records.get(key) || { ...grade, midtermGrade: '—', finalGrade: '—' };
    const term = String(grade.term || '').toLowerCase();
    if (term.includes('mid')) current.midtermGrade = grade.grade || '—';
    else current.finalGrade = grade.grade || '—';
    current.finalAverage = grade.finalAverage || current.finalAverage || grade.grade;
    records.set(key, current);
  });
  return [...records.values()];
};

const releasedStatus = (status) => (
  String(status || '').toLowerCase() === 'finalized' ? 'Released' : (status || 'Released')
);

const ViewIcon = ({ table = false }) => table ? (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4"><path d="M3 4h14M3 10h14M3 16h14" /></svg>
) : (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4"><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></svg>
);

const StudentHistoricalGrades = ({ grades = [], loading = false, error = '', emptyMessage = '' }) => {
  const [view, setView] = useState(() => {
    try { return sessionStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards'; }
    catch { return 'cards'; }
  });
  const [expandedCard, setExpandedCard] = useState('');

  const selectView = (nextView) => {
    setView(nextView);
    try { sessionStorage.setItem(VIEW_KEY, nextView); } catch { /* storage may be unavailable */ }
  };

  const groupedGrades = useMemo(() => {
    const schoolYears = new Map();
    grades.forEach((grade) => {
      const schoolYear = grade.schoolYear || 'Unspecified';
      const semester = grade.semester || 'Unspecified Semester';
      if (!schoolYears.has(schoolYear)) schoolYears.set(schoolYear, new Map());
      const semesters = schoolYears.get(schoolYear);
      if (!semesters.has(semester)) semesters.set(semester, []);
      semesters.get(semester).push(grade);
    });
    const semesterRank = (semester) => {
      const index = semesterOrder.findIndex((value) => value.toLowerCase() === String(semester).toLowerCase());
      return index < 0 ? 99 : index;
    };
    return [...schoolYears.entries()]
      .sort(([left], [right]) => String(right).localeCompare(String(left), undefined, { numeric: true }))
      .map(([schoolYear, semesters]) => ({
        schoolYear,
        semesters: [...semesters.entries()]
          .sort(([left], [right]) => semesterRank(left) - semesterRank(right))
          .map(([semester, rows]) => [semester, mergeTerms(rows)]),
      }));
  }, [grades]);

  if (loading) return (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm" role="status">
      <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#003366]" />
      <p className="mt-3 text-sm font-medium text-slate-500">Loading released grades…</p>
    </div>
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Student Records</p><h2 className="text-xl font-bold text-[#003366]">My Grades</h2><p className="mt-1 text-sm text-slate-500">Only finalized grades released by the Registrar appear here.</p></div>
        <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1" aria-label="Grade view">
          {['cards', 'table'].map((option) => (
            <button key={option} type="button" onClick={() => selectView(option)} aria-pressed={view === option} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${view === option ? 'bg-white text-[#003366] shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}>
              <ViewIcon table={option === 'table'} />{option === 'cards' ? 'Cards' : 'Table'}
            </button>
          ))}
        </div>
      </header>

      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-800">{error}</div> : null}
      {!error && grades.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-slate-500">{emptyMessage || 'No released grades are available for this term yet.'}</div> : null}

      {!error && grades.length > 0 ? groupedGrades.map(({ schoolYear, semesters }) => {
        const headingId = `school-year-${schoolYear.replace(/[^a-z0-9]/gi, '-')}`;
        return (
          <section key={schoolYear} className="mb-8 last:mb-0" aria-labelledby={headingId}>
            <h3 id={headingId} className="mb-4 border-b border-blue-100 pb-2 text-lg font-bold text-[#003366]">School Year {schoolYear}</h3>
            {semesters.map(([semester, semesterGrades]) => (
              <div key={`${schoolYear}-${semester}`} className="mb-7 last:mb-0">
                <h4 className="mb-3 text-base font-bold text-slate-800">{semester}</h4>
                {view === 'cards' ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {semesterGrades.map((grade, index) => {
                      const cardKey = `${schoolYear}-${semester}-${grade.recordId || grade.subjectCode}-${index}`;
                      const expanded = expandedCard === cardKey;
                      return (
                        <article key={cardKey} className="flex h-full min-h-[290px] flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><p className="text-lg font-extrabold tracking-tight text-[#003366]">{grade.subjectCode || 'Subject'}</p><h5 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5 text-slate-800">{grade.subjectTitle || 'Untitled subject'}</h5></div>
                            <StatusBadge status={releasedStatus(grade.status)} />
                          </div>
                          <div className="mt-4 flex items-center justify-between border-y border-slate-100 py-3 text-sm"><span className="text-slate-500">{grade.units || '—'} Units</span><span className="text-xs font-medium text-slate-500">{yearLabels[Number(grade.yearLevel)] || grade.yearLevel || 'Year not recorded'}</span></div>
                          <div className="mt-4 grid grid-cols-2 gap-5">
                            <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Midterm</p><p className="mt-1 text-xl font-bold text-slate-800">{grade.midtermGrade}</p></div>
                            <div className="border-l border-slate-200 pl-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final Grade</p><p className="mt-1 text-2xl font-extrabold text-[#003366]">{displayEquivalent(grade)}</p></div>
                          </div>
                          <div className="mt-4"><p className="text-xs font-semibold text-slate-500">Faculty</p><p className="mt-0.5 truncate text-sm font-medium text-slate-800" title={grade.professor || 'Not recorded'}>{grade.professor || 'Not recorded'}</p></div>
                          {expanded ? <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs"><div><dt className="text-slate-500">Section</dt><dd className="mt-0.5 font-semibold text-slate-700">{grade.section || 'Not recorded'}</dd></div><div><dt className="text-slate-500">Term</dt><dd className="mt-0.5 font-semibold capitalize text-slate-700">{grade.term || 'Finals'}</dd></div></dl> : null}
                          <button type="button" onClick={() => setExpandedCard(expanded ? '' : cardKey)} aria-expanded={expanded} className="mt-auto pt-4 text-left text-sm font-bold text-blue-700 hover:text-[#003366] hover:underline">{expanded ? 'Hide Details' : 'View Details'}</button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Subject Code</th><th className="px-4 py-3">Subject Name</th><th className="px-4 py-3">Units</th><th className="px-4 py-3">Midterm</th><th className="px-4 py-3">Final Grade</th><th className="px-4 py-3">Faculty</th><th className="px-4 py-3">Status</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">{semesterGrades.map((grade, index) => <tr key={`${grade.recordId}-${index}`} className="hover:bg-slate-50"><td className="whitespace-nowrap px-4 py-3 font-bold text-[#003366]">{grade.subjectCode}</td><td className="px-4 py-3 text-slate-700">{grade.subjectTitle}</td><td className="px-4 py-3">{grade.units || '—'}</td><td className="px-4 py-3 font-semibold">{grade.midtermGrade}</td><td className="px-4 py-3 font-bold text-[#003366]">{displayEquivalent(grade)}</td><td className="px-4 py-3 text-slate-700">{grade.professor || 'Not recorded'}</td><td className="px-4 py-3"><StatusBadge status={releasedStatus(grade.status)} /></td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      }) : null}
    </section>
  );
};

export default StudentHistoricalGrades;
