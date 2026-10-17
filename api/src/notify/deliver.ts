// Sends messages and records the outcome. Track C adds retries and auto-pause.
import { randomUUID } from 'node:crypto';
import type { Channel, OutboxEntry, OutboxTarget } from '../types.js';
import type { NotifyDeps } from './deps.js';
import type { Message } from './message.js';
import { hold } from './policy.js';

/** A message ready to go: built in the recipient's language, not yet delivered. */
export interface Outgoing {
  target: OutboxTarget;
  /** The channel when the target is a group channel (avoids reloading it). */
  channel?: Channel;
  event: string;
  message: Message;
  projectId?: string;
  /** Recorded with markSent once delivered (hourly de-duplication). */
  sentKeys?: { key: string; ttlDays: number }[];
}

const newId = () => randomUUID().slice(0, 8);

/** Sends one message to a group channel and records the outcome on the channel and in its log. */
export async function deliver(deps: NotifyDeps, ch: Channel, msg: Message, now: Date, event = 'test'): Promise<boolean> {
  const log = (ok: boolean, error?: string) =>
    deps.store
      .addDeliveryLog({ channelId: ch.id, id: newId(), at: now.toISOString(), ok, event, title: msg.title, error })
      .catch((e) => console.error('delivery log failed', e));
  try {
    await deps.send(ch, msg);
    await deps.store.putChannel({ ...ch, lastSentAt: now.toISOString(), lastError: undefined });
    await log(true);
    return true;
  } catch (e) {
    console.error(`Delivery failed for ${ch.kind} channel ${ch.id}`, e);
    const error = (e as Error).message.slice(0, 300);
    await deps.store.putChannel({ ...ch, lastError: error });
    await log(false, error);
    return false;
  }
}

/** Personal delivery: the web inbox, or the person's linked Telegram chat. */
async function deliverPersonal(deps: NotifyDeps, userId: string, via: 'inbox' | 'telegram', o: Outgoing, now: Date) {
  if (via === 'inbox') {
    await deps.store.addInbox({
      userId,
      id: newId(),
      at: now.toISOString(),
      event: o.event,
      title: o.message.title,
      lines: o.message.lines,
      link: o.message.link,
      projectId: o.projectId,
    });
    return;
  }
  const prefs = await deps.store.getNotifyPrefs(userId);
  if (!prefs?.telegramChatId) throw new Error('No personal Telegram chat linked');
  // The sender only needs the kind and chat id of a personal "channel".
  const chat = { id: `U:${userId}`, kind: 'telegram', telegramChatId: prefs.telegramChatId } as Channel;
  await deps.send(chat, o.message);
}

/** Delivers one message now; true when it arrived. */
export async function send(deps: NotifyDeps, o: Outgoing, now: Date): Promise<boolean> {
  // track D: burst grouping and anti-flapping; undefined = held in the outbox or dropped.
  const next = await hold(deps, o, now);
  if (!next) return true;
  o = next;
  let ok: boolean;
  if ('channelId' in o.target) {
    const ch = o.channel ?? (await deps.store.getChannel(o.target.channelId));
    if (!ch) return false;
    ok = await deliver(deps, ch, o.message, now, o.event);
  } else {
    try {
      await deliverPersonal(deps, o.target.userId, o.target.via, o, now);
      ok = true;
    } catch (e) {
      console.error(`Personal delivery failed (${o.target.via}) for ${o.target.userId}`, e);
      ok = false;
    }
  }
  if (ok && o.sentKeys) await Promise.all(o.sentKeys.map((k) => deps.store.markSent(k.key, k.ttlDays)));
  // track C: on failure, enqueue a retry (backoff) instead of dropping the message.
  return ok;
}

/** Puts a message in the outbox, to be sent by flushDue at `dueAt` (delays, grouping, retries). */
export async function enqueue(deps: NotifyDeps, o: Outgoing, now: Date, dueAt: Date, attempts = 0) {
  const entry: OutboxEntry = {
    id: newId(),
    dueAt: dueAt.toISOString(),
    createdAt: now.toISOString(),
    target: o.target,
    event: o.event,
    message: o.message,
    projectId: o.projectId,
    sentKeys: o.sentKeys,
    attempts,
  };
  await deps.store.enqueue(entry);
  return entry;
}

/** Runs every minute: sends what is due in the outbox, each entry once. */
export async function flushDue(deps: NotifyDeps, now: Date, limit = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const entry of await deps.store.listDue(now, limit)) {
    if (!(await deps.store.claimOutbox(entry))) continue;
    const ok = await send(
      deps,
      { target: entry.target, event: entry.event, message: entry.message, projectId: entry.projectId, sentKeys: entry.sentKeys },
      now,
    );
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
