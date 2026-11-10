import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRegistrarDashboardOverview } from '../../services/api';
import Modal from '../../services/Modal';

const emptyCounts = {
  submittedToRegistrar: 0,
  departmentApproved: 0,
  returned: 0,
};

function RegistrarDashboard({ filters = {} }) {
  const { schoolYear, semester, term, department, program } = filters;
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFacultyDetails, setShowFacultyDetails] = useState(false);
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
      if (['enrollment_sections_bulk_unlocked', 'section_submitted_to_registrar', 'grade_approved', 'grade_finalized', 'grades_sent_to_registrar', 'grade_returned', 'grade_submitted'].includes(reason)) refresh();
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
  ];
  const facultyEncoding = overview?.facultyEncoding || { encodedFaculty: 0, totalFaculty: 0, faculty: [] };

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {overviewCards.map((card) => (
          <article key={card.title} aria-label={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{card.title}</p>
            <h3 className="mt-2 text-3xl font-bold text-[#003366] dark:text-blue-300">{card.value}</h3>
            <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">{card.subtitle}</p>
          </article>
        ))}
        <button
          type="button"
          aria-label="Faculty Encoded"
          onClick={() => setShowFacultyDetails(true)}
          className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Faculty Encoded</p>
          <h3 className="mt-2 text-3xl font-bold text-[#003366] dark:text-blue-300">
            {facultyEncoding.encodedFaculty} / {facultyEncoding.totalFaculty}
          </h3>
          <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Unique Faculty with encoded workloads in the active academic context</p>
        </button>
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

      <Modal
        isOpen={showFacultyDetails}
        onClose={() => setShowFacultyDetails(false)}
        title="Faculty Encoding Details"
        description={`${facultyEncoding.encodedFaculty} of ${facultyEncoding.totalFaculty} active Faculty have encoded grades.`}
        panelClassName="max-w-3xl"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr><th className="px-3 py-2">Faculty</th><th className="px-3 py-2">Department</th><th className="px-3 py-2 text-right">Encoded Workloads</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {(facultyEncoding.faculty || []).map((faculty) => (
                <tr key={faculty.facultyUserId}>
                  <td className="px-3 py-3"><div className="font-semibold text-slate-800 dark:text-slate-100">{faculty.name}</div><div className="text-xs text-slate-500">{faculty.email}</div></td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{faculty.department || 'Not assigned'}</td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-800 dark:text-slate-100">{faculty.encodedWorkloads}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!facultyEncoding.faculty?.length ? <p className="p-6 text-center text-sm text-slate-500">No active Faculty accounts were found.</p> : null}
        </div>
      </Modal>
    </div>
  );
}

export default RegistrarDashboard;
