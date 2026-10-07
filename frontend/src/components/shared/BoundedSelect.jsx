import React, { useEffect, useMemo, useRef, useState } from 'react';

const normalizeOptions = (options) => options.map((option) => typeof option === 'string'
  ? { value: option, label: option }
  : { ...option, value: String(option.value) });

const BoundedSelect = ({ label, value, options = [], onChange, onSearch, searchable, disabled = false, className = '' }) => {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo(() => normalizeOptions(options), [options]);
  const shouldSearch = searchable ?? items.length > 8;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  }, [items, query]);
  const selected = items.find((item) => item.value === String(value));

  useEffect(() => {
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, []);

  const choose = (item) => {
    if (item.disabled) return;
    onChange(item.value);
    setOpen(false);
    setQuery('');
    onSearch?.('');
  };
  const handleKeyDown = (event) => {
    if (!open && ['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(true); return; }
    if (!open || !filtered.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); }
    if (event.key === 'End') { event.preventDefault(); setActiveIndex(filtered.length - 1); }
    if (event.key === 'Enter') { event.preventDefault(); choose(filtered[activeIndex]); }
  };

  return <div ref={rootRef} className={`relative min-w-0 ${className}`} onKeyDown={handleKeyDown}>
    {label ? <span className="mb-1 block text-xs font-semibold text-slate-700">{label}</span> : null}
    <button type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm disabled:bg-slate-100">
      <span className="min-w-0 truncate">{selected?.label || 'Select an option'}</span><span aria-hidden="true">▾</span>
    </button>
    {open ? <div className="absolute left-0 right-0 z-50 mt-1 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
      {shouldSearch ? <input autoFocus aria-label={`Search ${label || 'options'}`} value={query} onChange={(event) => { setQuery(event.target.value); onSearch?.(event.target.value); setActiveIndex(0); }} placeholder={`Search ${String(label || 'options').toLowerCase()}...`} className="mb-2 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" /> : null}
      <div role="listbox" aria-label={label} className="max-h-[min(18rem,50vh)] overflow-y-auto overscroll-contain">
        {filtered.map((item, index) => <button key={item.value} type="button" role="option" aria-selected={item.value === String(value)} aria-disabled={item.disabled || undefined} disabled={item.disabled} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)} className={`block w-full rounded-md px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${index === activeIndex ? 'bg-blue-50' : ''} ${item.value === String(value) ? 'font-bold text-[#003366]' : 'text-slate-700'}`}>{item.label}</button>)}
        {!filtered.length ? <p className="px-3 py-4 text-center text-sm text-slate-500">No matching options.</p> : null}
      </div>
    </div> : null}
  </div>;
};

export default BoundedSelect;
