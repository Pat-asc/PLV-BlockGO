import React from 'react';

const styles = {
  draft: 'border-slate-200 bg-slate-100 text-slate-700',
  submitted: 'border-blue-200 bg-blue-50 text-blue-800',
  'for review': 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  'ready to finalize': 'border-violet-200 bg-violet-50 text-violet-800',
  finalized: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'ready for release': 'border-amber-200 bg-amber-50 text-amber-900',
  released: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  returned: 'border-red-200 bg-red-50 text-red-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'in progress': 'border-blue-200 bg-blue-50 text-blue-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
  unavailable: 'border-slate-300 bg-slate-100 text-slate-700',
};

const StatusBadge = ({ status = 'Unavailable', className = '' }) => {
  const normalized = String(status || 'Unavailable').trim().replaceAll('_', ' ');
  const label = normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[normalized.toLowerCase()] || styles.unavailable} ${className}`}>
      {label}
    </span>
  );
};

export default StatusBadge;
