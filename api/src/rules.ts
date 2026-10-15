// Business rules carried over from the original Excel tracker (sheet "Hướng dẫn").
import type { Health, Item, Project, Settings, Update, Urgency } from './types.js';
import { addHours, daysUntil } from './time.js';

const HEALTH_RANK: Record<Health, number> = { green: 0, yellow: 1, red: 2 };
const URGENCY_RANK: Record<Urgency, number> = { normal: 0, attention: 1, critical: 2 };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function worstHealth(...hs: (Health | undefined)[]): Health {
  return hs.reduce<Health>((w, h) => (h && HEALTH_RANK[h] > HEALTH_RANK[w] ? h : w), 'green');
}

export interface ItemView extends Item {
  daysLeft: number;
  closed: boolean;
  overdue: boolean;
  soon: boolean;
}

export interface ProjectView extends Project {
  declaredHealth?: Health; // latest status from PL / GL / supporter
  pmoHealth?: Health; // latest PMO assessment
  health: Health; // worst of declared, PMO, and "has overdue items" (min yellow)
  latestUpdate?: Update;
  lastOwnerUpdate?: Update;
  managerComment?: Update;
  frequencyHours: number;
  dueAt: string;
  lateHours: number; // 0 when the update is not late
  openItems: ItemView[];
  nextItem?: ItemView; // next open event/milestone
  openIssues: number;
  highIssues: number;
  overdueItems: number;
  urgency: Urgency;
}

export function toItemView(item: Item, now: Date, settings: Settings): ItemView {
  const daysLeft = daysUntil(item.date, now);
  const closed = item.status === 'done' || item.status === 'postponed';
  return {
    ...item,
    daysLeft,
    closed,
    overdue: !closed && daysLeft < 0,
    soon: !closed && daysLeft >= 0 && daysLeft <= settings.soonDays,
  };
}

/** Updates by the project's PL, GL or supporters reset the update deadline. */
export function isOwnerUpdate(p: Project, u: Update): boolean {
  return u.author === p.pl || u.author === p.gl || p.supporters.includes(u.author);
}

export function compareItems(a: ItemView, b: ItemView): number {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    a.date.localeCompare(b.date) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  );
}

export function buildProjectView(
  project: Project,
  updates: Update[],
  items: Item[],
  settings: Settings,
  now: Date,
): ProjectView {
  const sorted = updates.filter((u) => u.projectId === project.id).sort((a, b) => b.at.localeCompare(a.at));
  const owner = sorted.filter((u) => isOwnerUpdate(project, u));
  const lastOwnerUpdate = owner[0];
  const declaredHealth = owner.find((u) => u.health)?.health;
  const pmoHealth = sorted.find((u) => u.authorRole === 'PMO' && u.health && !isOwnerUpdate(project, u))?.health;
  const managerComment = sorted.find((u) => u.authorRole === 'MNG' || u.authorRole === 'SUBMNG');

  const openItems = items
    .filter((i) => i.projectId === project.id)
    .map((i) => toItemView(i, now, settings))
    .filter((i) => !i.closed)
    .sort(compareItems);
  const overdueItems = openItems.filter((i) => i.overdue).length;
  const openIssues = openItems.filter((i) => i.type === 'issue');
  const highIssues = openIssues.filter((i) => i.priority === 'high').length;
  const nextItem = openItems
    .filter((i) => i.type !== 'issue' && i.daysLeft >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const health = worstHealth(declaredHealth, pmoHealth, overdueItems > 0 ? 'yellow' : undefined);

  const nearEvent = nextItem !== undefined && nextItem.daysLeft <= settings.soonDays;
  const frequencyHours =
    project.updateFrequencyHours ??
    Math.min(settings.frequencyHours[health], nearEvent ? settings.nearEventFrequencyHours : Infinity);
  const dueAt = addHours(lastOwnerUpdate?.at ?? project.createdAt, frequencyHours);
  const lateMs = now.getTime() - Date.parse(dueAt);
  const lateHours = lateMs > 0 ? Math.round(lateMs / 360_000) / 10 : 0;

  let urgency: Urgency = 'normal';
  if (health === 'red' || openIssues.some((i) => i.priority === 'high' && i.overdue)) urgency = 'critical';
  else if (
    health === 'yellow' ||
    overdueItems > 0 ||
    openItems.some((i) => i.type !== 'issue' && i.priority === 'high' && i.soon)
  )
    urgency = 'attention';

  return {
    ...project,
    declaredHealth,
    pmoHealth,
    health,
    latestUpdate: sorted[0],
    lastOwnerUpdate,
    managerComment,
    frequencyHours,
    dueAt,
    lateHours,
    openItems,
    nextItem,
    openIssues: openIssues.length,
    highIssues,
    overdueItems,
    urgency,
  };
}

/** Most severe first: urgency, health, overdue items, lateness. */
export function compareProjects(a: ProjectView, b: ProjectView): number {
  return (
    URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] ||
    HEALTH_RANK[b.health] - HEALTH_RANK[a.health] ||
    b.overdueItems - a.overdueItems ||
    b.lateHours - a.lateHours ||
    a.id.localeCompare(b.id)
  );
}
