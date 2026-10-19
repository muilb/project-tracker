// Page tests run the real API in-process: the web's fetch('/api/…') goes straight to the Hono app
// (in-memory store with the sample data, dev auth), so a test covers the UI and the API together
// without a browser or a server. Time is fixed at the sample's "now" for both sides.
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { AiClient } from '../../api/src/ai/assistant';
import { createApp } from '../../api/src/app';
import { loadSample, SAMPLE_NOW_VN } from '../../api/src/seed/sample';
import { MemoryStore } from '../../api/src/store/memory';
import { vnToIso } from '../../api/src/time';
import { App } from '../src/App';
import { auth } from '../src/auth';
import { loadConfig } from '../src/config';

export const NOW = new Date(vnToIso(SAMPLE_NOW_VN));

const unused = async (): Promise<never> => {
  throw new Error('not used in web tests');
};
const ai: AiClient = { verifyKey: unused, extract: unused, ask: unused };

/** Starts the API on a fresh copy of the sample data and routes fetch to it. */
export async function startApi() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await loadConfig(); // dev config: apiUrl '/api', x-dev-user auth
  const store = new MemoryStore();
  await loadSample(store, NOW);
  const app = createApp({
    store,
    auth: { mode: 'dev', adminEmails: [] },
    send: async () => {},
    ai,
    publicCacheSeconds: 0,
  });
  const requests: { method: string; path: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('/api/')) throw new Error(`unexpected fetch: ${url}`);
    const path = url.slice('/api'.length);
    requests.push({ method: init?.method ?? 'GET', path, headers: { ...(init?.headers as Record<string, string>) } });
    return app.request(path, init);
  });
  return { store, requests };
}

/** Renders the whole app at `path`, signed in as `<user>@example.com` (or signed out). */
export async function renderApp(path: string, user?: string) {
  if (user) await auth.signIn(`${user}@example.com`, '');
  else auth.signOut();
  // `advanceTimers` keeps user-event working while Date is faked.
  const ue = userEvent.setup({ advanceTimers: () => {} });
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { ...view, user: ue };
}
