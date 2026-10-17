// Which people get a personal message (web inbox, personal Telegram).
import { can } from '../auth.js';
import { withLang } from '../i18n.js';
import type { ProjectView } from '../rules.js';
import type { Snapshot } from '../store/store.js';
import type { NotifyPrefs, PersonalEvent, Project } from '../types.js';
import type { NotifyDeps } from './deps.js';
import type { Outgoing } from './deliver.js';
import { collectPersonal, type NotifyEvent, type PersonalPending } from './events.js';
import type { Message } from './message.js';
import { allPrefs, itemMessage, remindersMessage, timing, updateMessage, watches } from './personal.js';
import { isPaused, isQuiet, vnHour } from './policy.js';
import { DEDUPE_DAYS } from './render.js';
import { closeAction, reminderActions } from '../bot/actions.js';
import type { RouteContext } from './routeChannels.js';

/** De-duplication key of a personal message. */
export const personalKey = (userId: string, rest: string) => `P#${userId}#${rest}`;

// track G: "Snooze 1 day" under a Telegram reminder.
/** What a reminder is about, without its time: `my_item_due#I0015`, `late_update_mine#P03`. */
export const reminderSubject = (key: string) => key.split('#').slice(0, 2).join('#');
/** Set (for a day) by the snooze button; the hourly run skips the subject meanwhile. */
export const snoozeKey = (userId: string, subject: string) => personalKey(userId, `snooze#${subject}`);
/** At most this many "Close" buttons under one reminder. */
const MAX_CLOSE_BUTTONS = 3;

/**
 * The inbox always receives; the linked Telegram chat too when switched on and outside quiet
 * hours (`telegramNow` false holds Telegram back for immediate messages).
 */
function toPerson(
  prefs: NotifyPrefs,
  event: string,
  message: Message,
  projectId: string | undefined,
  keys: string[],
  telegramNow: boolean,
) {
  const sentKeys = keys.map((key) => ({ key, ttlDays: DEDUPE_DAYS }));
  const out: Outgoing[] = [{ target: { userId: prefs.userId, via: 'inbox' }, event, message, projectId, sentKeys }];
  if (telegramNow && prefs.telegram && prefs.telegramChatId)
    out.push({ target: { userId: prefs.userId, via: 'telegram' }, event, message, projectId, sentKeys });
  return out;
}

/** Recipient → the events they would get this change for, most important first. */
function candidates(event: NotifyEvent, prefs: Map<string, NotifyPrefs>): Map<string, PersonalEvent[]> {
  const out = new Map<string, PersonalEvent[]>();
  const add = (ids: (string | undefined)[], e: PersonalEvent) => {
    for (const id of ids) if (id) out.set(id, [...(out.get(id) ?? []), e]);
  };
  const { project } = event;
  const watchers = [...prefs.values()].filter((p) => watches(p, project.id)).map((p) => p.userId);
  if (event.type === 'update_posted') {
    if (project.state !== 'active') return out;
    const { before, after, update } = event;
    if (after.health === 'red' && before.health !== 'red') add(watchers, 'watched_red');
    if (after.health !== before.health) add([project.gl, project.pl, ...watchers], 'health_changed');
    if (update.needHelp?.trim()) add([project.gl, project.pmo], 'need_help');
    return out;
  }
  const { item, previous } = event;
  const closed = item.status === 'done' || item.status === 'postponed';
  if (item.owner && item.owner !== previous?.owner && !closed) add([item.owner], 'assigned_to_me');
  if (project.state === 'active' && !previous && item.type === 'issue' && item.priority === 'high' && !closed)
    add(watchers, 'watched_high_issue');
  return out;
}

/** Whether `userId` may get a personal message about `project` at all. */
function reachable(userId: string, project: Project, prefs: NotifyPrefs | undefined, now: Date, ctx: RouteContext): prefs is NotifyPrefs {
  const user = ctx.users.get(userId);
  return !!user && !!prefs && can.viewProject(user, project) && !isPaused(timing(prefs), now);
}

