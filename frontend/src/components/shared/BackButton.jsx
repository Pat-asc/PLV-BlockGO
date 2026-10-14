import React from 'react';

const BackButton = ({ onClick, label = 'Back', className = '', ...props }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-[#003366] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366] focus-visible:ring-offset-2 ${className}`}
    {...props}
  >
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="m12.5 15-5-5 5-5" />
    </svg>
    <span>{label}</span>
  </button>
);

export default BackButton;
