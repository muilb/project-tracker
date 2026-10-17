// Which group channels get which message. Track F owns the visibility check, track D the timing.
import { can } from '../auth.js';
import { withLang } from '../i18n.js';
import type { ProjectView } from '../rules.js';
import { vnDate } from '../time.js';
import type { AlertEvent, Channel, Item, Project, User } from '../types.js';
import type { NotifyDeps } from './deps.js';
import { collectAlerts, type NotifyEvent, type Pending } from './events.js';
import type { Outgoing } from './deliver.js';
import { digestDue, isPaused, isQuiet } from './policy.js';
import { becameRedMessage, DEDUPE_DAYS, digestMessage, highIssueMessage, hourlyMessage } from './render.js';

export interface RouteContext {
  users: Map<string, User>;
  name: (id?: string) => string;
}

export function inScope(ch: Channel, p: Pick<Project, 'id' | 'gl'>): boolean {
  if (ch.scope.type === 'gl') return !!ch.scope.gl && p.gl === ch.scope.gl;
  if (ch.scope.type === 'projects') return (ch.scope.projects ?? []).includes(p.id);
  return true;
}

/**
 * A channel only carries projects its creator may see (`can.viewProject`), checked at send time.
 * Item ownership is judged from the items at hand: a view's open items, or the saved item.
 * A creator without a user record keeps today's behaviour (only PMO / managers see such channels).
 */
export function creatorSees(ch: Channel, p: Project | ProjectView, users: Map<string, User>, items?: Item[]): boolean {
  const owner = users.get(ch.createdBy);
  return !owner || can.viewProject(owner, p, items);
}

export function wants(ch: Channel, event: AlertEvent, now: Date, p?: Project | ProjectView, ctx?: RouteContext, items?: Item[]) {
  return (
    ch.enabled &&
    !isPaused(ch, now) &&
    ch.events.includes(event) &&
    (!p || (inScope(ch, p) && (!ctx || creatorSees(ch, p, ctx.users, items))))
  );
}

const toChannel = (ch: Channel, event: string, message: Outgoing['message'], projectId?: string): Outgoing => ({
  target: { channelId: ch.id },
  channel: ch,
  event,
  message,
  projectId,
});

/** Immediate alerts for one saved change. */
export function channelMessages(deps: NotifyDeps, event: NotifyEvent, channels: Channel[], now: Date, ctx: RouteContext): Outgoing[] {
  if (event.project.state !== 'active') return [];
  if (event.type === 'update_posted') {
    const { after, before, update, project } = event;
    if (after.health !== 'red' || before.health === 'red') return [];
    return channels
      .filter((c) => wants(c, 'became_red', now, after, ctx))
      .map((c) => withLang(c.lang, () => toChannel(c, 'became_red', becameRedMessage(deps, after, update, ctx.name), project.id)));
  }
  const { item, previous, project } = event;
  if (previous || item.type !== 'issue' || item.priority !== 'high' || item.status === 'done') return [];
  return channels
    .filter((c) => wants(c, 'high_issue', now, project, ctx, [item]))
    .map((c) => withLang(c.lang, () => toChannel(c, 'high_issue', highIssueMessage(deps, project, item, ctx.name), project.id)));
}

/** One channel's hourly alerts (batched into one message) and its daily digest. */
export async function hourlyChannelMessages(
  deps: NotifyDeps,
  ch: Channel,
  views: ProjectView[],
  now: Date,
  ctx: RouteContext,
): Promise<Outgoing[]> {
  if (!ch.enabled || isPaused(ch, now)) return [];
  const out: Outgoing[] = [];
  const scoped = views.filter((v) => inScope(ch, v) && creatorSees(ch, v, ctx.users));

  if (!isQuiet(ch, now)) {
    const pending: Pending[] = [];
    for (const p of collectAlerts(ch, scoped, now, ctx.name)) {
      if (!(await deps.store.hasSent(`${ch.id}#${p.key}`))) pending.push(p);
    }
    if (pending.length)
      out.push({
        ...toChannel(ch, 'hourly', hourlyMessage(deps, pending)),
        // Marked as sent only after a successful delivery, so failures are retried next hour.
        sentKeys: pending.map((p) => ({ key: `${ch.id}#${p.key}`, ttlDays: DEDUPE_DAYS })),
      });
  }

  const digestKey = `${ch.id}#digest#${vnDate(now)}`;
  if (wants(ch, 'daily_digest', now) && digestDue(ch, now) && scoped.length && !(await deps.store.hasSent(digestKey))) {
    out.push({
      ...toChannel(ch, 'daily_digest', digestMessage(deps, ch, scoped, now, ctx.name)),
      sentKeys: [{ key: digestKey, ttlDays: 2 }],
    });
  }
  return out;
}
