import React from 'react';
import StatusBadge from '../shared/StatusBadge';

const ProgramCard = ({
  sectionName,
  sectionData,
  onClick,
  progress = 0,
  reviewStatus = 'pending',
  reviewNote = '',
  onSubmit,
}) => {
  const totalStudents = sectionData.students?.length || 0;
  const displaySchedule = [sectionData.day, sectionData.schedule].filter((value) => value && value !== 'Not Available').join(' · ') || 'Schedule not available';
  const isStarted = progress > 0;
  const isCompleted = progress >= 100;
  const isReturned = reviewStatus === 'returned';
  const isSubmitted = reviewStatus === 'submitted';
  const isApproved = reviewStatus === 'approved';
  const isForwarded = reviewStatus === 'forwarded';

  const workflowStatus = isReturned
    ? 'Returned'
    : isForwarded
      ? 'Finalized'
      : isApproved
        ? 'Approved'
        : isSubmitted
          ? 'Submitted'
          : isCompleted
            ? 'Completed'
            : isStarted
              ? 'In Progress'
              : 'Draft';

  const submitLabel = isForwarded
    ? 'Finalized by Chairperson'
    : isApproved
      ? 'Approved by Chairperson'
      : isSubmitted
        ? 'Submitted to Chairperson'
        : isReturned
          ? 'Resubmit to Chairperson'
          : 'Submit to Chairperson';

  return (
    <article className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold tracking-wide text-blue-700">{sectionData.subjectCode || 'Subject'}</p>
          <h2 className="mt-1 line-clamp-2 text-base font-bold leading-5 text-slate-900">{sectionData.subjectTitle || 'Untitled subject'}</h2>
        </div>
        <StatusBadge status={workflowStatus} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-slate-100 py-3 text-sm">
        <span className="font-bold text-[#003366]">{sectionName}</span>
        {sectionData.sectionCourse ? <span className="text-slate-500">{sectionData.sectionCourse}</span> : null}
        <span className="text-slate-500">{sectionData.units || 0} Units</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="col-span-2"><dt className="text-slate-500">Schedule</dt><dd className="mt-0.5 font-medium text-slate-700">{displaySchedule}</dd></div>
        <div><dt className="text-slate-500">Students</dt><dd className="mt-0.5 font-semibold text-slate-800">{totalStudents}</dd></div>
        <div><dt className="text-slate-500">Academic Period</dt><dd className="mt-0.5 font-semibold text-slate-800">{sectionData.schoolYear || '—'} · {sectionData.semester || '—'}</dd></div>
      </dl>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold uppercase tracking-wide text-slate-500">Encoding progress</span><span className="font-bold text-[#003366]">{progress}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${isCompleted ? 'bg-emerald-500' : isStarted ? 'bg-yellow-400' : 'bg-slate-300'}`} style={{ width: `${progress}%` }} /></div>
      </div>

      {isReturned && reviewNote ? <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700"><span className="font-bold">Chairperson note:</span> {reviewNote}</div> : null}

      <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row">
        <button type="button" onClick={onClick} className="h-10 flex-1 rounded-lg bg-[#003366] px-3 text-sm font-bold text-white transition hover:bg-[#00264d]">{isStarted ? 'View Grades' : 'Encode Now'}</button>
        <button type="button" onClick={onSubmit} disabled={!isCompleted || isSubmitted || isApproved || isForwarded} className="h-10 flex-1 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400">{submitLabel}</button>
      </div>
    </article>
  );
};

export default ProgramCard;
