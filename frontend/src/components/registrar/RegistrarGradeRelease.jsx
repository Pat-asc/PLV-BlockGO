import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchGradeReleaseCandidates, releaseStudentGrades } from '../../services/api';
import { showSystemNotification } from '../../services/NotificationContext';
import { requestSystemConfirmation } from '../../services/SystemDialogContext';
import StatusBadge from '../shared/StatusBadge';

const valueOptions = (rows, field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))]
  .sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }));

const gradeValues = (rawGrade) => {
  if (!rawGrade) return { midterm: '—', finals: '—', finalAverage: '—' };
  try {
    const parsed = typeof rawGrade === 'string' ? JSON.parse(rawGrade) : rawGrade;
    return {
      midterm: parsed.midterm ?? '—',
      finals: parsed.finals ?? '—',
      finalAverage: parsed.finalAverage ?? parsed.finals ?? parsed.midterm ?? '—',
    };
  } catch {
    return { midterm: '—', finals: rawGrade, finalAverage: rawGrade };
  }
};

const initialFilters = { program: '', yearLevel: '', section: '', schoolYear: '', semester: '', term: '', releaseStatus: '' };

const RegistrarGradeRelease = () => {
  const [candidates, setCandidates] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [expandedKey, setExpandedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [releasingKey, setReleasingKey] = useState('');

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError('');
    try {
      const response = await fetchGradeReleaseCandidates();
      setCandidates(Array.isArray(response?.data) ? response.data : []);
    } catch (loadError) {
      setError(loadError.message || 'Grade release information is temporarily unavailable.');
      if (!background) setCandidates([]);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const searchable = [candidate.studentId, candidate.studentName, candidate.program, candidate.section]
        .filter(Boolean).join(' ').toLowerCase();
      if (needle && !searchable.includes(needle)) return false;
      return Object.entries(filters).every(([field, value]) => !value || String(candidate[field] || '').toLowerCase() === value.toLowerCase());
    });
  }, [candidates, filters, search]);

  const keyFor = (candidate) => [candidate.studentIdentifier, candidate.schoolYear, candidate.semester, candidate.term].join('|');

  const release = async (candidate) => {
    const confirmed = await requestSystemConfirmation({
      title: 'Release grades for this student?',
      message: `${candidate.studentId || candidate.studentIdentifier}\n${candidate.studentName || 'Student'}\n\nOnly finalized grades will be made visible in the Student Portal.`,
      confirmLabel: 'Release Grades',
      tone: 'primary',
    });
    if (!confirmed) return;

    const key = keyFor(candidate);
    setReleasingKey(key);
    try {
      const response = await releaseStudentGrades({
        studentIdentifier: candidate.studentIdentifier,
        schoolYear: candidate.schoolYear,
        semester: candidate.semester,
        term: candidate.term,
      });
      showSystemNotification(response?.message || 'Finalized grades released successfully.', 'success');
      await load(true);
    } catch (releaseError) {
      showSystemNotification(releaseError.message || 'Finalized grades could not be released right now.', 'error');
    } finally {
      setReleasingKey('');
    }
  };

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">Loading grade release records…</div>;

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Registrar Operations</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-[#003366]">Grade Release</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">Release finalized Fabric records to individual students. This controls visibility only and does not approve, edit, or finalize grades.</p>
          </div>
          <button type="button" onClick={() => load()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Refresh</button>
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="lg:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Search students</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student ID, name, program, or section" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#003366] focus:ring-2 focus:ring-blue-100" /></label>
          {[
            ['program', 'Program'], ['yearLevel', 'Year level'], ['section', 'Section'], ['schoolYear', 'School year'],
            ['semester', 'Semester'], ['term', 'Term'], ['releaseStatus', 'Status'],
          ].map(([field, label]) => {
            return <label key={field}><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span><select value={filters[field]} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#003366]"><option value="">All</option>{valueOptions(candidates, field).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
          })}
          <div className="flex items-end"><button type="button" onClick={() => { setSearch(''); setFilters(initialFilters); }} className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">Clear filters</button></div>
        </div>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
      {!error && filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">No students currently have finalized grades ready for release.</div> : null}

      <div className="space-y-3">
        {filtered.map((candidate) => {
          const key = keyFor(candidate);
          const expanded = expandedKey === key;
          const isReleased = candidate.releaseStatus === 'Released';
          return <article key={key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(110px,0.7fr))_auto] lg:items-center">
              <div><p className="font-bold text-[#003366]">{candidate.studentName || 'Student name unavailable'}</p><p className="text-sm font-semibold text-slate-700">{candidate.studentId || candidate.studentIdentifier}</p><p className="mt-1 text-xs text-slate-500">{candidate.program || 'Program unavailable'} · {candidate.section || 'No section'}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Year level</p><p className="mt-1 text-sm text-slate-700">{candidate.yearLevel || '—'}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">School year</p><p className="mt-1 text-sm text-slate-700">{candidate.schoolYear || '—'}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Period</p><p className="mt-1 text-sm capitalize text-slate-700">{candidate.semester || '—'} · {candidate.term || '—'}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Status</p><div className="mt-1"><StatusBadge status={candidate.releaseStatus} /></div></div>
              <div className="flex flex-wrap gap-2 lg:justify-end"><button type="button" onClick={() => setExpandedKey(expanded ? '' : key)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{expanded ? 'Hide Subjects' : `View Subjects (${candidate.subjects?.length || 0})`}</button><button type="button" onClick={() => release(candidate)} disabled={isReleased || releasingKey === key} className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:bg-slate-300">{releasingKey === key ? 'Releasing…' : isReleased ? 'Released' : 'Release Grades'}</button></div>
            </div>
            {expanded ? <div className="border-t border-slate-200 bg-slate-50/70 p-4"><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Units</th><th className="px-4 py-3">Midterm</th><th className="px-4 py-3">Final</th><th className="px-4 py-3">Final Grade</th><th className="px-4 py-3">Faculty</th><th className="px-4 py-3">Ledger Status</th></tr></thead><tbody className="divide-y divide-slate-100">{(candidate.subjects || []).map((subject) => { const values = gradeValues(subject.grade); return <tr key={subject.recordId}><td className="px-4 py-3"><span className="block font-bold text-[#003366]">{subject.subjectCode}</span><span className="text-slate-600">{subject.subjectTitle}</span></td><td className="px-4 py-3">{subject.units || '—'}</td><td className="px-4 py-3">{values.midterm}</td><td className="px-4 py-3">{values.finals}</td><td className="px-4 py-3 font-bold text-[#003366]">{values.finalAverage}</td><td className="px-4 py-3">{subject.faculty || 'Not recorded'}</td><td className="px-4 py-3"><StatusBadge status={subject.status} /></td></tr>; })}</tbody></table></div></div> : null}
          </article>;
        })}
      </div>
    </section>
  );
};

export default RegistrarGradeRelease;
