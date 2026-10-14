export const TEXT_SIZE_STORAGE_KEY = 'blockgo.text-size';
export const TEXT_SIZE_OPTIONS = Object.freeze({
  small: 0.9,
  default: 1,
  large: 1.125,
  extraLarge: 1.25,
});

export function readTextSize() {
  try {
    const stored = window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    return Object.hasOwn(TEXT_SIZE_OPTIONS, stored) ? stored : 'default';
  } catch {
    return 'default';
  }
}

export function applyTextSize(size) {
  const safeSize = Object.hasOwn(TEXT_SIZE_OPTIONS, size) ? size : 'default';
  document.documentElement.style.setProperty('--blockgo-font-scale', String(TEXT_SIZE_OPTIONS[safeSize]));
  document.documentElement.dataset.textSize = safeSize;
  try { window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, safeSize); } catch { /* Preference persistence is optional. */ }
  return safeSize;
}
