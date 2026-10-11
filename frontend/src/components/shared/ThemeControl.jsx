import React, { useEffect, useState } from 'react';
import { applySystemTheme, readSystemTheme } from '../../services/themePreference';

const ThemeControl = () => {
  const [theme, setTheme] = useState(readSystemTheme);
  const isDark = theme === 'dark';

  useEffect(() => { applySystemTheme(theme); }, [theme]);

  return (
    <section className="blockgo-theme-control" aria-label="Appearance">
      <span>
        <strong>Dark mode</strong>
        <small>Changes the full portal. Chat appearance remains separate.</small>
      </span>
      <button
        type="button"
        role="switch"
        aria-label="System dark mode"
        aria-checked={isDark}
        onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        className={isDark ? 'is-active' : ''}
      >
        <span aria-hidden="true" />
      </button>
    </section>
  );
};

export default ThemeControl;
