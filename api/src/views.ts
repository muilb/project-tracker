// Read models shared by the internal dashboard, the public dashboard and (later) alerts.
import { buildProjectView, compareItems, compareProjects, type ItemView, type ProjectView } from './rules.js';
import { can, takesPart } from './auth.js';
import type { Snapshot } from './store/store.js';
import { daysUntil } from './time.js';
import type { Project, User } from './types.js';

/** The projects `me` may see (`can.viewProject`); every role but OTHER sees all of them. */
export function visibleProjects(me: User, snap: Pick<Snapshot, 'projects' | 'items'>): Project[] {
  return snap.projects.filter((p) => can.viewProject(me, p, snap.items));
}

/** The snapshot limited to the projects `me` may see, with their updates and items. Users stay. */
export function visibleSnapshot(me: User, snap: Snapshot): Snapshot {
  if (me.role !== 'OTHER') return snap;
  const projects = visibleProjects(me, snap);
  const ids = new Set(projects.map((p) => p.id));
  return {
    ...snap,
    projects,
    updates: snap.updates.filter((u) => ids.has(u.projectId)),
    items: snap.items.filter((i) => ids.has(i.projectId)),
  };
}

export function activeProjectViews(snap: Snapshot, now: Date): ProjectView[] {
  return snap.projects
    .filter((p) => p.state === 'active')
    .map((p) => buildProjectView(p, snap.updates, snap.items, snap.settings, now))
    .sort(compareProjects);
}

function summary(v: ProjectView) {
  return {
    id: v.id,
    name: v.name,
    gl: v.gl,
    pl: v.pl,
    health: v.health,
    urgency: v.urgency,
    latestSummary: v.latestUpdate?.summary,
    needHelp: v.lastOwnerUpdate?.needHelp,
    lastUpdateAt: v.lastOwnerUpdate?.at,
    lastUpdateBy: v.lastOwnerUpdate?.author,
    dueAt: v.dueAt,
    lateHours: v.lateHours,
    overdueItems: v.overdueItems,
    highIssues: v.highIssues,
    daysPastEnd: v.daysPastEnd,
    nextItem: v.nextItem && pickItem(v.nextItem),
  };
}

function pickItem(i: ItemView) {
  return {
    id: i.id,
    projectId: i.projectId,
    type: i.type,
    title: i.title,
    priority: i.priority,
    date: i.date,
    daysLeft: i.daysLeft,
    owner: i.owner,
    status: i.status,
    note: i.note,
    overdue: i.overdue,
  };
}

/** The dashboard lists the projects whose end date is at most this many days ahead. */
export const ENDING_SOON_DAYS = 14;

export interface DashboardFilter {
  scope: 'all' | 'mine';
  gl?: string;
}

export function isInvolved(v: ProjectView, userId: string): boolean {
  return takesPart(v, userId);
}

/** Every project (any state) `me` may see that the dashboard's filters keep: the trend counts these. */
export function dashboardProjects(snap: Snapshot, me: User, filter: DashboardFilter): Project[] {
  return visibleProjects(me, snap).filter(
    (p) => (filter.scope === 'all' || takesPart(p, me.id)) && (!filter.gl || p.gl === filter.gl),
  );
}

