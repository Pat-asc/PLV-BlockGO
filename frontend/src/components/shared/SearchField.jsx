import React from 'react';

const SearchField = ({ value, onChange, label = 'Search', placeholder = 'Search…', className = '', inputClassName = '' }) => (
  <label className={`block text-xs font-semibold text-slate-600 ${className}`}>
    {label}
    <span className="relative mt-1 block">
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        aria-label={label} className={`w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${inputClassName}`} />
      {value ? <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange('')}
        className="absolute inset-y-0 right-0 min-w-10 rounded-r-lg text-lg text-slate-500 hover:bg-slate-100">×</button> : null}
    </span>
  </label>
);

export default SearchField;
