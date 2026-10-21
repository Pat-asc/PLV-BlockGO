import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRegistrarDashboardOverview } from '../../services/api';

const emptyCounts = {
  submittedToRegistrar: 0,
  submittedToChairperson: 0,
  chairpersonApproved: 0,
  departmentApproved: 0,
  returned: 0,
};

function RegistrarDashboard({ filters = {} }) {
  const { schoolYear, semester, term, department, program } = filters;
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeRequest = useRef(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setIsRefreshing(true);
    setError('');
    try {
      const response = await fetchRegistrarDashboardOverview({ schoolYear, semester, term, department, program, signal: controller.signal });
      if (activeRequest.current === controller) setOverview(response);
    } catch (requestError) {
      if (requestError?.name !== 'AbortError' && activeRequest.current === controller) {
        setError(requestError?.message || 'Workflow tracking could not be loaded.');
      }
    } finally {
      if (activeRequest.current === controller) setIsRefreshing(false);
    }
  }, [department, program, schoolYear, semester, term]);

  useEffect(() => {
    refresh();
    const handleAcademicChange = (event) => {
      const reason = String(event.detail?.reason || event.detail?.Reason || '').toLowerCase();
      if (['section_submitted_to_registrar', 'grade_approved', 'grade_finalized', 'grades_sent_to_registrar', 'grade_returned', 'grade_submitted'].includes(reason)) refresh();
    };
    window.addEventListener('blockgo:academic-data-changed', handleAcademicChange);
    return () => {
      activeRequest.current?.abort();
      window.removeEventListener('blockgo:academic-data-changed', handleAcademicChange);
    };
  }, [refresh]);

  const counts = overview?.counts || emptyCounts;
  const awaitingRegistrar = (counts.submittedToRegistrar || 0) + (counts.departmentApproved || 0);
  const overviewCards = [
    { title: 'Awaiting Registrar', value: awaitingRegistrar, subtitle: 'Faculty submissions ready for Registrar review and finalization' },
    { title: 'Returned to Faculty', value: counts.returned, subtitle: 'Sections sent back for correction' },
    { title: 'Legacy Chairperson Review', value: counts.submittedToChairperson, subtitle: 'Compatibility rows from the former approval workflow' },
    { title: 'Legacy Chairperson Approved', value: counts.chairpersonApproved, subtitle: 'Compatibility rows not yet migrated to Registrar review' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {overview?.filters ? `${overview.filters.schoolYear} • ${overview.filters.semester} • ${overview.filters.term}` : 'Current academic workflow'}
        </div>
        <button type="button" onClick={refresh} disabled={isRefreshing} className="rounded-md bg-[#003366] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400">
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</div> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map((card) => (
          <article key={card.title} aria-label={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{card.title}</p>
            <h3 className="mt-2 text-3xl font-bold text-[#003366] dark:text-blue-300">{card.value}</h3>
            <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">{card.subtitle}</p>
          </article>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-xl font-bold text-[#003366] dark:text-blue-300">Faculty to Registrar Flow</h3>
          <div className="inline-flex w-fit rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200">Workflow Tracking</div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-sm text-slate-500 dark:text-slate-400">Ready for Registrar Review</p><p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{awaitingRegistrar}</p></div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-sm text-slate-500 dark:text-slate-400">Direct Faculty Submissions</p><p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{counts.submittedToRegistrar || 0}</p></div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-sm text-slate-500 dark:text-slate-400">Needs Faculty Revision</p><p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{counts.returned}</p></div>
        </div>
      </div>
    </div>
  );
}

export default RegistrarDashboard;
