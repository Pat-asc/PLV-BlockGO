import { requestSystemConfirmation, requestSystemPrompt } from '../../services/SystemDialogContext';
import React, { useCallback, useEffect, useState } from 'react';
import {
  approveCurriculum,
  archiveCurriculum,
  assignProgramCurriculum,
  createAcademicProgram,
  fetchCurriculums,
  publishCurriculum,
  returnCurriculum,
} from '../../services/api';
import CurriculumViewer from '../shared/CurriculumViewer';

const tabs = ['ALL', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'ARCHIVED'];
const labels = {
  ALL: 'All Curricula',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

const CurriculumManagement = () => {
  const [curricula, setCurricula] = useState([]);
  const [activeTab, setActiveTab] = useState('PENDING_APPROVAL');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [batchYear, setBatchYear] = useState(String(new Date().getFullYear()));
  const [programForm, setProgramForm] = useState({ code: '', name: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchCurriculums();
      const items = Array.isArray(response?.data) ? response.data : [];
      setCurricula(items);
      setSelectedId((current) => current || String(items[0]?.curriculumId || ''));
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = activeTab === 'ALL'
    ? curricula
    : curricula.filter((curriculum) => curriculum.status === activeTab);
  const selected = curricula.find((curriculum) => String(curriculum.curriculumId) === String(selectedId));

  useEffect(() => {
    if (filtered.length && !filtered.some((item) => String(item.curriculumId) === String(selectedId))) {
      setSelectedId(String(filtered[0].curriculumId));
    }
  }, [filtered, selectedId]);

  const action = async (name) => {
    if (!selected) return;
    setNotice(null);

    let confirmation;
    if (name === 'approve') confirmation = await requestSystemConfirmation('Approve this curriculum proposal?');
    if (name === 'return') {
      const reason = await requestSystemPrompt({
        title: 'Return Curriculum',
        message: 'Explain why this curriculum is being returned to the Chairperson.',
        inputLabel: 'Return reason',
        confirmLabel: 'Return Curriculum',
      });
      if (!reason?.trim()) return;
      confirmation = reason.trim();
    }
    if (name === 'publish') confirmation = await requestSystemConfirmation('Publish this approved curriculum? Any previous published version for this program will be archived.');
    if (name === 'archive') confirmation = await requestSystemConfirmation('Archive this published curriculum? It will remain in version history.');
    if (!confirmation) return;

    setSaving(true);
    try {
      if (name === 'approve') await approveCurriculum(selected.curriculumId);
      if (name === 'return') await returnCurriculum(selected.curriculumId, confirmation);
      if (name === 'publish') await publishCurriculum(selected.curriculumId);
      if (name === 'archive') await archiveCurriculum(selected.curriculumId);
      setNotice({ type: 'success', message: `Curriculum ${name} action completed.` });
      await load();
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const assign = async () => {
    if (!selected) return;
    if (!/^\d{4}$/.test(batchYear) || Number(batchYear) < 2000) {
      setNotice({ type: 'error', message: 'Enter a valid four-digit student batch year.' });
      return;
    }
    if (!await requestSystemConfirmation(`Assign this curriculum to ${selected.programCode} batch ${batchYear} only?`)) return;

    setSaving(true);
    setNotice(null);
    try {
      const response = await assignProgramCurriculum(selected.curriculumId, batchYear);
      const affectedStudents = Number(response?.affectedStudents ?? 0);
      setNotice({
        type: 'success',
        message: `Curriculum assigned to ${selected.programCode} batch ${batchYear}. ${affectedStudents} student${affectedStudents === 1 ? '' : 's'} synchronized.`,
      });
      await load();
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const showAssignmentActions = selected?.status === 'PUBLISHED';

  const createProgram = async (event) => {
    event.preventDefault();
    const code = programForm.code.trim().toUpperCase().replace(/\s+/g, '');
    const name = programForm.name.trim().replace(/\s+/g, ' ');
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code) || name.length < 3) {
      setNotice({ type: 'error', message: 'Enter a 2-20 character Program Code and a complete Program Name.' });
      return;
    }
    setSaving(true); setNotice(null);
    try {
      const response = await createAcademicProgram(code, name);
      setNotice({ type: 'success', message: response.message || `Academic program ${code} created without a curriculum.` });
      setProgramForm({ code: '', name: '' });
      window.dispatchEvent(new CustomEvent('blockgo:academic-data-changed', { detail: { reason: 'academic_program_created', programCode: code } }));
    } catch (error) { setNotice({ type: 'error', message: error.message }); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Enrollment Management</p>
        <h2 className="mt-1 text-2xl font-bold text-[#003366]">Curriculum Management</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">Review program versions, subject requirements, units, and prerequisites before publishing or assigning a curriculum.</p>
      </header>
      {notice ? (
        <div className={`rounded-lg p-3 text-sm ${notice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          {notice.message}
        </div>
      ) : null}

      <form onSubmit={createProgram} className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4 md:grid-cols-[180px_minmax(240px,1fr)_auto] md:items-end" aria-label="Create academic program">
        <label className="text-xs font-semibold text-slate-700">Program Code<input aria-label="Program Code" required maxLength="20" value={programForm.code} onChange={(event) => setProgramForm((current) => ({ ...current, code: event.target.value.replace(/[^a-zA-Z0-9-]/g, '') }))} placeholder="BSIS" className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm uppercase" /></label>
        <label className="text-xs font-semibold text-slate-700">Program Name<input aria-label="Program Name" required maxLength="160" value={programForm.name} onChange={(event) => setProgramForm((current) => ({ ...current, name: event.target.value }))} placeholder="Bachelor of Science in Information Systems" className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
        <button disabled={saving} className="h-10 rounded-lg bg-[#003366] px-4 text-sm font-bold text-white disabled:opacity-60">Create Program</button>
        <p className="text-xs text-slate-600 md:col-span-3">Creates an active program master record only. Curriculum subjects must be created and published separately.</p>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Curriculum status filters">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold ${activeTab === tab ? 'bg-[#003366] text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
          >
            {labels[tab]} ({tab === 'ALL' ? curricula.length : curricula.filter((item) => item.status === tab).length})
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4">
          <h2 className="mb-3 font-bold text-[#003366]">Curriculum Versions</h2>
          {loading ? (
            <p className="py-6 text-center text-slate-500">Loading…</p>
          ) : (
            <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
              {filtered.map((curriculum) => (
                <button
                  key={curriculum.curriculumId}
                  type="button"
                  onClick={() => setSelectedId(String(curriculum.curriculumId))}
                  className={`w-full rounded-lg border p-3 text-left ${String(curriculum.curriculumId) === String(selectedId) ? 'border-[#003366] bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <span className="block font-bold text-slate-800">{curriculum.programCode} · {curriculum.curriculumVersion}</span>
                  <span className="text-xs text-slate-500">{curriculum.status} · {curriculum.subjects?.length || 0} subjects · {curriculum.totalUnits || 0} units</span>
                  <span className="mt-1 block text-xs text-slate-500">Created by {curriculum.createdByName}</span>
                </button>
              ))}
              {filtered.length === 0 ? <p className="py-6 text-center text-slate-400">No curricula in this status.</p> : null}
            </div>
          )}
        </aside>

        <main className="min-w-0">
          {selected ? (
            <>
              {selected.status === 'PENDING_APPROVAL' ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  <button disabled={saving} type="button" onClick={() => action('approve')} className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">Approve</button>
                  <button disabled={saving} type="button" onClick={() => action('return')} className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">Return for Revision</button>
                </div>
              ) : null}
              {selected.status === 'APPROVED' ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  <button disabled={saving} type="button" onClick={() => action('publish')} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">Publish</button>
                </div>
              ) : null}

              {selected.registrarComment ? (
                <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  Registrar comment: {selected.registrarComment}
                </div>
              ) : null}

              <CurriculumViewer curricula={[selected]} />

              {showAssignmentActions ? (
                <section aria-label="Curriculum actions" className="mt-4 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <label className="text-sm font-semibold text-slate-700">Student batch year
                    <input aria-label="Student batch year" value={batchYear} onChange={(event) => setBatchYear(event.target.value)} className="ml-2 w-28 rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                  </label>
                  <button disabled={saving} type="button" onClick={assign} className="rounded-lg bg-[#003366] px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                    Assign to Batch
                  </button>
                  <button disabled={saving} type="button" onClick={() => action('archive')} className="rounded-lg bg-slate-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">Archive</button>
                </section>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">Select a curriculum to review.</div>
          )}
        </main>
      </div>
    </div>
  );
};

export default CurriculumManagement;
