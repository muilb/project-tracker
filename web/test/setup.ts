// Every test file gets a fresh jsdom. Nothing from src/ is imported here: `lang` is fixed when
// i18n.ts first loads, so a Japanese test sets it with `vi.hoisted` before its own imports.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no media queries: a desktop with a mouse.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

afterEach(() => {
  cleanup();
  localStorage.clear();
});
