import React, { useEffect, useState } from 'react';
import { applySystemTheme, readSystemTheme } from '../../services/themePreference';

const ThemeControl = () => {
  const [theme, setTheme] = useState(readSystemTheme);
  const isDark = theme === 'dark';

  useEffect(() => { applySystemTheme(theme); }, [theme]);

  return (
    <section className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800" aria-label="Appearance">
      <span>
        <strong className="block text-sm text-slate-800 dark:text-slate-100">Dark mode</strong>
        <small className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">Changes the full portal and Chat together.</small>
      </span>
      <button
        type="button"
        role="switch"
        aria-label="System dark mode"
        aria-checked={isDark}
        onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        className={`relative h-7 w-12 shrink-0 rounded-full border-0 shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 ${isDark ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <span aria-hidden="true" className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${isDark ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </section>
  );
};

export default ThemeControl;
