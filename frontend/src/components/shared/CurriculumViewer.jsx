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

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-100 border-t-[#003366] dark:border-slate-700 dark:border-t-sky-300" /><p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">Loading curriculum checklist...</p></div>;
  if (!curriculum) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-400 dark:bg-slate-800 dark:text-slate-500">▤</div><p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">{emptyMessage}</p></div>;

  const groups = years.filter((year) => yearFilter === 'all' || yearFilter === String(year)).flatMap((year) => semesters
    .filter((semester) => semesterFilter === 'all' || semesterFilter === semester)
    .map((semester) => ({ year, semester, rows: filteredSubjects.filter((subject) => Number(subject.yearLevel) === year && String(subject.semester).toUpperCase() === semester) })))
    .filter((group) => group.rows.length > 0);

  return <section data-testid="curriculum-viewer" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <div className="border-b border-slate-200 px-4 py-5 dark:border-slate-700 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">{curriculum.programCode}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{curriculum.status}</span>
          </div>
          <h2 className="break-words text-xl font-bold tracking-tight text-[#003366] dark:text-sky-300 sm:text-2xl">{curriculum.curriculumName}</h2>
          <p className="mt-1 break-words text-sm leading-6 text-slate-500 dark:text-slate-400">{curriculum.programName}{showInternalMetadata && curriculum.curriculumVersion ? ` · Version ${curriculum.curriculumVersion}` : ''}{curriculum.schoolYear ? ` · ${curriculum.schoolYear}` : ''}</p>
          {showInternalMetadata && curriculum.submittedAt ? <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Submitted for approval: {new Date(curriculum.submittedAt).toLocaleString()}</p> : null}
        </div>
        {curricula.length > 1 ? <BoundedSelect label="Curriculum" value={selectedId} onChange={setSelectedId} options={curricula.map((item) => ({ value: item.curriculumId, label: `${item.programCode}${showInternalMetadata && item.curriculumVersion ? ` — ${item.curriculumVersion}` : ''}` }))} searchable className="w-full sm:w-64" /> : null}
      </div>
    </div>

    <div className="p-4 sm:p-6">
    <div className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60 sm:grid-cols-2 sm:p-4" aria-label="Curriculum filters">
      <BoundedSelect label="Year Level" value={yearFilter} onChange={setYearFilter} options={[{ value: 'all', label: 'All Year Levels' }, ...years.map((year) => ({ value: String(year), label: `${ordinal(year)}${Number(currentYear) === year ? ' · Current' : ''}` }))]} />
      <BoundedSelect label="Semester" value={semesterFilter} onChange={setSemesterFilter} options={[{ value: 'all', label: 'All Semesters' }, ...semesters.map((semester) => ({ value: semester, label: semesterLabels[semester] || semester }))]} />
    </div>
    {groups.map(({ year, semester, rows }) => {
      const total = rows.reduce((sum, subject) => sum + Number(subject.units || 0), 0);
      return <div key={`${year}-${semester}`} className="mb-8 last:mb-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{ordinal(year)} <span className="mx-1 text-slate-300 dark:text-slate-600">/</span> {semesterLabels[semester] || semester}</h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Total Units: {total}</span>
        </div>
        <div className="max-w-full xl:overflow-x-auto xl:rounded-xl xl:border xl:border-slate-200 xl:shadow-sm dark:xl:border-slate-700">
          <table className="block w-full text-sm xl:table xl:min-w-[820px] xl:table-fixed xl:divide-y xl:divide-slate-200 dark:xl:divide-slate-700">
            <thead className="hidden bg-slate-100/95 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-slate-800 dark:text-slate-300 xl:table-header-group">
              <tr><th className="w-28 px-4 py-3">Code</th><th className="w-56 px-4 py-3">Subject</th><th className="w-20 px-4 py-3 text-center">Units</th><th className="w-24 px-4 py-3 text-center">Lecture</th><th className="w-28 px-4 py-3 text-center">Laboratory</th><th className="w-40 px-4 py-3">Prerequisite</th><th className="w-32 px-4 py-3">Category</th>{progressBySubject ? <><th className="w-32 px-4 py-3">Status</th><th className="w-28 px-4 py-3">Grade</th></> : null}</tr>
            </thead>
            <tbody className="grid gap-3 xl:table-row-group xl:divide-y xl:divide-slate-100 dark:xl:divide-slate-700">{rows.map((subject, index) => {
              const progress = progressBySubject?.[String(subject.subjectCode).trim().toUpperCase()];
              const status = progress?.status || 'Not Yet Taken';
              const progressClass = status === 'Completed' ? 'bg-emerald-50/60 text-slate-800 dark:bg-emerald-950/40 dark:text-slate-100' : status === 'In Progress' ? 'bg-amber-50/70 text-slate-800 dark:bg-amber-950/40 dark:text-slate-100' : status === 'Not Yet Taken' ? 'bg-slate-200/80 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200' : 'bg-red-50/60 text-slate-800 dark:bg-red-950/40 dark:text-slate-100';
              const rowClass = progressBySubject ? progressClass : `${index % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/70 dark:bg-slate-800/60'} text-slate-700 hover:bg-blue-50/60 dark:text-slate-200 dark:hover:bg-slate-800`;
              const mobileLabelClass = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 xl:hidden';
              return <tr key={subject.subjectId} data-progress-status={progressBySubject ? status : undefined} className={`${rowClass} grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 p-4 shadow-sm transition-colors dark:border-slate-700 sm:grid-cols-4 xl:table-row xl:rounded-none xl:border-0 xl:p-0 xl:shadow-none`}>
                <td className="col-span-1 break-words font-bold text-[#003366] dark:text-sky-300 xl:table-cell xl:px-4 xl:py-3.5"><span className={mobileLabelClass}>Subject code</span>{subject.subjectCode}</td>
                <td className="col-span-2 break-words font-medium sm:col-span-3 xl:table-cell xl:px-4 xl:py-3.5"><span className={mobileLabelClass}>Subject title</span>{subject.subjectTitle}</td>
                <td className="tabular-nums xl:table-cell xl:px-4 xl:py-3.5 xl:text-center"><span className={mobileLabelClass}>Units</span>{subject.units}</td>
                <td className="tabular-nums xl:table-cell xl:px-4 xl:py-3.5 xl:text-center"><span className={mobileLabelClass}>Lecture hours</span>{subject.lectureHours}</td>
                <td className="tabular-nums xl:table-cell xl:px-4 xl:py-3.5 xl:text-center"><span className={mobileLabelClass}>Laboratory hours</span>{subject.laboratoryHours}</td>
                <td className="break-words text-slate-600 dark:text-slate-300 xl:table-cell xl:px-4 xl:py-3.5"><span className={mobileLabelClass}>Prerequisite</span>{subject.prerequisite || 'None'}</td>
                <td className="break-words text-slate-600 dark:text-slate-300 xl:table-cell xl:px-4 xl:py-3.5"><span className={mobileLabelClass}>Category</span>{subject.subjectType || '—'}</td>
                {progressBySubject ? <><td className="break-words font-semibold xl:table-cell xl:px-4 xl:py-3.5"><span className={mobileLabelClass}>Status</span>{status}</td><td className="col-span-2 break-words sm:col-span-1 xl:table-cell xl:px-4 xl:py-3.5"><span className={mobileLabelClass}>Grade</span>{progress?.grade || 'Not Yet Available'}</td></> : null}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>;
    })}
    {!filteredSubjects.length ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">No subjects match the selected Year Level and Semester.</div> : null}
    <div className="mt-5 flex justify-end border-t border-slate-200 pt-4 dark:border-slate-700"><span className="rounded-lg bg-blue-50 px-4 py-2 text-sm font-bold text-[#003366] dark:bg-blue-950/60 dark:text-blue-300">Overall Curriculum Units: {curriculum.totalUnits ?? subjects.reduce((sum, subject) => sum + Number(subject.units || 0), 0)}</span></div>
    </div>
  </section>;
};

export default CurriculumViewer;
