export const THEME_STORAGE_KEY = 'blockgo.system-theme';
export const SYSTEM_THEMES = Object.freeze(['light', 'dark']);

export function readSystemTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return SYSTEM_THEMES.includes(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

export function applySystemTheme(theme) {
  const safeTheme = SYSTEM_THEMES.includes(theme) ? theme : 'light';
  document.documentElement.dataset.blockgoTheme = safeTheme;
  document.documentElement.style.colorScheme = safeTheme;
  try { window.localStorage.setItem(THEME_STORAGE_KEY, safeTheme); } catch { /* Persistence is optional. */ }
  window.dispatchEvent(new CustomEvent('blockgo:system-theme-changed', { detail: { theme: safeTheme } }));
  return safeTheme;
}
