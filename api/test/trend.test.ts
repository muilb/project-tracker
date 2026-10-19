// Health trend: the hourly job records every running or paused project's colour per Vietnam day; the
// project page and the dashboard read it back (only what the caller may see). Plus the end-date warnings.
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runHourly } from '../src/notify/pipeline.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { DashboardTrend, ProjectTrend } from '../src/trend.js';
import type { Channel, Project } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN)); // Friday 2026-10-09 09:45, Vietnam time
const at = (vn: string) => new Date(vnToIso(vn));

let store: MemoryStore;
let sent: string[];
const send = async (ch: Channel) => void sent.push(ch.id);
const call = (path: string, as: string, method = 'GET', body?: unknown) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async <T>(path: string, as: string) => {
  const res = await call(path, as);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};
const editProject = async (id: string, over: Partial<Project>) => store.putProject({ ...(await store.getProject(id))!, ...over });

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
});

describe('recording', () => {
  it('writes one row per Vietnam day: running and paused projects, not closed or deleted ones', async () => {
    await editProject('P05', { state: 'paused' });
    await editProject('P06', { state: 'closed' });
    await editProject('P07', { deletedAt: now.toISOString(), deletedBy: 'lan@example.com' });
    const result = await runHourly({ store, send }, at('2026-10-10 23:00'));
    expect(result.recorded).toBe(5);
    const [day] = await store.listHealthDays('2026-10-10', '2026-10-10');
    expect(day.at).toBe(vnToIso('2026-10-10 23:00'));
    expect(Object.keys(day.projects).sort()).toEqual(['P01', 'P02', 'P03', 'P04', 'P05']);
    expect(day.projects.P05.state).toBe('paused');
    expect(day.projects.P03).toMatchObject({ state: 'active', health: 'red', declaredHealth: 'red', pmoHealth: 'red' });
    expect(day.projects.P03.overdueItems).toBeGreaterThan(0);
  });

  it('a later run the same day replaces the row; the next day adds one', async () => {
    await runHourly({ store, send }, at('2026-10-10 08:00'));
    await store.putUpdate({ id: 'u1', projectId: 'P01', at: vnToIso('2026-10-10 15:00'), author: 'an@example.com', authorRole: 'PL', health: 'red', summary: 'Khách huỷ' });
    await runHourly({ store, send }, at('2026-10-10 23:00'));
    await runHourly({ store, send }, at('2026-10-11 00:00'));
    const days = await store.listHealthDays('2026-10-10', '2026-10-11');
    expect(days.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11']);
    expect(days[0].projects.P01.health).toBe('red');
    expect(days[0].at).toBe(vnToIso('2026-10-10 23:00'));
  });

  it('a failed write does not stop the alerts, and the run still fails', async () => {
    await store.putChannel({
      id: 'C1',
      name: 'Kênh test',
      kind: 'teams',
      webhookUrl: 'https://prod-01.southeastasia.logic.azure.com:443/workflows/a/triggers/manual/paths/invoke?sig=X',
      scope: { type: 'all' },
      events: ['late_update'],
      quietHours: false,
      enabled: true,
      createdBy: 'lan@example.com',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    store.putHealthDay = async () => {
      throw new Error('DynamoDB down');
    };
    await expect(runHourly({ store, send }, now)).rejects.toThrow('DynamoDB down');
    expect(sent).toContain('C1');
  });
});

describe('GET /projects/:id/trend', () => {
  it('12 weeks back from today, with the recorded days of the project', async () => {
    const t = await json<ProjectTrend>('/projects/P03/trend', 'lan');
    expect(t).toMatchObject({ from: '2026-07-18', to: '2026-10-09', more: false });
    // The sample's history starts on 2026-09-12; today's row comes from the data.
    expect(t.days).toHaveLength(28);
    expect(t.days[0].date).toBe('2026-09-12');
    expect(t.days.at(-1)).toMatchObject({ date: '2026-10-09', state: 'active', health: 'red', pmoHealth: 'red' });
    expect(t.days.filter((d) => d.health === 'red').map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
  });

  it('starts no earlier than the project; "all" goes back to its start when older days exist', async () => {
    await editProject('P07', { startDate: '2026-10-01' });
    expect(await json<ProjectTrend>('/projects/P07/trend', 'lan')).toMatchObject({ from: '2026-10-01', more: false });

    await store.putHealthDay({ date: '2026-07-18', at: vnToIso('2026-07-18 23:00'), projects: {} });
    await store.putHealthDay({
      date: '2026-06-01',
      at: vnToIso('2026-06-01 23:00'),
      projects: { P03: { state: 'active', health: 'green', overdueItems: 0, lateHours: 0 } },
    });
    expect((await json<ProjectTrend>('/projects/P03/trend', 'lan')).more).toBe(true);
    const all = await json<ProjectTrend>('/projects/P03/trend?all=1', 'lan');
    expect(all).toMatchObject({ from: '2026-05-10', more: false });
    expect(all.days[0]).toMatchObject({ date: '2026-06-01', health: 'green' });
  });

  it('a closed project ends on the day it was closed', async () => {
    await editProject('P07', { state: 'closed', updatedAt: vnToIso('2026-09-29 17:00') });
    const t = await json<ProjectTrend>('/projects/P07/trend', 'lan');
    expect(t.to).toBe('2026-09-29');
    expect(t.days.at(-1)!.date).toBe('2026-09-29');
  });

  it('only for those who may see the project', async () => {
    // quang supports P03 and P06 only.
    expect((await call('/projects/P03/trend', 'quang')).status).toBe(200);
    expect((await call('/projects/P01/trend', 'quang')).status).toBe(404);
  });
});

describe('GET /dashboard/trend', () => {
  it('counts each week by its last mark, from the week the history started', async () => {
    const t = await json<DashboardTrend>('/dashboard/trend?scope=all', 'lan');
    expect(t.weeks.map((w) => w.start)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
    expect(t.weeks[1]).toEqual({ start: '2026-09-14', end: '2026-09-20', red: 0, yellow: 1, green: 5, paused: 1 });
    expect(t.weeks[3]).toEqual({ start: '2026-09-28', end: '2026-10-04', red: 1, yellow: 2, green: 4, paused: 0 });
    // This week ends today.
    expect(t.weeks[4]).toEqual({ start: '2026-10-05', end: '2026-10-09', red: 1, yellow: 3, green: 3, paused: 0 });
    expect(t.worse).toEqual([
      { id: 'P03', name: 'Nâng cấp ERP', from: 'yellow', to: 'red' },
      { id: 'P04', name: 'Portal nội bộ', from: 'green', to: 'yellow' },
    ]);
    expect(t.better).toEqual([{ id: 'P06', name: 'Chuyển đổi cloud', from: 'red', to: 'yellow' }]);
  });

  it('keeps to the dashboard filters and to what the caller may see', async () => {
    const mine = await json<DashboardTrend>('/dashboard/trend?scope=mine', 'son'); // GL of P03, P04
    expect(mine.weeks.at(-1)).toMatchObject({ red: 1, yellow: 1, green: 0 });
    const gl = await json<DashboardTrend>('/dashboard/trend?scope=all&gl=tuan@example.com', 'lan'); // P05, P06
    expect(gl.weeks.at(-1)).toMatchObject({ red: 0, yellow: 1, green: 1 });
    const other = await json<DashboardTrend>('/dashboard/trend?scope=all', 'quang'); // P03, P06
    expect(other.weeks.at(-1)).toMatchObject({ red: 1, yellow: 1, green: 0 });
    expect(other.worse.map((c) => c.id)).toEqual(['P03']);
    expect(other.better.map((c) => c.id)).toEqual(['P06']);
  });

  it('a project closed this week still counts in the weeks it ran', async () => {
    await editProject('P07', { state: 'closed' });
    await runHourly({ store, send }, at('2026-10-09 23:00'));
    const t = await json<DashboardTrend>('/dashboard/trend?scope=all', 'lan');
    // Not recorded today, but its row of yesterday is still this week's last mark.
    expect(t.weeks.at(-1)).toMatchObject({ green: 3 });
    expect(t.weeks[3]).toMatchObject({ green: 4 });
  });

  it('empty before the first recorded day', async () => {
    store.healthDays.clear();
    expect(await json<DashboardTrend>('/dashboard/trend', 'lan')).toEqual({ weeks: [], worse: [], better: [] });
  });
});

describe('end date', () => {
  type Dash = {
    kpis: { pastEnd: number };
    attention: { id: string; daysPastEnd: number }[];
    endingSoon: { id: string; daysLeft: number; endDate: string }[];
  };

  it('a running project past its end date is flagged (colour unchanged); paused ones are not', async () => {
    await editProject('P01', { endDate: '2026-10-06' });
    await editProject('P05', { endDate: '2026-10-01', state: 'paused' });
    const d = await json<Dash>('/dashboard?scope=all', 'lan');
    expect(d.kpis.pastEnd).toBe(1);
    expect(d.attention.find((p) => p.id === 'P01')).toMatchObject({ daysPastEnd: 3 });
    const { project } = await json<{ project: { health: string; daysPastEnd: number } }>('/projects/P01', 'lan');
    expect(project).toMatchObject({ health: 'green', daysPastEnd: 3 });
  });

  it('lists the projects ending in the next 14 days, soonest first', async () => {
    await editProject('P07', { endDate: '2026-10-19' });
    await editProject('P02', { endDate: '2026-10-09' });
    await editProject('P01', { endDate: '2026-10-24' }); // 15 days
    const d = await json<Dash>('/dashboard?scope=all', 'lan');
    expect(d.endingSoon.map((p) => [p.id, p.daysLeft])).toEqual([
      ['P02', 0],
      ['P07', 10],
    ]);
  });
});
