import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAccounts } from '../src/accounts.js';
import { buildAskContext } from '../src/ai/ask.js';
import { createApp } from '../src/app.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
let accounts: MemoryAccounts;
let clock: Date;

const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, accounts, auth: { mode: 'dev', adminEmails: [] }, clock: () => clock, send: async () => {} }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  accounts = new MemoryAccounts();
  clock = now;
});

describe('deleting updates', () => {
  it('lets the author delete within 24 hours, and hides the update', async () => {
    const { body } = await json(await call('POST', '/projects/P01/updates', 'an', { summary: 'Gõ nhầm dự án', health: 'red' }));
    expect((await call('DELETE', `/projects/P01/updates/${body.update.id}`, 'binh')).status).toBe(403); // not the author
    expect((await call('DELETE', `/projects/P01/updates/${body.update.id}`, 'an')).status).toBe(200);
    const detail = await json(await call('GET', '/projects/P01', 'an'));
    expect(detail.body.updates.map((u: { id: string }) => u.id)).not.toContain(body.update.id);
    expect(detail.body.project.latestUpdate?.summary).not.toBe('Gõ nhầm dự án');
    expect((await call('DELETE', `/projects/P01/updates/${body.update.id}`, 'an')).status).toBe(404);
  });

  it('after 24 hours only PMO / managers can delete', async () => {
    const { body } = await json(await call('POST', '/projects/P01/updates', 'an', { summary: 'Cũ' }));
    clock = new Date(now.getTime() + 25 * 3600_000);
    expect((await call('DELETE', `/projects/P01/updates/${body.update.id}`, 'an')).status).toBe(403);
    expect((await call('DELETE', `/projects/P01/updates/${body.update.id}`, 'lan')).status).toBe(200);
  });
});

describe('deleting items', () => {
  it('PL / GL of the project, the creator or admins; the item disappears everywhere', async () => {
    const { body } = await json(
      await call('POST', '/projects/P01/items', 'phuc', { type: 'issue', title: 'Mục nhập nhầm', priority: 'low', date: '2026-10-20' }),
    );
    const id = body.item.id;
    expect((await call('DELETE', `/projects/P01/items/${id}`, 'binh')).status).toBe(403); // PL of another project
    expect((await call('DELETE', `/projects/P01/items/${id}`, 'an')).status).toBe(200); // PL of P01
    const detail = await json(await call('GET', '/projects/P01', 'an'));
    expect(detail.body.items.map((i: { id: string }) => i.id)).not.toContain(id);
    const snap = await store.snapshot();
    expect(buildAskContext(snap, now, snap.users[0])).not.toContain('Mục nhập nhầm');
    expect((await call('PATCH', `/projects/P01/items/${id}`, 'an', { status: 'done' })).status).toBe(404);
  });
});

describe('deleting projects and the trash', () => {
  it('only admins delete; the project is gone from lists, detail and public', async () => {
    expect((await call('DELETE', '/projects/P07', 'long')).status).toBe(403); // its own PL
    expect((await call('DELETE', '/projects/P07', 'lan')).status).toBe(200);
    expect((await call('GET', '/projects/P07', 'lan')).status).toBe(404);
    const list = await json(await call('GET', '/projects?state=all', 'lan'));
    expect(list.body.projects.map((p: { id: string }) => p.id)).not.toContain('P07');
    const pub = await json(await call('GET', '/public', 'x'));
    expect(JSON.stringify(pub.body)).not.toContain('P07');
    const taken = await json(await call('POST', '/projects', 'lan', { id: 'P07', name: 'Trùng mã' }));
    expect(taken.status).toBe(409);
    expect(taken.body.error).toContain('Thùng rác');
  });

  it('PMO lists and restores; non-admins cannot', async () => {
    await call('DELETE', '/projects/P07', 'lan');
    const { body: created } = await json(
      await call('POST', '/projects/P01/items', 'an', { type: 'event', title: 'Họp nhầm', date: '2026-10-21' }),
    );
    await call('DELETE', `/projects/P01/items/${created.item.id}`, 'an');

    expect((await call('GET', '/trash', 'an')).status).toBe(403);
    const trash = await json(await call('GET', '/trash', 'lan'));
    expect(trash.body.projects).toEqual([expect.objectContaining({ id: 'P07', deletedBy: 'lan@example.com' })]);
    expect(trash.body.items).toEqual([expect.objectContaining({ id: created.item.id, projectId: 'P01', title: 'Họp nhầm' })]);

    expect((await call('POST', '/trash/restore', 'lan', { kind: 'project', projectId: 'P07' })).status).toBe(200);
    expect((await call('GET', '/projects/P07', 'lan')).status).toBe(200);
    expect((await call('POST', '/trash/restore', 'lan', { kind: 'item', projectId: 'P01', id: created.item.id })).status).toBe(200);
    const detail = await json(await call('GET', '/projects/P01', 'an'));
    expect(detail.body.items.map((i: { id: string }) => i.id)).toContain(created.item.id);
    expect((await json(await call('GET', '/trash', 'lan'))).body).toEqual({ projects: [], items: [], updates: [], comments: [] });
  });

  it('restores an update, but not a row of a project that is still deleted', async () => {
    const { body } = await json(await call('POST', '/projects/P02/updates', 'binh', { summary: 'Xoá rồi khôi phục' }));
    await call('DELETE', `/projects/P02/updates/${body.update.id}`, 'binh');
    const trash = await json(await call('GET', '/trash', 'lan'));
    expect(trash.body.updates).toEqual([expect.objectContaining({ id: body.update.id, summary: 'Xoá rồi khôi phục' })]);
    await call('DELETE', '/projects/P02', 'lan');
    expect((await call('POST', '/trash/restore', 'lan', { kind: 'update', projectId: 'P02', id: body.update.id })).status).toBe(400);
    await call('POST', '/trash/restore', 'lan', { kind: 'project', projectId: 'P02' });
    expect((await call('POST', '/trash/restore', 'lan', { kind: 'update', projectId: 'P02', id: body.update.id })).status).toBe(200);
    const detail = await json(await call('GET', '/projects/P02', 'binh'));
    expect(detail.body.updates[0].summary).toBe('Xoá rồi khôi phục');
  });
});

describe('temporary passwords', () => {
  it('PMO / MNG set one for someone else', async () => {
    expect((await call('POST', '/users/an%40example.com/reset-password', 'hung')).status).toBe(403); // GL
    expect((await call('POST', '/users/lan%40example.com/reset-password', 'lan')).status).toBe(400); // self
    const res = await json(await call('POST', '/users/an%40example.com/reset-password', 'lan'));
    expect(res.status).toBe(200);
    expect(res.body.password).toMatch(/^(?=.*[a-z])(?=.*\d)[a-z0-9]{10}$/);
    expect(accounts.resets).toEqual([{ email: 'an@example.com', password: res.body.password }]);
  });

  it('explains accounts that are pending or do not exist', async () => {
    accounts = new MemoryAccounts([{ email: 'moi@example.com', createdAt: now.toISOString() }], new Set(['an@example.com']));
    expect((await call('POST', '/users/moi%40example.com/reset-password', 'lan')).status).toBe(400);
    expect((await call('POST', '/users/hung%40example.com/reset-password', 'lan')).status).toBe(404);
  });
});
