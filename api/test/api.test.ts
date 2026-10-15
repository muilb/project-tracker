import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseInitialRoles } from '../src/auth.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  app = createApp({ store, auth: { mode: 'dev', adminEmails: ['boss@example.com', ' Sep@Example.com : MNG ', 'sub@example.com:submng'] }, clock: () => now });
});

function call(method: string, path: string, as?: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(as ? { 'x-dev-user': `${as}@example.com` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('auth', () => {
  it('serves /health and /public without login, everything else needs a user', async () => {
    expect((await call('GET', '/health')).status).toBe(200);
    expect((await call('GET', '/public')).status).toBe(200);
    expect((await call('GET', '/dashboard')).status).toBe(401);
  });

  it('creates unknown users on first login as PL, or with the role given in ADMIN_EMAILS', async () => {
    expect((await (await call('GET', '/me', 'newbie')).json()).user).toMatchObject({ id: 'newbie@example.com', role: 'PL' });
    expect((await (await call('GET', '/me', 'boss')).json()).user.role).toBe('PMO');
    expect((await (await call('GET', '/me', 'sep')).json()).user.role).toBe('MNG');
    expect((await (await call('GET', '/me', 'sub')).json()).user.role).toBe('SUBMNG');
  });

  it('rejects unknown roles in ADMIN_EMAILS', () => {
    expect(() => parseInitialRoles(['a@example.com:BOSS'])).toThrow(/unknown role/);
    expect(parseInitialRoles(['', 'a@example.com']).get('a@example.com')).toBe('PMO');
  });
});

describe('projects', () => {
  it('lets a PL create a project; the PL defaults to the creator and ids are generated', async () => {
    const res = await call('POST', '/projects', 'an', { name: 'CRM mới', customer: 'KH G', gl: 'hung@example.com' });
    expect(res.status).toBe(201);
    const { project } = await res.json();
    expect(project).toMatchObject({ id: 'P08', pl: 'an@example.com', gl: 'hung@example.com', state: 'active', publicVisible: true });
    expect((await call('GET', '/projects/P08', 'an')).status).toBe(200);
  });

  it('rejects creators below PL, duplicate ids, unknown people and bad input', async () => {
    expect((await call('POST', '/projects', 'phuc', { name: 'X' })).status).toBe(403);
    expect((await call('POST', '/projects', 'an', { id: 'p01', name: 'X' })).status).toBe(409);
    expect((await call('POST', '/projects', 'an', { name: 'X', gl: 'ghost@example.com' })).status).toBe(400);
    expect((await call('POST', '/projects', 'an', { name: '' })).status).toBe(400);
  });

  it('only PMO/managers or the GL/PL of a project may edit it', async () => {
    expect((await call('PATCH', '/projects/P01', 'binh', { name: 'X' })).status).toBe(403);
    expect((await call('PATCH', '/projects/P01', 'hung', { publicName: 'Dự án kho' })).status).toBe(200);
    const res = await call('PATCH', '/projects/P01', 'lan', { state: 'paused' });
    expect((await res.json()).project.state).toBe('paused');
    const list = await (await call('GET', '/projects', 'lan')).json();
    expect(list.projects.map((p: { id: string }) => p.id)).not.toContain('P01');
  });
});

describe('updates and items', () => {
  it('an update from the PL resets the deadline', async () => {
    const before = (await (await call('GET', '/projects/P05', 'hoa')).json()).project;
    expect(before.lateHours).toBeGreaterThan(0);
    expect((await call('POST', '/projects/P05/updates', 'hoa', { health: 'green', summary: 'Ổn định' })).status).toBe(201);
    const after = (await (await call('GET', '/projects/P05', 'hoa')).json()).project;
    expect(after.lateHours).toBe(0);
    expect(after.latestUpdate.summary).toBe('Ổn định');
  });

  it('creates and closes an item', async () => {
    const res = await call('POST', '/projects/P07/items', 'long', { type: 'issue', title: 'Thiếu tài liệu', priority: 'high', date: '2026-10-08' });
    expect(res.status).toBe(201);
    const { item } = await res.json();
    let v = (await (await call('GET', '/projects/P07', 'long')).json()).project;
    expect([v.overdueItems, v.health, v.urgency]).toEqual([1, 'yellow', 'critical']);

    expect((await call('PATCH', `/projects/P07/items/${item.id}`, 'long', { status: 'done' })).status).toBe(200);
    v = (await (await call('GET', '/projects/P07', 'long')).json()).project;
    expect([v.overdueItems, v.health]).toEqual([0, 'green']);
  });

  it('validates item input', async () => {
    expect((await call('POST', '/projects/P07/items', 'long', { type: 'issue', title: 'X', date: '09/10' })).status).toBe(400);
    expect((await call('POST', '/projects/P99/items', 'long', { type: 'issue', title: 'X', date: '2026-10-10' })).status).toBe(404);
  });
});

describe('users and settings', () => {
  it('only PMO / MNG manage users', async () => {
    expect((await call('POST', '/users', 'an', { id: 'x@example.com', name: 'X' })).status).toBe(403);
    expect((await call('POST', '/users', 'lan', { id: 'X@Example.com', name: 'X', role: 'GL' })).status).toBe(201);
    expect((await store.getUser('x@example.com'))?.role).toBe('GL');
    expect((await call('PATCH', '/users/an@example.com', 'lan', { role: 'GL' })).status).toBe(200);
  });

  it('settings are readable by everyone, writable by admins', async () => {
    const { settings } = await (await call('GET', '/settings', 'an')).json();
    expect(settings.frequencyHours.red).toBe(24);
    expect((await call('PUT', '/settings', 'an', settings)).status).toBe(403);
    expect((await call('PUT', '/settings', 'lan', { ...settings, soonDays: 5 })).status).toBe(200);
  });
});