/** Personal messages for one saved change. Never to the person who made it. */
export async function personalMessages(deps: NotifyDeps, event: NotifyEvent, now: Date, ctx: RouteContext): Promise<Outgoing[]> {
  const prefs = await allPrefs(deps.store, ctx.users.values(), now);
  const out: Outgoing[] = [];
  const ref = event.type === 'update_posted' ? `update#${event.update.id}` : `item#${event.item.id}#${event.item.updatedAt}`;
  for (const [userId, all] of candidates(event, prefs)) {
    const p = prefs.get(userId);
    if (userId === event.actor || !reachable(userId, event.project, p, now, ctx)) continue;
    const reasons = [...new Set(all)].filter((e) => p.events.includes(e));
    if (!reasons.length) continue;
    const key = personalKey(userId, `${reasons[0]}#${ref}`);
    if (await deps.store.hasSent(key)) continue;
    const message = withLang(p.lang, () =>
      event.type === 'update_posted'
        ? updateMessage(deps, event.project, event.update, event.before, event.after, reasons, ctx.name)
        : itemMessage(deps, event.project, event.item, reasons, event.actor, ctx.name),
    );
    if (event.type === 'item_saved' && reasons[0] === 'assigned_to_me')
      message.actions = withLang(p.lang, () => [closeAction(event.project.id, event.item.id)]);
    out.push(...toPerson(p, reasons[0], message, event.project.id, [key], !isQuiet(timing(p), now)));
  }
  return out;
}

/**
 * Personal time-based messages from the hourly run: one batched message per person. During a
 * person's quiet hours nothing is sent (not marked as sent either), so it arrives after them.
 */
export async function hourlyPersonalMessages(
  deps: NotifyDeps,
  snap: Snapshot,
  views: ProjectView[],
  now: Date,
  ctx: RouteContext,
): Promise<Outgoing[]> {
  const pending = collectPersonal(views, now, ctx.name);
  if (!pending.length) return [];
  const prefs = await allPrefs(deps.store, snap.users, now);
  const byUser = new Map<string, PersonalPending[]>();
  for (const x of pending) byUser.set(x.userId, [...(byUser.get(x.userId) ?? []), x]);

  const out: Outgoing[] = [];
  for (const [userId, list] of byUser) {
    const p = prefs.get(userId);
    if (!p || isQuiet(timing(p), now)) continue;
    // "My items due" once a day, from the digest hour (08:00 by default).
    const itemsTime = vnHour(now) >= (p.schedule?.digestHour ?? 8);
    const mine: (PersonalPending & { fullKey: string })[] = [];
    for (const x of list) {
      if (!p.events.includes(x.event) || (x.event === 'my_item_due' && !itemsTime)) continue;
      if (!reachable(userId, x.project, p, now, ctx)) continue;
      const fullKey = personalKey(userId, x.key);
      if (await deps.store.hasSent(snoozeKey(userId, reminderSubject(x.key)))) continue;
      if (!(await deps.store.hasSent(fullKey))) mine.push({ ...x, fullKey });
    }
    if (!mine.length) continue;
    const events = [...new Set(mine.map((x) => x.event))];
    const projects = [...new Set(mine.map((x) => x.project.id))];
    const message = withLang(p.lang, () =>
      remindersMessage(
        deps,
        mine.map((x) => x.line()),
      ),
    );
    if (p.telegram && p.telegramChatId)
      message.actions = await withLang(p.lang, () =>
        reminderActions(
          deps,
          userId,
          mine.filter((x) => x.event === 'my_item_due' && x.itemId).slice(0, MAX_CLOSE_BUTTONS),
          mine.map((x) => reminderSubject(x.key)),
        ),
      );
    out.push(
      ...toPerson(
        p,
        events.length === 1 ? events[0] : 'reminders',
        message,
        projects.length === 1 ? projects[0] : undefined,
        mine.map((x) => x.fullKey),
        true,
      ),
    );
  }
  return out;
}
