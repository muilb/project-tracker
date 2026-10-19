// Items: the snapshot carries open items and those closed in the last SNAPSHOT_UPDATE_DAYS; the views
// do not change, the project page and the trash still have the older ones.
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Item } from '../src/types.js';
import { activeProjectViews } from '../src/views.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const item = (id: string, days: number, over: Partial<Item> = {}): Item => ({
  id,
  projectId: 'P01',
  type: 'issue',
  title: id,
  priority: 'high',
  date: daysAgo(days).slice(0, 10),
  status: 'done',
  createdBy: 'an@example.com',
  createdAt: daysAgo(days + 5),
  updatedAt: daysAgo(days),
  ...over,
});

let store: MemoryStore;
const call = async (path: string, as: string) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: async () => {} }).request(path, {
    headers: { 'x-dev-user': `${as}@example.com` },
  });

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  for (let i = 0; i < 30; i++) await store.putItem(item(`OLD${i}`, 100 + i, { projectId: i % 2 ? 'P01' : 'P03' }));
});

describe('closed items in the snapshot', () => {
  it('only recent closed ones; the views are the same as with every item', async () => {
    const full = await store.snapshot();
    const recent = await store.snapshot({ now });
    expect(full.items.filter((i) => i.id.startsWith('OLD'))).toHaveLength(30);
    expect(recent.items.filter((i) => i.id.startsWith('OLD'))).toEqual([]);
    // Every open item, and the sample's recently closed one, are still there.
    expect(recent.items.filter((i) => i.status !== 'done' && i.status !== 'postponed')).toHaveLength(
      full.items.filter((i) => i.status !== 'done' && i.status !== 'postponed').length,
    );
    expect(recent.items.some((i) => i.title === 'Thiếu dữ liệu mẫu từ khách')).toBe(true);
    expect(activeProjectViews(recent, now)).toEqual(activeProjectViews(full, now));
  });

  it('a closed item edited lately is carried again', async () => {
    await store.putItem(item('OLD1', 100, { note: 'thêm ghi chú', updatedAt: daysAgo(1) }));
    expect((await store.snapshot({ now })).items.map((i) => i.id)).toContain('OLD1');
  });

  it('the project page and the trash still have the older items', async () => {
    const page = await (await call('/projects/P01', 'an')).json();
    expect(page.items.filter((i: Item) => i.id.startsWith('OLD'))).toHaveLength(15);
    await store.putItem(item('GONE', 300, { deletedAt: daysAgo(290), deletedBy: 'lan@example.com' }));
    const trash = await (await call('/trash', 'lan')).json();
    expect(trash.items).toEqual([expect.objectContaining({ id: 'GONE', projectId: 'P01' })]);
  });
});

describe('OTHER sees a project through an item they own', () => {
  // Quang (OTHER) supports P03 and P06, not P01.
  const sees = async () => {
    const dashboard = await (await call('/dashboard', 'quang')).json();
    const page = await call('/projects/P01', 'quang');
    return { dashboard: dashboard.kpis.active, page: page.status };
  };

  it('open, or closed in the last 60 days; not through an item closed long ago', async () => {
    expect(await sees()).toEqual({ dashboard: 2, page: 404 });
    await store.putItem(item('Q1', 100, { owner: 'quang@example.com' }));
    expect(await sees()).toEqual({ dashboard: 2, page: 404 });
    await store.putItem(item('Q1', 10, { owner: 'quang@example.com' }));
    expect(await sees()).toEqual({ dashboard: 3, page: 200 });
    await store.putItem(item('Q1', 400, { owner: 'quang@example.com', status: 'open' }));
    expect(await sees()).toEqual({ dashboard: 3, page: 200 });
  });
});
