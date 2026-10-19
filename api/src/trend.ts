// Health trend: the hourly job writes the colour of every running or paused project for the Vietnam
// day (each run replaces the day's row, so a day keeps its last check), and the project page and the
// dashboard read it back. Nothing is rebuilt from older data: the trend starts when the job first ran.
import { HEALTH_RANK, buildProjectView } from './rules.js';
import type { Snapshot, Store } from './store/store.js';
import { addDays, vnDate, weekStart } from './time.js';
import type { Health, HealthDay, HealthMark, Project } from './types.js';

/** The project page and the dashboard show this many weeks. */
export const TREND_WEEKS = 12;
export const TREND_DAYS = TREND_WEEKS * 7;
/** "Show all" on the project page goes back at most this far. */
export const TREND_MAX_DAYS = 2 * 366;

/** Every running or paused project of `snap` as it is at `now`; closed projects are not recorded. */
export function healthMarks(snap: Snapshot, now: Date): Record<string, HealthMark> {
  const marks: Record<string, HealthMark> = {};
  for (const p of snap.projects) {
    if (p.state === 'closed' || p.deletedAt) continue;
    const v = buildProjectView(p, snap.updates, snap.items, snap.settings, now);
    marks[p.id] = {
      state: p.state,
      health: v.health,
      declaredHealth: v.declaredHealth,
      pmoHealth: v.pmoHealth,
      overdueItems: v.overdueItems,
      lateHours: v.lateHours,
    };
  }
  return marks;
}

/** Writes today's marks; `snap` must hold every project (not one person's view). */
export async function recordHealth(store: Store, snap: Snapshot, now: Date): Promise<HealthDay> {
  const day: HealthDay = { date: vnDate(now), at: now.toISOString(), projects: healthMarks(snap, now) };
  await store.putHealthDay(day);
  return day;
}

export type TrendDay = HealthMark & { date: string };

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

/**
 * One project's recorded days. The window ends today (a closed project: the day it was last changed,
 * i.e. closed) and goes back TREND_DAYS, or TREND_MAX_DAYS with `all`, never before the project's start.
 */
export async function projectTrend(store: Store, p: Project, now: Date, all: boolean) {
  const today = vnDate(now);
  const to = p.state === 'closed' ? min(today, vnDate(new Date(p.updatedAt))) : today;
  const start = p.startDate ?? vnDate(new Date(p.createdAt));
  const from = min(max(start, addDays(to, -((all ? TREND_MAX_DAYS : TREND_DAYS) - 1))), to);
  const rows = await store.listHealthDays(from, to);
  const days: TrendDay[] = rows.flatMap((d) => (d.projects[p.id] ? [{ date: d.date, ...d.projects[p.id] }] : []));
  return {
    from,
    to,
    days,
    // Older days may exist only if the project started earlier and the history already ran on `from`.
    more: !all && from > start && rows[0]?.date === from,
  };
}
export type ProjectTrend = Awaited<ReturnType<typeof projectTrend>>;

/** A project whose colour differs from the end of last week. */
export interface TrendChange {
  id: string;
  name: string;
  from: Health;
  to: Health;
}

/**
 * Weekly counts for the dashboard over `projects` (those the caller may see, after the dashboard's
 * filters): for each week, every project recorded in it counted by its last mark of the week. Weeks
 * before the history started are left out. `worse` / `better`: this week's last mark against last
 * week's, for projects running in both.
 */
export function dashboardTrend(days: HealthDay[], projects: Project[], today: string) {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const lastMarks = (start: string, end: string) => {
    const last = new Map<string, HealthMark>();
    for (const d of days)
      if (d.date >= start && d.date <= end)
        for (const [id, m] of Object.entries(d.projects)) if (names.has(id)) last.set(id, m);
    return last;
  };

  const thisWeek = weekStart(today);
  const weeks: { start: string; end: string; red: number; yellow: number; green: number; paused: number }[] = [];
  for (let w = TREND_WEEKS - 1; w >= 0; w--) {
    const start = addDays(thisWeek, -7 * w);
    const end = min(addDays(start, 6), today);
    const last = lastMarks(start, end);
    if (!last.size && !weeks.length) continue;
    const row = { start, end, red: 0, yellow: 0, green: 0, paused: 0 };
    for (const m of last.values()) {
      if (m.state === 'paused') row.paused++;
      else row[m.health]++;
    }
    weeks.push(row);
  }

  const now = lastMarks(thisWeek, today);
  const before = lastMarks(addDays(thisWeek, -7), addDays(thisWeek, -1));
  const worse: TrendChange[] = [];
  const better: TrendChange[] = [];
  for (const [id, m] of now) {
    const b = before.get(id);
    if (!b || b.state !== 'active' || m.state !== 'active' || b.health === m.health) continue;
    (HEALTH_RANK[m.health] > HEALTH_RANK[b.health] ? worse : better).push({ id, name: names.get(id)!, from: b.health, to: m.health });
  }
  const severeFirst = (a: TrendChange, b: TrendChange) => HEALTH_RANK[b.to] - HEALTH_RANK[a.to] || a.id.localeCompare(b.id);
  return { weeks, worse: worse.sort(severeFirst), better: better.sort((a, b) => a.id.localeCompare(b.id)) };
}
export type DashboardTrend = ReturnType<typeof dashboardTrend>;

/** The rows `dashboardTrend` needs: from the Monday TREND_WEEKS - 1 weeks back to today. */
export function dashboardTrendRange(today: string) {
  return { from: addDays(weekStart(today), -7 * (TREND_WEEKS - 1)), to: today };
}
