import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAccounts } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
let accounts: MemoryAccounts;
let adminEmails: string[];

const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, accounts, auth: { mode: 'dev', adminEmails }, clock: () => now, send: async () => {} }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const roleOf = async (id: string) => (await store.getUser(`${id}@example.com`))?.role;

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  accounts = new MemoryAccounts();
  adminEmails = [];
});

describe('the first ADMIN', () => {
  it('comes from ADMIN_EMAILS at the next sign-in, even for an existing user', async () => {
    adminEmails = ['lan@example.com:ADMIN', 'an@example.com:MNG'];
    await call('GET', '/me', 'lan');
    await call('GET', '/me', 'an');
    expect(await roleOf('lan')).toBe('ADMIN');
    expect(await roleOf('an')).toBe('PL'); // other roles only apply on the first sign-in
    expect(store.audit).toEqual([
      expect.objectContaining({ action: 'admin_granted', target: 'lan@example.com', detail: 'PMO → ADMIN (ADMIN_EMAILS)' }),
    ]);
  });
});

describe('who can grant and manage ADMIN', () => {
  it('only ADMIN grants ADMIN, by role change, pre-created user or approval', async () => {
    expect((await call('PATCH', '/users/an@example.com', 'lan', { role: 'ADMIN' })).status).toBe(403);
    expect((await call('POST', '/users', 'lan', { id: 'new@example.com', name: 'New', role: 'ADMIN' })).status).toBe(403);
    accounts = new MemoryAccounts([{ email: 'wait@example.com', createdAt: now.toISOString() }]);
    expect((await call('POST', '/users/pending/wait%40example.com/approve', 'lan', { role: 'ADMIN' })).status).toBe(403);

    expect((await call('PATCH', '/users/an@example.com', 'admin', { role: 'ADMIN' })).status).toBe(200);
    expect(await roleOf('an')).toBe('ADMIN');
    expect(store.audit.at(-1)).toMatchObject({
      actor: 'admin@example.com',
      action: 'role_change',
      target: 'an@example.com',
      detail: 'PL → ADMIN',
    });
  });

  it('PMO / MNG cannot change the role or password of an ADMIN account', async () => {
    expect((await call('PATCH', '/users/admin@example.com', 'mng', { role: 'PL' })).status).toBe(403);
    expect((await call('POST', '/users/admin%40example.com/reset-password', 'lan')).status).toBe(403);
    expect((await call('POST', '/users/an%40example.com/reset-password', 'lan')).status).toBe(200); // others still fine
    expect((await call('POST', '/users/lan%40example.com/reset-password', 'admin')).status).toBe(200);
    expect(store.audit.map((a) => a.action)).toEqual(['password_reset', 'password_reset']);
  });

  it('nobody changes their own role (so the last ADMIN stays)', async () => {
    const res = await call('PATCH', '/users/admin@example.com', 'admin', { role: 'PL' });
    expect(res.status).toBe(400);
    expect(await roleOf('admin')).toBe('ADMIN');
    // A name change is not a role change.
    expect((await call('PATCH', '/users/admin@example.com', 'admin', { name: 'Admin' })).status).toBe(200);
  });

  it('ADMIN can do what managers do', async () => {
    expect((await call('DELETE', '/projects/P07', 'admin')).status).toBe(200);
    expect((await call('GET', '/trash', 'admin')).status).toBe(200);
    expect((await call('GET', '/users/pending', 'admin')).status).toBe(200);
    expect((await call('PUT', '/settings', 'admin', await store.getSettings())).status).toBe(200);
  });
});

describe('audit log', () => {
  it('only ADMIN reads it, newest first', async () => {
    await call('DELETE', '/projects/P07', 'lan');
    await call('POST', '/trash/restore', 'lan', { kind: 'project', projectId: 'P07' });
    expect((await call('GET', '/audit', 'lan')).status).toBe(403);
    const { entries } = await (await call('GET', '/audit', 'admin')).json();
    expect(entries.map((e: { action: string }) => e.action)).toEqual(['restore', 'project_delete']);
    expect(entries[1]).toMatchObject({ actor: 'lan@example.com', target: 'P07' });
  });
});
