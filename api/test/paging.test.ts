import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
const call = (path: string, as: string) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: async () => {} }).request(path, {
    headers: { 'x-dev-user': `${as}@example.com` },
  });

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
});

describe('update history paging', () => {
  beforeEach(async () => {
    // 35 more updates on P01, one per hour going back.
    for (let i = 0; i < 35; i++)
      await store.putUpdate({
        id: `u${String(i).padStart(2, '0')}`,
        projectId: 'P01',
        at: new Date(now.getTime() - (i + 1) * 3600_000).toISOString(),
        author: 'an@example.com',
        authorRole: 'PL',
        summary: `Cập nhật ${i}`,
      });
  });

  it('the project page gets the newest 10 and a cursor', async () => {
    const detail = await (await call('/projects/P01', 'an')).json();
    expect(detail.updates).toHaveLength(10);
    expect(detail.updates[0].summary).toBe('Cập nhật 0');
    expect(detail.nextBefore).toBeTruthy();
  });

  it('pages through every update once, newest first, then stops', async () => {
    const all = (await store.listUpdates('P01')).length;
    const first = await (await call('/projects/P01', 'an')).json();
    const seen = first.updates.map((u: { id: string }) => u.id);
    let before = first.nextBefore;
    while (before) {
      const page = await (await call(`/projects/P01/updates?before=${encodeURIComponent(before)}`, 'an')).json();
      expect(page.updates.length).toBeLessThanOrEqual(20);
      seen.push(...page.updates.map((u: { id: string }) => u.id));
      before = page.nextBefore;
    }
    expect(seen).toHaveLength(all);
    expect(new Set(seen).size).toBe(all);
  });
});

describe('audit log paging', () => {
  it('returns 50 at a time with a cursor to older entries', async () => {
    for (let i = 0; i < 60; i++)
      await store.addAudit({
        id: `a${i}`,
        at: new Date(now.getTime() - i * 60_000).toISOString(),
        actor: 'admin@example.com',
        action: 'role_change',
        target: `u${i}`,
      });
    const first = await (await call('/audit', 'admin')).json();
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0].target).toBe('u0');
    const next = await (await call(`/audit?before=${encodeURIComponent(first.nextBefore)}`, 'admin')).json();
    expect(next.entries.map((e: { target: string }) => e.target)).toEqual(Array.from({ length: 10 }, (_, i) => `u${i + 50}`));
    expect(next.nextBefore).toBeUndefined();
  });
});
