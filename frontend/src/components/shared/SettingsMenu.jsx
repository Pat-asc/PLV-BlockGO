import React, { useCallback, useEffect, useRef, useState } from 'react';
import TextSizeControl from './TextSizeControl';

const SettingsMenu = ({ children, title = 'Settings', description = 'Adjust your portal display.', open: controlledOpen, onOpenChange }) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const menuRef = useRef(null);
  const isControlled = typeof controlledOpen === 'boolean';
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback((nextOpen) => {
    if (!isControlled) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [isControlled, onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, setOpen]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}
        aria-label="Settings"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/25 px-3 text-sm font-semibold text-white transition hover:border-yellow-400 hover:bg-white/10 hover:text-yellow-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#001b55]">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z" />
        </svg>
        <span className="hidden sm:inline">Settings</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Settings" className="fixed inset-x-4 top-20 z-[1300] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(24rem,calc(100vw-2rem))]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><p className="font-bold text-[#003366]">{title}</p><p className="text-xs text-slate-500">{description}</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close settings" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children || <TextSizeControl />}
        </div>
      ) : null}
    </div>
  );
};

export default SettingsMenu;
