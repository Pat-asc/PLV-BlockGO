export const THEME_STORAGE_KEY = 'blockgo.system-theme';
export const SYSTEM_THEME_CHANGED_EVENT = 'blockgo:system-theme-changed';
export const CHAT_THEME_STORAGE_PREFIX = 'blockgo-chat-dark-mode:';
export const SYSTEM_THEMES = Object.freeze(['light', 'dark']);

export const chatThemeStorageKey = (email) => `${CHAT_THEME_STORAGE_PREFIX}${String(email || 'anonymous').trim().toLowerCase()}`;

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
  try { window.localStorage.setItem(THEME_STORAGE_KEY, safeTheme); } catch { /* Persistence is optional. */ }
  window.dispatchEvent(new CustomEvent(SYSTEM_THEME_CHANGED_EVENT, { detail: { theme: safeTheme } }));
  return safeTheme;
}

export function readChatDarkMode(email) {
  try {
    const stored = window.localStorage.getItem(chatThemeStorageKey(email));
    if (stored !== null) return stored === 'true';
  } catch { /* Fall back to the system preference. */ }
  return readSystemTheme() === 'dark';
}

export function applyChatThemeForAccount(theme, email) {
  const isDark = theme === 'dark';
  try { window.localStorage.setItem(chatThemeStorageKey(email), String(isDark)); } catch { /* Persistence is optional. */ }
  return isDark;
}
