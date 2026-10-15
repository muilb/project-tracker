import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAccounts } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
let accounts: MemoryAccounts;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  accounts = new MemoryAccounts([
    { email: 'thao@brycen.com.vn', name: 'Thảo', createdAt: now.toISOString() },
    { email: 'boss@brycen.com.vn', name: 'Sếp', createdAt: now.toISOString() },
    { email: 'spam@brycen.com.vn', createdAt: now.toISOString() },
  ]);
  app = createApp({
    store,
    accounts,
    auth: { mode: 'dev', adminEmails: ['boss@brycen.com.vn:MNG'] },
    clock: () => now,
    send: async () => {},
  });
});

const call = (method: string, path: string, as: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('pending sign-ups', () => {
  it('only PMO / MNG can list and approve', async () => {
    expect((await call('GET', '/users/pending', 'an')).status).toBe(403);
    expect((await call('POST', '/users/pending/thao%40brycen.com.vn/approve', 'hung', {})).status).toBe(403);
    const { pending } = await (await call('GET', '/users/pending', 'lan')).json();
    expect(pending.map((p: { email: string }) => p.email)).toEqual(['thao@brycen.com.vn', 'boss@brycen.com.vn', 'spam@brycen.com.vn']);
  });

  it('approving creates the user with the chosen role, ADMIN_EMAILS role, or PL', async () => {
    let res = await call('POST', '/users/pending/thao%40brycen.com.vn/approve', 'lan', { role: 'GL' });
    expect((await res.json()).user).toMatchObject({ id: 'thao@brycen.com.vn', name: 'Thảo', role: 'GL' });

    res = await call('POST', '/users/pending/boss%40brycen.com.vn/approve', 'lan', {});
    expect((await res.json()).user.role).toBe('MNG');

    res = await call('POST', '/users/pending/spam%40brycen.com.vn/approve', 'mng', {});
    expect((await res.json()).user).toMatchObject({ name: 'spam', role: 'PL' });
    expect(await accounts.listPending()).toHaveLength(0);
  });

  it('keeps a user record PMO created beforehand', async () => {
    await call('POST', '/users', 'lan', { id: 'thao@brycen.com.vn', name: 'Nguyễn Thảo', role: 'PMO' });
    const { user } = await (await call('POST', '/users/pending/thao%40brycen.com.vn/approve', 'lan', {})).json();
    expect(user).toMatchObject({ name: 'Nguyễn Thảo', role: 'PMO' });
  });

  it('rejecting removes the sign-up; unknown emails are 404', async () => {
    expect((await call('POST', '/users/pending/spam%40brycen.com.vn/reject', 'lan')).status).toBe(200);
    expect((await accounts.listPending()).map((a) => a.email)).not.toContain('spam@brycen.com.vn');
    expect((await store.getUser('spam@brycen.com.vn'))).toBeUndefined();
    expect((await call('POST', '/users/pending/ghost%40brycen.com.vn/approve', 'lan', {})).status).toBe(404);
  });
});