/** Only the projects `me` may see, so the KPIs and the GL statistics count those too. */
export function buildDashboard(snap: Snapshot, now: Date, me: User, filter: DashboardFilter) {
  const all = activeProjectViews(visibleSnapshot(me, snap), now);
  const views = all.filter(
    (v) => (filter.scope === 'all' || isInvolved(v, me.id)) && (!filter.gl || v.gl === filter.gl),
  );
  const names = Object.fromEntries(views.map((v) => [v.id, v.name]));
  const openItems = views.flatMap((v) => v.openItems);

  const byGl = new Map<string, { gl: string; red: number; yellow: number; green: number; late: number; total: number }>();
  for (const v of views) {
    const key = v.gl ?? '';
    const row = byGl.get(key) ?? { gl: key, red: 0, yellow: 0, green: 0, late: 0, total: 0 };
    row[v.health]++;
    row.total++;
    if (v.lateHours > 0) row.late++;
    byGl.set(key, row);
  }

  return {
    generatedAt: now.toISOString(),
    filter,
    kpis: {
      active: views.length,
      red: views.filter((v) => v.health === 'red').length,
      yellow: views.filter((v) => v.health === 'yellow').length,
      green: views.filter((v) => v.health === 'green').length,
      critical: views.filter((v) => v.urgency === 'critical').length,
      attention: views.filter((v) => v.urgency === 'attention').length,
      lateUpdates: views.filter((v) => v.lateHours > 0).length,
      highIssues: views.reduce((n, v) => n + v.highIssues, 0),
      overdueItems: views.reduce((n, v) => n + v.overdueItems, 0),
      pastEnd: views.filter((v) => v.daysPastEnd > 0).length,
    },
    // Projects that need a look: not green, late, with overdue items, or running past their end date.
    attention: views
      .filter((v) => v.urgency !== 'normal' || v.lateHours > 0 || v.health !== 'green' || v.daysPastEnd > 0)
      .map(summary),
    endingSoonDays: ENDING_SOON_DAYS,
    endingSoon: views
      .flatMap((v) => {
        const daysLeft = v.endDate === undefined ? -1 : daysUntil(v.endDate, now);
        return daysLeft >= 0 && daysLeft <= ENDING_SOON_DAYS ? [{ id: v.id, name: v.name, health: v.health, endDate: v.endDate!, daysLeft }] : [];
      })
      .sort((a, b) => a.daysLeft - b.daysLeft || a.id.localeCompare(b.id)),
    lateUpdates: views
      .filter((v) => v.lateHours > 0)
      .sort((a, b) => b.lateHours - a.lateHours)
      .map((v) => ({ ...summary(v), supporters: v.supporters, frequencyHours: v.frequencyHours })),
    // Issues to act on: overdue, high priority, or due soon.
    priorityItems: openItems
      .filter((i) => i.type === 'issue' && (i.overdue || i.priority === 'high' || i.soon))
      .sort(compareItems)
      .map((i) => ({ ...pickItem(i), projectName: names[i.projectId] })),
    // Events and milestones coming up (issues are listed in priorityItems).
    upcomingDays: snap.settings.upcomingDays,
    upcoming: openItems
      .filter((i) => i.type !== 'issue' && i.daysLeft >= 0 && i.daysLeft <= snap.settings.upcomingDays)
      .sort((a, b) => a.date.localeCompare(b.date) || compareItems(a, b))
      .map((i) => ({ ...pickItem(i), projectName: names[i.projectId] })),
    byGl: [...byGl.values()].sort((a, b) => a.gl.localeCompare(b.gl)),
  };
}

/** Public dashboard: only whitelisted fields, only events/milestones (never issue text). */
export function buildPublic(snap: Snapshot, now: Date) {
  const views = activeProjectViews(snap, now).filter((v) => v.publicVisible);
  const name = (v: ProjectView) => v.publicName || v.name;
  const names = Object.fromEntries(views.map((v) => [v.id, name(v)]));
  const count = (u: string) => views.filter((v) => v.urgency === u).length;
  return {
    generatedAt: now.toISOString(),
    counts: {
      total: views.length,
      critical: count('critical'),
      attention: count('attention'),
      normal: count('normal'),
    },
    projects: views
      .filter((v) => v.urgency !== 'normal')
      .map((v) => ({
        id: v.id,
        name: name(v),
        urgency: v.urgency,
        health: v.health,
        nextItem: v.nextItem && { date: v.nextItem.date, type: v.nextItem.type, title: v.nextItem.title },
      })),
    upcoming: views
      .flatMap((v) => v.openItems)
      .filter((i) => i.type !== 'issue' && i.daysLeft >= 0 && i.daysLeft <= snap.settings.upcomingDays)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((i) => ({
        date: i.date,
        daysLeft: i.daysLeft,
        projectId: i.projectId,
        projectName: names[i.projectId],
        type: i.type,
        title: i.title,
        priority: i.priority,
      })),
  };
}
