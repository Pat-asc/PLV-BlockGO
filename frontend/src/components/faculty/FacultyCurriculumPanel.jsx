import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchFacultyCurriculums } from '../../services/api';
import CurriculumViewer from '../shared/CurriculumViewer';

const normalizeSearch = (value) => String(value || '').trim().toLowerCase();

export const filterFacultyCurricula = (curricula = [], search = '') => {
  const query = normalizeSearch(search);
  if (!query) return curricula;

  return curricula.reduce((matches, curriculum) => {
    const subjects = (Array.isArray(curriculum?.subjects) ? curriculum.subjects : []).filter((subject) =>
      [
        subject?.subjectCode,
        subject?.subjectTitle,
        curriculum?.programCode,
        curriculum?.programName,
        subject?.yearLevel,
        subject?.semester,
      ].some((value) => normalizeSearch(value).includes(query))
    );

    if (subjects.length > 0) matches.push({ ...curriculum, subjects });
    return matches;
  }, []);
};

const FacultyCurriculumPanel = () => {
  const [homeProgram, setHomeProgram] = useState(null);
  const [homeCurricula, setHomeCurricula] = useState([]);
  const [crossDepartmentCurricula, setCrossDepartmentCurricula] = useState([]);
  const [activeTab, setActiveTab] = useState('assigned');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchFacultyCurriculums();
      const flatCurricula = Array.isArray(response?.data) ? response.data : [];
      const hasStructuredGroups = Array.isArray(response?.homeCurricula) || Array.isArray(response?.crossDepartmentCurricula);
      setHomeProgram(response?.homeProgram || null);
      setHomeCurricula(hasStructuredGroups && Array.isArray(response?.homeCurricula) ? response.homeCurricula : flatCurricula);
      setCrossDepartmentCurricula(Array.isArray(response?.crossDepartmentCurricula) ? response.crossDepartmentCurricula : []);
      setActiveTab('assigned');
      setSearch('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load the curriculum checklist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredHomeCurricula = useMemo(
    () => filterFacultyCurricula(homeCurricula, search),
    [homeCurricula, search]
  );
  const assignedCrossDepartmentCurricula = useMemo(
    () => crossDepartmentCurricula.reduce((assigned, curriculum) => {
      const subjects = (curriculum?.subjects || []).filter((subject) => subject?.isCrossDepartmentAssigned === true);
      if (subjects.length > 0) assigned.push({ ...curriculum, subjects });
      return assigned;
    }, []),
    [crossDepartmentCurricula]
  );
  const filteredAssignedCrossDepartmentCurricula = useMemo(
    () => filterFacultyCurricula(
      assignedCrossDepartmentCurricula,
      search
    ),
    [assignedCrossDepartmentCurricula, search]
  );
  const filteredCrossDepartmentCurricula = useMemo(
    () => filterFacultyCurricula(crossDepartmentCurricula, search),
    [crossDepartmentCurricula, search]
  );
  const filteredCurricula = useMemo(
    () => activeTab === 'assigned'
      ? [...filteredAssignedCrossDepartmentCurricula, ...filteredHomeCurricula]
      : activeTab === 'home' ? filteredHomeCurricula : filteredCrossDepartmentCurricula,
    [activeTab, filteredAssignedCrossDepartmentCurricula, filteredCrossDepartmentCurricula, filteredHomeCurricula]
  );

  const summary = useMemo(() => {
    const subjects = filteredCurricula.flatMap((curriculum) => Array.isArray(curriculum?.subjects) ? curriculum.subjects : []);
    const programCount = new Set(filteredCurricula.map((curriculum) => curriculum?.programCode).filter(Boolean)).size;
    const totalUnits = filteredCurricula.reduce((sum, curriculum) => sum + Number(
      curriculum?.totalUnits ?? (Array.isArray(curriculum?.subjects)
        ? curriculum.subjects.reduce((subjectTotal, subject) => subjectTotal + Number(subject?.units || 0), 0)
        : 0)
    ), 0);
    return { programCount, subjectCount: subjects.length, totalUnits };
  }, [filteredCurricula]);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-blue-950/10 bg-[#002b63] text-white shadow-sm">
        <div className="relative px-5 py-6 sm:px-7">
          <div aria-hidden="true" className="absolute -right-14 -top-16 h-48 w-48 rounded-full bg-blue-400/15" />
          <div aria-hidden="true" className="absolute -bottom-24 right-24 h-44 w-44 rounded-full bg-yellow-300/10" />
          <div className="relative">
            <div className="flex min-w-0 items-start gap-4">
              <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 sm:flex">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 text-yellow-300">
                  <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H4z" />
                  <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h3z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-yellow-300">Academic reference</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Program Curriculum</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">Review your home curriculum and any Registrar-approved cross-department teaching curricula, including subject requirements, prerequisites, and unit totals.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!error ? (
        <div role="tablist" aria-label="Faculty curriculum groups" className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'assigned'}
            onClick={() => setActiveTab('assigned')}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === 'assigned' ? 'bg-[#003366] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Assigned Curriculum
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'home'}
            onClick={() => setActiveTab('home')}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === 'home' ? 'bg-[#003366] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Home Department Curriculum{homeProgram?.code ? ` (${homeProgram.code})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cross'}
            onClick={() => setActiveTab('cross')}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === 'cross' ? 'bg-[#003366] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Cross-Department Curricula
          </button>
        </div>
      ) : null}

      {!error ? (
        <label className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="sr-only">Search assigned curriculum subjects</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search subject code or subject name..."
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#003366] focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
      ) : null}

      {!loading && !error && filteredCurricula.length ? (
        <section aria-label="Curriculum summary" className="grid gap-3 sm:grid-cols-3">
          {[
            { label: summary.programCount === 1 ? 'Academic Program' : 'Academic Programs', value: summary.programCount, accent: 'bg-blue-600' },
            { label: 'Curriculum Subjects', value: summary.subjectCount, accent: 'bg-emerald-500' },
            { label: 'Total Curriculum Units', value: summary.totalUnits, accent: 'bg-amber-400' },
          ].map((item) => (
            <div key={item.label} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${item.accent}`} />
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
              <p className="mt-1 text-2xl font-bold text-[#003366]">{item.value}</p>
            </div>
          ))}
        </section>
      ) : null}

      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</div> : null}
      {!error && activeTab === 'assigned' ? (
        <div className="space-y-5">
          {!loading && filteredCurricula.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {normalizeSearch(search) ? 'No subjects found.' : 'No assigned curriculum subjects are available.'}
            </div>
          ) : null}
          {filteredAssignedCrossDepartmentCurricula.length > 0 ? (
            <section aria-labelledby="cross-assigned-subjects-heading" className="space-y-3">
              <h2 id="cross-assigned-subjects-heading" className="text-lg font-bold text-[#003366] dark:text-sky-300">Cross-Department Assigned Subjects</h2>
              <CurriculumViewer curricula={filteredAssignedCrossDepartmentCurricula} loading={loading} emptyMessage="No cross-department subjects found." />
            </section>
          ) : null}
          {filteredHomeCurricula.length > 0 ? (
            <section aria-labelledby="regular-curriculum-heading" className="space-y-3">
              <h2 id="regular-curriculum-heading" className="text-lg font-bold text-[#003366] dark:text-sky-300">Regular Curriculum</h2>
              <CurriculumViewer curricula={filteredHomeCurricula} loading={loading} emptyMessage="No regular curriculum subjects found." />
            </section>
          ) : null}
        </div>
      ) : !error ? <CurriculumViewer
          curricula={filteredCurricula}
          loading={loading}
          emptyMessage={normalizeSearch(search)
            ? 'No subjects found.'
            : activeTab === 'home'
              ? 'No published home department curriculum is available.'
              : 'No active cross-department curriculum assignments.'}
        /> : null}
    </div>
  );
};

export default FacultyCurriculumPanel;
