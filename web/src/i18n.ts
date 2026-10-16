// UI language. Switching reloads the page, so `l()` can be called anywhere (labels, formatters)
// without a React context. The API gets the same choice through `Accept-Language`.
import type { Lang } from '../../api/src/i18n';

export type { Lang };
const KEY = 'lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'vi' || saved === 'ja') return saved;
  } catch {
    // storage blocked: fall back to the browser language
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'vi';
}

export const lang: Lang = initial();
document.documentElement.lang = lang;

/** The text for the current language. */
export function l(vi: string, ja: string): string {
  return lang === 'ja' ? ja : vi;
}

export function setLang(next: Lang) {
  if (next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore: the choice lasts until the reload only
  }
  location.reload();
}
