import React, { useMemo } from 'react';
import { getGradeEquivalent } from '../../utils/gradingHelpers';

const yearLabels = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
const semesterOrder = ['1st Semester', 'First Semester', '2nd Semester', 'Second Semester', 'Midyear', 'Summer'];

const displayEquivalent = (grade) => {
  const numericGrade = Number(grade.finalAverage || grade.grade);
  if (!Number.isFinite(numericGrade)) return '—';
  return numericGrade > 5 ? getGradeEquivalent(numericGrade) : numericGrade.toFixed(2);
};

const StudentHistoricalGrades = ({ grades = [], loading = false, error = '', emptyMessage = '' }) => {
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
        semesters: [...semesters.entries()].sort(([left], [right]) => semesterRank(left) - semesterRank(right)),
      }));
  }, [grades]);

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading your finalized grade history…</div>;

  if (error) return <section className="rounded-2xl border border-red-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-xl font-bold text-[#003366]">My Grades</h2><div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">{error}</div></section>;

  if (grades.length === 0) return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-xl font-bold text-[#003366]">My Grades</h2><div className="mt-5 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{emptyMessage || 'There are currently no grade records available.'}</div></section>;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="mb-5 text-xl font-bold text-[#003366]">My Grades</h2>
      {groupedGrades.map(({ schoolYear, semesters }) => {
        const headingId = `school-year-${schoolYear.replace(/[^a-z0-9]/gi, '-')}`;
        return <section key={schoolYear} className="mb-8 last:mb-0" aria-labelledby={headingId}>
          <h3 id={headingId} className="mb-4 border-b border-blue-100 pb-2 text-lg font-bold text-[#003366]">School Year {schoolYear}</h3>
          {semesters.map(([semester, semesterGrades]) => <div key={`${schoolYear}-${semester}`} className="mb-7 last:mb-0">
            <h4 className="mb-3 text-base font-bold text-slate-800">{semester}</h4>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr>
                  <th className="px-4 py-3">Subject</th><th className="px-4 py-3">Professor</th><th className="px-4 py-3">Units</th><th className="px-4 py-3">Year Level</th><th className="px-4 py-3">Term</th><th className="px-4 py-3">Grade</th><th className="px-4 py-3">Equivalent</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Transaction</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">{semesterGrades.map((grade, index) => <tr key={`${grade.recordId}-${grade.term}-${index}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><span className="block font-bold text-[#003366]">{grade.subjectCode}</span><span className="text-slate-600">{grade.subjectTitle}</span></td>
                  <td className="px-4 py-3 text-slate-700">{grade.professor || 'Not recorded'}</td><td className="px-4 py-3">{grade.units || '—'}</td><td className="px-4 py-3">{yearLabels[Number(grade.yearLevel)] || grade.yearLevel || '—'}</td><td className="px-4 py-3 capitalize">{grade.term}</td><td className="px-4 py-3 font-bold">{grade.grade || '—'}</td><td className="px-4 py-3 font-bold text-[#003366]">{displayEquivalent(grade)}</td><td className="px-4 py-3"><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">{grade.status}</span></td><td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs" title={grade.transactionHash || grade.transactionId}>{grade.transactionHash || grade.transactionId || 'Legacy record'}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>)}
        </section>;
      })}
    </section>
  );
};

export default StudentHistoricalGrades;
