// Update history: the snapshot keeps recent and pinned updates only, and the views do not change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { weeklyChanges } from '../src/notify/events.js';
import { buildProjectView, pinUpdates } from '../src/rules.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import { DEFAULT_SETTINGS, ROLES, type Health, type Update } from '../src/types.js';
import { activeProjectViews } from '../src/views.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const upd = (id: string, at: string, author: string, authorRole: Update['authorRole'], over: Partial<Update> = {}): Update => ({
  id,
  projectId: 'P01',
  at,
  author: `${author}@example.com`,
  authorRole,
  summary: id,
  ...over,
});

let store: MemoryStore;
const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: async () => {} }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
});

describe('pinned updates', () => {
  it('give the same view as the whole history, whoever owns the project', async () => {
    const base = (await store.getProject('P01'))!;
    const people = ['an', 'hung', 'phuc', 'lan', 'minh'];
    const healths: (Health | undefined)[] = [undefined, 'green', 'yellow', 'red'];
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (let run = 0; run < 300; run++) {
      // Few distinct days, so many updates share a time.
      const history = Array.from({ length: 1 + rnd(30) }, (_, i) =>
        upd(`u${i}`, daysAgo(rnd(12) * 10), people[rnd(5)], ROLES[rnd(ROLES.length)], {
          health: healths[rnd(4)],
          deletedAt: rnd(8) === 0 ? daysAgo(0) : undefined,
        }),
      );
      const someone = () => `${people[rnd(5)]}@example.com`;
      const project = { ...base, pl: someone(), gl: someone(), supporters: [someone()] };
      const live = history.filter((u) => !u.deletedAt);
      const pinned = pinUpdates(history);
      const expected = buildProjectView(project, live, [], DEFAULT_SETTINGS, now);
      expect(buildProjectView(project, pinned, [], DEFAULT_SETTINGS, now)).toEqual(expected);
      // Any other updates on top (the snapshot's recent ones) change nothing either.
      expect(buildProjectView(project, [...live.filter(() => rnd(2) === 0), ...pinned], [], DEFAULT_SETTINGS, now)).toEqual(expected);
    }
  });

  it('the snapshot leaves out old updates that decide nothing; the views stay the same', async () => {
    for (let i = 0; i < 40; i++) await store.putUpdate(upd(`old${i}`, daysAgo(100 + i), 'an', 'PL', { health: 'red' }));
    await store.putUpdate(upd('old-pmo', daysAgo(150), 'lan', 'PMO', { health: 'yellow' }));
    const full = await store.snapshot();
    const recent = await store.snapshot({ now });
    expect(activeProjectViews(recent, now)).toEqual(activeProjectViews(full, now));
    const old = recent.updates.filter((u) => u.id.startsWith('old')).map((u) => u.id);
    const pinned = pinUpdates(full.updates.filter((u) => u.projectId === 'P01'));
    expect(old).toEqual(pinned.filter((u) => u.id.startsWith('old')).map((u) => u.id));
    expect(old.length).toBeLessThan(3);
  });

  it('the project page, its history and a new update do not read the whole history', async () => {
    const spy = vi.spyOn(store, 'listUpdates');
    const p01 = (await store.getProject('P01'))!;
    const full = buildProjectView(p01, await store.listUpdates('P01'), await store.listItems('P01'), store.settings, now);
    spy.mockClear();
    const page = await (await call('GET', '/projects/P01', 'an')).json();
    expect(page.project).toEqual(JSON.parse(JSON.stringify(full)));
    const before = encodeURIComponent(page.nextBefore ?? '~');
    const more = await (await call('GET', `/projects/P01/updates?limit=1&before=${before}`, 'an')).json();
    expect(more.updates).toHaveLength(1);
    expect((await call('POST', '/projects/P01/updates', 'an', { health: 'yellow', summary: 'Trễ nhẹ' })).status).toBe(201);
    expect((await (await call('GET', '/projects/P01', 'an')).json()).project.declaredHealth).toBe('yellow');
    expect(spy).not.toHaveBeenCalled();
  });

  it('deleting a pinned update brings back the one before it', async () => {
    const { update } = await (await call('POST', '/projects/P01/updates', 'an', { health: 'red', summary: 'Sự cố' })).json();
    expect((await (await call('GET', '/projects/P01', 'an')).json()).project.declaredHealth).toBe('red');
    await call('DELETE', `/projects/P01/updates/${update.id}`, 'an');
    expect((await (await call('GET', '/projects/P01', 'an')).json()).project.declaredHealth).toBe('green');
  });

  it('the trash still lists updates deleted long ago', async () => {
    await store.putUpdate(upd('gone', daysAgo(200), 'an', 'PL', { deletedAt: daysAgo(190), deletedBy: 'lan@example.com' }));
    const trash = await (await call('GET', '/trash', 'lan')).json();
    expect(trash.updates).toEqual([expect.objectContaining({ id: 'gone', projectId: 'P01' })]);
  });

  it("weekly digest: last week's colour may come from an update older than the snapshot keeps", async () => {
    const p01 = (await store.getProject('P01'))!;
    await store.createProject({ ...p01, id: 'P99', pl: 'x@example.com', gl: undefined, supporters: [], createdAt: daysAgo(200) });
    await store.putUpdate(upd('red', daysAgo(100), 'x', 'PL', { projectId: 'P99', health: 'red' }));
    await store.putUpdate(upd('green', daysAgo(2), 'x', 'PL', { projectId: 'P99', health: 'green' }));
    const snap = await store.snapshot({ now });
    expect(snap.updates.some((u) => u.id === 'red')).toBe(false);
    const { colour } = await weeklyChanges(store, snap, activeProjectViews(snap, now), now);
    expect(colour.find((c) => c.view.id === 'P99')).toMatchObject({ view: { health: 'green' }, before: 'red' });
  });
});
