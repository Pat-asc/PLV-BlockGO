import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchApplicationTransactions, fetchLedgerTransactions } from '../../services/api';

const PAGE_SIZE = 10;

const value = (item, ...keys) => keys.map((key) => item?.[key]).find((entry) => entry !== undefined && entry !== null && entry !== '') || '—';
const dateText = (input) => {
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

function SystemAdminTransactions() {
  const [records, setRecords] = useState([]);
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [];
      if (source !== 'blockchain') requests.push(fetchApplicationTransactions());
      if (source !== 'application') requests.push(fetchLedgerTransactions({ search }));
      const responses = await Promise.all(requests);
      const next = responses.flatMap((response, index) => {
        const data = Array.isArray(response?.data) ? response.data : [];
        const recordSource = source === 'all' ? (index === 0 ? 'application' : 'blockchain') : source;
        return data.map((record) => ({ ...record, recordSource }));
      }).sort((left, right) => new Date(value(right, 'occurredAt')) - new Date(value(left, 'occurredAt')));
      setRecords(next);
      setPage(1);
    } catch (requestError) {
      setError(requestError.message || 'Transactions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [search, source]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const append = (event) => {
      if (!event?.detail) return;
      const liveRecord = { ...event.detail, recordSource: event.detail.recordSource || 'application' };
      setRecords((current) => [liveRecord, ...current.filter((record) =>
        String(value(record, 'auditId', 'transactionId')) !== String(value(liveRecord, 'auditId', 'transactionId')))]);
      setPage(1);
    };
    window.addEventListener('blockgo:transaction-recorded', append);
    return () => {
      window.removeEventListener('blockgo:transaction-recorded', append);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) => Object.values(record).some((entry) => String(entry ?? '').toLowerCase().includes(needle)));
  }, [records, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section className="space-y-5">
      <div className="border-b border-slate-300 pb-5">
        <p className="text-xs font-bold uppercase text-slate-500">System Administration</p>
        <h2 className="mt-1 text-2xl font-bold text-[#003366]">Application & Blockchain Transactions</h2>
        <p className="mt-2 text-sm text-slate-600">Read-only history with live SignalR transaction insertion. Ten transactions are shown per page.</p>
      </div>
      <form className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_220px_auto]" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <label className="text-sm font-semibold text-slate-700">Search
          <input aria-label="Search transactions" value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3" placeholder="Hash, action, actor, or record" />
        </label>
        <label className="text-sm font-semibold text-slate-700">Source
          <select aria-label="Transaction source" value={source} onChange={(event) => setSource(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3">
            <option value="all">All sources</option><option value="application">Application</option><option value="blockchain">Blockchain</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 self-end rounded-md bg-[#003366] px-5 text-sm font-bold text-white">Refresh</button>
      </form>
      {error ? <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{error}</div> : null}
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Hash</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Timestamp</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((record, index) => <tr key={`${record.recordSource}-${value(record, 'auditId', 'transactionId', 'recordId')}-${index}`}>
              <td className="max-w-48 truncate px-4 py-3 font-mono text-xs" title={value(record, 'transactionHash', 'transactionId')}>{value(record, 'transactionHash', 'transactionId')}</td>
              <td className="px-4 py-3 font-semibold">{value(record, 'action', 'status')}</td><td className="px-4 py-3">{value(record, 'actor')}</td>
              <td className="px-4 py-3">{value(record, 'entityId', 'recordId')}</td><td className="px-4 py-3 capitalize">{record.recordSource}</td>
              <td className="px-4 py-3">{value(record, 'status', 'actorRole')}</td><td className="whitespace-nowrap px-4 py-3">{dateText(value(record, 'occurredAt'))}</td>
            </tr>)}
            {!visible.length ? <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">{loading ? 'Loading transactions…' : 'No matching transactions.'}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="min-h-11 rounded-md border px-4 disabled:opacity-40">Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} className="min-h-11 rounded-md border px-4 disabled:opacity-40">Next</button></div>
    </section>
  );
}

export default SystemAdminTransactions;
