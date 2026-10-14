import React, { useCallback, useEffect, useState } from 'react';
import { fetchPasswordResetRequests } from '../../services/api';

const statusClass = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-100 text-slate-700',
};

const roleLabel = (role) => role === 'department_admin' ? 'Chairperson' : 'Faculty';

const PasswordResetRequests = ({ onSelectRequest, refreshKey = 0 }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchPasswordResetRequests();
      setRequests(Array.isArray(response?.data) ? response.data : []);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load password reset requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M7 6h13M7 12h13M7 18h13"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Password Reset Requests</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Pending requests remain visible until the Registrar resets the account password.</p>
        </div>
      </div>
      <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-3 py-1.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">Refresh</button>
    </div>
    {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
    {loading ? (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">Loading reset requests...</div>
    ) : requests.length === 0 ? (
      <div className="rounded-md border border-slate-200 bg-slate-50/60 p-6 text-center"><p className="text-[11px] font-semibold text-slate-600">No open or recent password reset requests.</p></div>
    ) : (
      <div className="space-y-2">
        {requests.map((request) => <article key={request.requestId} className="rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-800">{request.fullName}</h3>
              <p className="mt-0.5 text-[10px] text-slate-500">{request.email} - {roleLabel(request.role)}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Requested {new Date(request.createdAt).toLocaleString()}</p>
            </div>
            <span className={'rounded-full px-2 py-0.5 text-[10px] font-bold ' + (statusClass[request.status] || statusClass.CANCELLED)}>{request.status}</span>
          </div>
          {request.reason && <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">{request.reason}</p>}
          {request.reviewNote && <p className="mt-2 text-[10px] text-slate-500">Registrar note: {request.reviewNote}</p>}
          {(request.status === 'PENDING' || request.status === 'APPROVED') && (
            <button type="button" onClick={() => onSelectRequest?.(request)} className="mt-2 rounded-md bg-[#003366] px-3 py-1.5 text-[10px] font-bold text-white hover:bg-[#004b8f]">Select account to reset</button>
          )}
        </article>)}
      </div>
    )}
  </section>;
};

export default PasswordResetRequests;
