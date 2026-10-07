import React, { useEffect, useState } from 'react';
import { correctFinalizedGrade, fetchGradeHistory } from '../../services/api';
import Modal from '../../services/Modal';

const displayGrade = (raw) => {
  if (!raw) return 'Not recorded';
  if (typeof raw === 'object') return raw.finalAverage || raw.finals || raw.midterm || JSON.stringify(raw);
  try {
    const value = JSON.parse(raw);
    return value.finalAverage || value.finals || value.midterm || raw;
  } catch { return raw; }
};

const GradeVersionHistory = ({ recordId, label = 'View Version History', allowCorrection = false, onCorrected }) => {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newGrade, setNewGrade] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!recordId) return;
    setLoading(true); setError('');
    try {
      const response = await fetchGradeHistory(recordId);
      setHistory(response?.data || response);
    } catch (requestError) {
      setError(requestError.message || 'Grade version history could not be loaded.');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (open) load(); }, [open, recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCorrection = async (event) => {
    event.preventDefault();
    if (!newGrade.trim() || reason.trim().length < 3) return;
    setSaving(true); setError('');
    try {
      await correctFinalizedGrade({ recordId, newGrade: newGrade.trim(), reason: reason.trim(), expectedGradeVersion: history?.currentVersion });
      setNewGrade(''); setReason('');
      await load();
      onCorrected?.();
    } catch (requestError) {
      setError(requestError.message || 'The finalized correction could not be committed.');
    } finally { setSaving(false); }
  };

  const versions = Array.isArray(history?.versions) ? [...history.versions].sort((a, b) => Number(b.version) - Number(a.version)) : [];
  return <>
    <button type="button" disabled={!recordId} onClick={() => setOpen(true)} className="text-xs font-bold text-blue-700 hover:text-[#003366] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:text-slate-400">{label}</button>
    <Modal isOpen={open} onClose={() => { if (!saving) setOpen(false); }} title="Grade Version History" description="Finalized versions are read from the immutable Fabric key history. CouchDB shows only the current version.">
      {loading ? <p role="status" className="py-6 text-center text-sm text-slate-500">Loading version history…</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {!loading && versions.length === 0 && !error ? <p className="py-6 text-center text-sm text-slate-500">No finalized version is available.</p> : null}
      <div className="mt-4 space-y-3">
        {versions.map((version) => <article key={`${version.version}-${version.transactionId}`} className={`rounded-xl border p-4 ${version.status === 'Current' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[#003366]">Version {version.version}</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{displayGrade(version.grade)}</p></div><span className="rounded-full border bg-white px-2.5 py-1 text-xs font-bold uppercase text-slate-700">{version.status}</span></div>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-slate-500">Finalized</dt><dd className="font-semibold">{version.finalizedAt ? new Date(version.finalizedAt).toLocaleString() : 'Not recorded'}</dd></div><div><dt className="text-slate-500">Actor</dt><dd className="break-all font-semibold">{version.actor || 'Not recorded'}</dd></div><div className="sm:col-span-2"><dt className="text-slate-500">Transaction ID</dt><dd className="break-all font-mono">{version.transactionId || 'Not recorded'}</dd></div>{version.previousTransactionId ? <div className="sm:col-span-2"><dt className="text-slate-500">Previous transaction</dt><dd className="break-all font-mono">{version.previousTransactionId}</dd></div> : null}{version.correctionReason ? <div className="sm:col-span-2"><dt className="text-slate-500">Correction reason</dt><dd className="font-semibold">{version.correctionReason}</dd></div> : null}</dl>
        </article>)}
      </div>
      {allowCorrection && versions[0]?.status === 'Current' ? <form onSubmit={submitCorrection} className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold text-amber-900">Create corrected finalized version</h3><p className="mt-1 text-xs text-amber-800">This creates a new Fabric transaction. The current version remains in history, and the correction requires Registrar release.</p><label className="mt-3 block text-sm font-semibold text-slate-700">Corrected grade<input required value={newGrade} onChange={(event) => setNewGrade(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" /></label><label className="mt-3 block text-sm font-semibold text-slate-700">Reason for correction<textarea required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-3" /></label><button disabled={saving || !newGrade.trim() || reason.trim().length < 3} className="mt-3 min-h-11 rounded-lg bg-amber-700 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Committing…' : `Commit Version ${Number(history?.currentVersion || 0) + 1}`}</button></form> : null}
    </Modal>
  </>;
};

export default GradeVersionHistory;
