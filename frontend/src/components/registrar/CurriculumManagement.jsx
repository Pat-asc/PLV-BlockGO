import React, { useCallback, useEffect, useState } from 'react';
import {
  approveCurriculum,
  archiveCurriculum,
  assignProgramCurriculum,
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
    if (name === 'approve') confirmation = window.confirm('Approve this curriculum proposal?');
    if (name === 'return') {
      const reason = window.prompt('Reason for returning this curriculum:');
      if (!reason?.trim()) return;
      confirmation = reason.trim();
    }
    if (name === 'publish') confirmation = window.confirm('Publish this approved curriculum? Any previous published version for this program will be archived.');
    if (name === 'archive') confirmation = window.confirm('Archive this published curriculum? It will remain in version history.');
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
    if (!window.confirm(`This version will become the active curriculum for every ${selected.programCode} student. Continue?`)) return;

    setSaving(true);
    setNotice(null);
    try {
      const response = await assignProgramCurriculum(selected.curriculumId);
      const affectedStudents = Number(response?.affectedStudents ?? 0);
      setNotice({
        type: 'success',
        message: `Curriculum assigned to ${selected.programCode}. ${affectedStudents} student${affectedStudents === 1 ? '' : 's'} synchronized.`,
      });
      await load();
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const showAssignmentActions = selected?.status === 'PUBLISHED';

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
                  <button disabled={saving} type="button" onClick={assign} className="rounded-lg bg-[#003366] px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                    Assign to Program
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
