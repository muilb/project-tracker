// UI languages. Vietnamese is the default; the web sends the user's choice as
// `Accept-Language`, alerts use each channel's own language.
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

export const LANGS = ['vi', 'ja'] as const;
export type Lang = (typeof LANGS)[number];

const current = new AsyncLocalStorage<Lang>();

export function lang(): Lang {
  return current.getStore() ?? 'vi';
}

/** Runs `fn` with `l()` answering in `language`. */
export function withLang<T>(language: Lang | undefined, fn: () => T): T {
  return current.run(language ?? 'vi', fn);
}

/** The text for the current language. */
export function l(vi: string, ja: string): string {
  return lang() === 'ja' ? ja : vi;
}

/** "ja", "ja-JP,ja;q=0.9" → ja; anything else → vi. */
export function langFromHeader(header?: string): Lang {
  return header?.trim().toLowerCase().startsWith('ja') ? 'ja' : 'vi';
}

// zod's built-in messages ("Invalid input" …) follow the request language too.
const zodLocales = { vi: z.locales.vi(), ja: z.locales.ja() };
z.config({ localeError: (issue) => zodLocales[lang()].localeError(issue) });
