import React, { useEffect, useMemo, useState } from 'react';
import BoundedSelect from './BoundedSelect';

const ordinal = (year) => `${year}${year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th'} Year`;
const semesterLabels = { FIRST: 'First Semester', SECOND: 'Second Semester', MIDYEAR: 'Summer / Midyear' };
const semesterOrder = { FIRST: 1, SECOND: 2, MIDYEAR: 3 };

const CurriculumViewer = ({ curricula = [], currentYear = 0, loading = false, emptyMessage = 'No published curriculum is available.', progressBySubject = null, showInternalMetadata = true }) => {
  const [selectedId, setSelectedId] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [semesterFilter, setSemesterFilter] = useState('all');
  useEffect(() => { if (curricula.length && !curricula.some((item) => String(item.curriculumId) === String(selectedId))) setSelectedId(String(curricula[0].curriculumId)); }, [curricula, selectedId]);
  const curriculum = useMemo(() => curricula.find((item) => String(item.curriculumId) === String(selectedId)) || curricula[0], [curricula, selectedId]);
  const subjects = useMemo(() => Array.isArray(curriculum?.subjects) ? curriculum.subjects : [], [curriculum]);
  const years = useMemo(() => [...new Set(subjects.map((subject) => Number(subject.yearLevel)).filter(Number.isInteger))].sort((a, b) => a - b), [subjects]);
  const semesters = useMemo(() => [...new Set(subjects.map((subject) => String(subject.semester || '').toUpperCase()).filter(Boolean))]
    .sort((a, b) => (semesterOrder[a] || 99) - (semesterOrder[b] || 99)), [subjects]);
  const filteredSubjects = useMemo(() => subjects.filter((subject) =>
    (yearFilter === 'all' || String(subject.yearLevel) === yearFilter) &&
    (semesterFilter === 'all' || String(subject.semester).toUpperCase() === semesterFilter)), [subjects, yearFilter, semesterFilter]);

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading curriculum checklist…</div>;
  if (!curriculum) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">{emptyMessage}</div>;

  const groups = years.filter((year) => yearFilter === 'all' || yearFilter === String(year)).flatMap((year) => semesters
    .filter((semester) => semesterFilter === 'all' || semesterFilter === semester)
    .map((semester) => ({ year, semester, rows: filteredSubjects.filter((subject) => Number(subject.yearLevel) === year && String(subject.semester).toUpperCase() === semester) })))
    .filter((group) => group.rows.length > 0);

  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">{curriculum.programCode} · {curriculum.status}</p><h2 className="break-words text-xl font-bold text-[#003366]">{curriculum.curriculumName}</h2><p className="mt-1 break-words text-sm text-slate-500">{curriculum.programName}{showInternalMetadata && curriculum.curriculumVersion ? ` · Version ${curriculum.curriculumVersion}` : ''}{curriculum.schoolYear ? ` · ${curriculum.schoolYear}` : ''}</p></div>{curricula.length > 1 ? <BoundedSelect label="Curriculum" value={selectedId} onChange={setSelectedId} options={curricula.map((item) => ({ value: item.curriculumId, label: `${item.programCode}${showInternalMetadata && item.curriculumVersion ? ` — ${item.curriculumVersion}` : ''}` }))} searchable /> : null}</div>
    {showInternalMetadata && curriculum.submittedAt ? <p className="mb-4 text-xs text-slate-500">Submitted for approval: {new Date(curriculum.submittedAt).toLocaleString()}</p> : null}
    <div className="mb-5 grid gap-3 sm:grid-cols-2" aria-label="Curriculum filters">
      <BoundedSelect label="Year Level" value={yearFilter} onChange={setYearFilter} options={[{ value: 'all', label: 'All Year Levels' }, ...years.map((year) => ({ value: String(year), label: `${ordinal(year)}${Number(currentYear) === year ? ' · Current' : ''}` }))]} />
      <BoundedSelect label="Semester" value={semesterFilter} onChange={setSemesterFilter} options={[{ value: 'all', label: 'All Semesters' }, ...semesters.map((semester) => ({ value: semester, label: semesterLabels[semester] || semester }))]} />
    </div>
    {groups.map(({ year, semester, rows }) => {
      const total = rows.reduce((sum, subject) => sum + Number(subject.units || 0), 0);
      return <div key={`${year}-${semester}`} className="mb-7 last:mb-0"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-slate-800">{ordinal(year)} · {semesterLabels[semester] || semester}</h3><span className="text-sm font-semibold text-slate-600">Total Units: {total}</span></div><div className="max-w-full overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[820px] table-fixed divide-y divide-slate-200 text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="w-28 px-4 py-3">Code</th><th className="w-56 px-4 py-3">Subject</th><th className="w-20 px-4 py-3">Units</th><th className="w-24 px-4 py-3">Lecture</th><th className="w-28 px-4 py-3">Laboratory</th><th className="w-40 px-4 py-3">Prerequisite</th><th className="w-32 px-4 py-3">Category</th>{progressBySubject ? <><th className="w-32 px-4 py-3">Status</th><th className="w-28 px-4 py-3">Grade</th></> : null}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((subject) => { const progress = progressBySubject?.[String(subject.subjectCode).trim().toUpperCase()]; const status = progress?.status || 'Not Yet Taken'; const rowClass = status === 'Completed' ? 'bg-emerald-50/60 text-slate-800' : status === 'In Progress' ? 'bg-amber-50/70 text-slate-800' : status === 'Not Yet Taken' ? 'bg-slate-200/80 text-slate-600' : 'bg-red-50/60 text-slate-800'; return <tr key={subject.subjectId} data-progress-status={status} className={rowClass}><td className="break-words px-4 py-3 font-bold text-[#003366]">{subject.subjectCode}</td><td className="break-words px-4 py-3">{subject.subjectTitle}</td><td className="px-4 py-3">{subject.units}</td><td className="px-4 py-3">{subject.lectureHours}</td><td className="px-4 py-3">{subject.laboratoryHours}</td><td className="break-words px-4 py-3">{subject.prerequisite || 'None'}</td><td className="break-words px-4 py-3">{subject.subjectType || '—'}</td>{progressBySubject ? <><td className="break-words px-4 py-3 font-semibold">{status}</td><td className="break-words px-4 py-3">{progress?.grade || 'Not Yet Available'}</td></> : null}</tr>; })}</tbody></table></div></div>;
    })}
    {!filteredSubjects.length ? <div className="rounded-xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">No subjects match the selected Year Level and Semester.</div> : null}
    <div className="mt-4 flex justify-end border-t border-slate-200 pt-4 text-sm font-bold text-[#003366]">Overall Curriculum Units: {curriculum.totalUnits ?? subjects.reduce((sum, subject) => sum + Number(subject.units || 0), 0)}</div>
  </section>;
};

export default CurriculumViewer;
