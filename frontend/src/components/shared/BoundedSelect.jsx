import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const normalizeOptions = (options) => options.map((option) => typeof option === 'string'
  ? { value: option, label: option }
  : { ...option, value: String(option.value) });

const BoundedSelect = ({
  label,
  value,
  options = [],
  onChange,
  onSearch,
  searchable,
  disabled = false,
  className = '',
  placeholder = 'Select an option',
  emptyMessage = 'No matching options.',
}) => {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState({ direction: 'down', maxHeight: 288 });
  const items = useMemo(() => normalizeOptions(options), [options]);
  const shouldSearch = searchable ?? items.length > 8;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => `${item.label} ${item.secondary || ''}`.toLowerCase().includes(needle)) : items;
  }, [items, query]);
  const selected = items.find((item) => item.value === String(value));

  useEffect(() => {
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, []);

  const measurePlacement = useCallback(() => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const viewportPadding = 16;
    const gap = 8;
    const below = Math.max(0, window.innerHeight - bounds.bottom - viewportPadding - gap);
    const above = Math.max(0, bounds.top - viewportPadding - gap);
    const direction = below < 192 && above > below ? 'up' : 'down';
    const available = direction === 'up' ? above : below;
    setPlacement({ direction, maxHeight: Math.min(288, available) });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    measurePlacement();
    window.addEventListener('resize', measurePlacement);
    window.addEventListener('scroll', measurePlacement, true);
    return () => {
      window.removeEventListener('resize', measurePlacement);
      window.removeEventListener('scroll', measurePlacement, true);
    };
  }, [measurePlacement, open]);

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
    {label ? <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span> : null}
    <button type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm text-slate-800 outline-none transition focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-900 dark:disabled:bg-slate-800 dark:disabled:text-slate-400">
      <span className="min-w-0 truncate">{selected?.label || placeholder}</span><span aria-hidden="true">▾</span>
    </button>
    {open ? <div
      data-testid="bounded-select-popup"
      data-placement={placement.direction}
      style={{ maxHeight: `${placement.maxHeight}px` }}
      className={`absolute left-0 z-50 w-full min-w-0 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white p-2 text-slate-800 shadow-xl dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 ${placement.direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
    >
      {shouldSearch ? <input autoFocus aria-label={`Search ${label || 'options'}`} value={query} onChange={(event) => { setQuery(event.target.value); onSearch?.(event.target.value); setActiveIndex(0); }} placeholder={`Search ${String(label || 'options').toLowerCase()}...`} className="mb-2 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" /> : null}
      <div role="listbox" aria-label={label} style={{ maxHeight: `${Math.max(0, placement.maxHeight - (shouldSearch ? 60 : 16))}px` }} className="overflow-y-auto overscroll-contain">
        {filtered.map((item, index) => <button key={item.value} type="button" role="option" aria-selected={item.value === String(value)} aria-disabled={item.disabled || undefined} disabled={item.disabled} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)} className={`block w-full min-w-0 rounded-md px-3 py-2 text-left text-sm outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 ${index === activeIndex ? 'bg-blue-50 text-blue-950 dark:bg-sky-950 dark:text-sky-100' : ''} ${item.value === String(value) ? 'font-bold text-[#003366] dark:text-sky-300' : 'text-slate-700 dark:text-slate-200'}`}><span className="block truncate">{item.label}</span>{item.secondary ? <span className="mt-0.5 block truncate font-mono text-xs font-normal text-slate-500 dark:text-slate-400">{item.secondary}</span> : null}</button>)}
        {!filtered.length ? <p className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p> : null}
      </div>
    </div> : null}
  </div>;
};

export default BoundedSelect;
