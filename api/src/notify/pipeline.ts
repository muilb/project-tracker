// Entry points: emit() from the routes, runHourly() from the hourly job, flushDue() every minute.
import { withLang } from '../i18n.js';
import { activeProjectViews } from '../views.js';
import type { NotifyDeps } from './deps.js';
import { send, type Outgoing } from './deliver.js';
import type { NotifyEvent } from './events.js';
import { channelMessages, hourlyChannelMessages, type RouteContext } from './routeChannels.js';
import { hourlyPersonalMessages, personalMessages } from './routePersonal.js';
import type { User } from '../types.js';

export { flushDue } from './deliver.js';

function context(users: User[]): RouteContext {
  const byId = new Map(users.map((u) => [u.id, u]));
  return { users: byId, name: (id?: string) => (id ? (byId.get(id)?.name ?? id.split('@')[0]) : '—') };
}

/**
 * Called by the routes after a change is saved. Messages go out right away; a failure is
 * recorded on the channel and never fails the user's change.
 */
export async function emit(deps: NotifyDeps, now: Date, event: NotifyEvent): Promise<void> {
  try {
    const [channels, users] = await Promise.all([deps.store.listChannels(), deps.store.listUsers()]);
    const ctx = context(users);
    const out: Outgoing[] = [...channelMessages(deps, event, channels, now, ctx), ...(await personalMessages(deps, event, now, ctx))];
    await Promise.all(out.map((o) => send(deps, o, now)));
  } catch (e) {
    console.error('notify failed', e);
  }
}

/**
 * Runs every hour: late updates, overdue items and tomorrow's events/milestones
 * (once each, batched into one message per channel), plus the 08:00 daily digest,
 * and the personal time-based messages.
 */
export async function runHourly(deps: NotifyDeps, now: Date): Promise<{ messages: number }> {
  const channels = (await deps.store.listChannels()).filter((c) => c.enabled);
  const snap = await deps.store.snapshot();
  const views = activeProjectViews(snap, now);
  const ctx = context(snap.users);
  let messages = 0;

  for (const ch of channels) {
    const out = await withLang(ch.lang, () => hourlyChannelMessages(deps, ch, views, now, ctx));
    // One channel at a time: deliver() rewrites the channel row with lastSentAt / lastError.
    for (const o of out) if (await send(deps, { ...o, channel: (await deps.store.getChannel(ch.id)) ?? ch }, now)) messages++;
  }
  for (const o of await hourlyPersonalMessages(deps, snap, views, now, ctx)) if (await send(deps, o, now)) messages++;
  return { messages };
}
