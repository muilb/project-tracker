import { beforeAll, describe, expect, it } from 'vitest';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { User } from '../src/types.js';
import { activeProjectViews, buildDashboard, buildPublic } from '../src/views.js';

// The expected numbers below are the ones shown on the Excel dashboard at the same moment.
const now = new Date(vnToIso(SAMPLE_NOW_VN));
const store = new MemoryStore();
const byId = () => store.snapshot().then((s) => Object.fromEntries(activeProjectViews(s, now).map((v) => [v.id, v])));

beforeAll(() => loadSample(store, now));

describe('project rules (same results as the Excel tracker)', () => {
  it('aggregates health as the worst of PL/GL, PMO and overdue items', async () => {
    const v = await byId();
    expect(Object.fromEntries(Object.entries(v).map(([id, p]) => [id, p.health]))).toEqual({
      P01: 'green',
      P02: 'yellow',
      P03: 'red',
      P04: 'yellow', // PL said green, PMO said yellow
      P05: 'green',
      P06: 'yellow',
      P07: 'green',
    });
  });

  it('computes the required update frequency', async () => {
    const v = await byId();
    expect(v.P01.frequencyHours).toBe(24); // green, but an event in 3 days
    expect(v.P02.frequencyHours).toBe(24);
    expect(v.P03.frequencyHours).toBe(8); // custom frequency
    expect(v.P04.frequencyHours).toBe(72);
    expect(v.P05.frequencyHours).toBe(168);
    expect(v.P06.frequencyHours).toBe(24);
    expect(v.P07.frequencyHours).toBe(168);
  });

  it('measures update lateness from the last PL/GL/supporter update', async () => {
    const v = await byId();
    expect(Math.round(v.P05.lateHours)).toBe(91); // "3 ngày 19 giờ"
    expect(Math.round(v.P06.lateHours)).toBe(48);
    expect(Math.round(v.P02.lateHours)).toBe(42);
    expect(Math.round(v.P04.lateHours)).toBe(18); // supporter Phúc's update counts
    expect(Math.round(v.P03.lateHours)).toBe(17); // GL Sơn's update counts, PMO / SubMNG do not
    expect(v.P07.lateHours).toBe(0);
  });

  it('counts open, high and overdue items and picks the next event/milestone', async () => {
    const v = await byId();
    expect([v.P03.highIssues, v.P03.overdueItems]).toEqual([2, 1]);
    expect(v.P04.overdueItems).toBe(1);
    expect(v.P01.openItems.map((i) => i.title)).not.toContain('Thiếu dữ liệu mẫu từ khách'); // done
    expect(v.P06.nextItem?.title).toBe('Release batch mới');
    expect(v.P03.nextItem?.daysLeft).toBe(0);
  });

  it('derives urgency', async () => {
    const v = await byId();
    expect(v.P03.urgency).toBe('critical');
    expect([v.P02.urgency, v.P04.urgency, v.P06.urgency]).toEqual(['attention', 'attention', 'attention']);
    expect([v.P01.urgency, v.P05.urgency, v.P07.urgency]).toEqual(['normal', 'normal', 'normal']);
  });
});

describe('dashboards', () => {
  const lan: User = { id: 'lan@example.com', name: 'Lan', role: 'PMO', createdAt: '' };
  const hung: User = { id: 'hung@example.com', name: 'Hùng', role: 'GL', createdAt: '' };

  it('matches the Excel KPI tiles', async () => {
    const d = buildDashboard(await store.snapshot(), now, lan, { scope: 'all' });
    expect(d.kpis).toMatchObject({ active: 7, red: 1, yellow: 3, green: 3, lateUpdates: 6, highIssues: 3, overdueItems: 2 });
    expect(d.attention[0].id).toBe('P03');
    expect(d.priorityItems[0].title).toBe('Môi trường test của khách chưa sẵn sàng');
    expect(d.byGl.find((r) => r.gl === 'son@example.com')).toMatchObject({ red: 1, yellow: 1, green: 0 });
  });

  it('lists events/milestones as upcoming and actionable issues separately', async () => {
    const d = buildDashboard(await store.snapshot(), now, lan, { scope: 'all' });
    expect(d.upcoming.every((i) => i.type !== 'issue')).toBe(true);
    // medium priority, but due today
    expect(d.priorityItems.map((i) => i.title)).toContain('Spec màn hình thanh toán chưa chốt');
    expect(d.upcomingDays).toBe(7);
  });

  it('filters to the projects of the logged-in user', async () => {
    const d = buildDashboard(await store.snapshot(), now, hung, { scope: 'mine' });
    expect(d.kpis.active).toBe(3); // P01, P02, P07
    expect(d.upcoming.every((i) => ['P01', 'P02', 'P07'].includes(i.projectId))).toBe(true);
  });

  it('public dashboard lists urgent projects and events without internal details', async () => {
    const p = buildPublic(await store.snapshot(), now);
    expect(p.counts).toEqual({ total: 7, critical: 1, attention: 3, normal: 3 });
    expect(p.projects.map((x) => x.id)).toEqual(['P03', 'P04', 'P06', 'P02']); // overdue items first, then lateness
    expect(p.upcoming.some((i) => i.title === 'Release batch mới')).toBe(true);
    const json = JSON.stringify(p);
    for (const secret of ['KH C', 'Nhờ TL review', 'example.com', 'Thiếu 1 dev Java']) expect(json).not.toContain(secret);
  });
});
