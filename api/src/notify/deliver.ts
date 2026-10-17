// Sends messages and records the outcome: delivery log, retries with backoff, auto-pause of failing channels.
import { randomUUID } from 'node:crypto';
import { audit } from '../audit.js';
import { l, withLang } from '../i18n.js';
import type { Channel, OutboxEntry, OutboxTarget } from '../types.js';
import type { NotifyDeps } from './deps.js';
import { isPermanent, PermanentDeliveryError, scrubError } from './errors.js';
import type { Message } from './message.js';
import { hold } from './policy.js';
import { pushTo } from './push.js';

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
  /** Failed attempts so far (set by flushDue for retries). */
  attempts?: number;
}

/** Minutes to wait before retry n (1st, 2nd, …); the last value repeats. */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60];
/** Attempts per message, the first (direct) one included. */
export const MAX_ATTEMPTS = 6;
/** Consecutive lost messages after which a group channel is switched off. */
export const AUTO_PAUSE_FAILURES = 5;

const newId = () => randomUUID().slice(0, 8);

type Failure = { ok: false; error: string; permanent: boolean };
type Attempt = { ok: true } | Failure;

const failure = (e: unknown): Failure => ({
  ok: false,
  error: scrubError((e as Error).message ?? String(e)).slice(0, 300),
  permanent: isPermanent(e),
});

/** Sends one message to a group channel and records the outcome on the channel and in its log. */
async function attemptChannel(deps: NotifyDeps, ch: Channel, msg: Message, now: Date, event: string): Promise<Attempt> {
  const log = (ok: boolean, error?: string) =>
    deps.store
      .addDeliveryLog({ channelId: ch.id, id: newId(), at: now.toISOString(), ok, event, title: msg.title, error })
      .catch((e) => console.error('delivery log failed', e));
  try {
    // The sender may update the channel in place (Telegram group migrated to a new chat id).
    await deps.send(ch, msg);
    await deps.store.putChannel({ ...ch, lastSentAt: now.toISOString(), lastError: undefined, failCount: 0 });
    await log(true);
    return { ok: true };
  } catch (e) {
    const result = failure(e);
    console.error(`Delivery failed for ${ch.kind} channel ${ch.id}: ${result.error}`);
    await deps.store.putChannel({ ...ch, lastError: result.error });
    await log(false, result.error);
    return result;
  }
}

/** Sends one message to a group channel now (no retry); true when it arrived. Used by "Send test". */
export async function deliver(deps: NotifyDeps, ch: Channel, msg: Message, now: Date, event = 'test'): Promise<boolean> {
  return (await attemptChannel(deps, ch, msg, now, event)).ok;
}

/** Personal delivery: the web inbox, the person's linked Telegram chat, or one of their browsers / phones. */
async function deliverPersonal(deps: NotifyDeps, target: Extract<OutboxTarget, { userId: string }>, o: Outgoing, now: Date) {
  const { userId, via } = target;
  // track H: Web Push to one subscription (send() fans a message out to every device first).
  if (via === 'push') {
    const sub = target.subscriptionId ? await deps.store.getPushSubscription(userId, target.subscriptionId) : undefined;
    if (!sub) throw new PermanentDeliveryError('Push subscription removed');
    await pushTo(deps, sub, o.message, now, o.event, o.projectId);
    return;
  }
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

/**
 * A message to a group channel is lost (permanent error, retries used up, or an hourly message):
 * after AUTO_PAUSE_FAILURES in a row the channel is switched off and its owner told in their inbox.
 */
async function countLoss(deps: NotifyDeps, channelId: string, error: string, now: Date) {
  const ch = await deps.store.getChannel(channelId);
  if (!ch) return;
  const failCount = (ch.failCount ?? 0) + 1;
  if (failCount < AUTO_PAUSE_FAILURES || !ch.enabled) {
    await deps.store.putChannel({ ...ch, failCount });
    return;
  }
  await deps.store.putChannel({ ...ch, failCount, enabled: false, autoPausedAt: now.toISOString() });
  await audit(deps.store, now, 'system', 'channel_auto_pause', ch.id, `${ch.name}: ${error}`.slice(0, 300));
  const owner = await deps.store.getNotifyPrefs(ch.createdBy).catch(() => undefined);
  await withLang(owner?.lang ?? ch.lang, () =>
    deps.store.addInbox({
      userId: ch.createdBy,
      id: newId(),
      at: now.toISOString(),
      event: 'channel_auto_pause',
      title: l(
        `▲ Kênh "${ch.name}" đã tự tắt sau ${failCount} lần gửi lỗi liên tiếp`,
        `▲ チャネル「${ch.name}」は ${failCount} 回連続で送信に失敗したため自動的に無効になりました`,
      ),
      lines: [
        { text: `${l('Lỗi gần nhất', '直近のエラー')}: ${error}` },
        {
          text: l(
            'Sửa kênh (URL webhook / nhóm Telegram), bấm Gửi thử, rồi bật lại kênh.',
            'チャネルを修正し（Webhook URL / Telegram グループ）、テスト送信してから再度有効にしてください。',
          ),
          subtle: true,
        },
      ],
      link: deps.webUrl ? { title: l('Mở trang kênh', 'チャネル画面を開く'), url: `${deps.webUrl}/channels` } : undefined,
    }),
  ).catch((e) => console.error('auto-pause notice failed', e));
}

/**
 * Delivers one message now; true when it arrived. On failure the message is queued for a retry
 * (1 → 5 → 15 → 60 min, MAX_ATTEMPTS in all), except permanent errors and hourly messages
 * (with `sentKeys`): the next hourly run rebuilds those, so queueing them would send twice.
 */
export async function send(deps: NotifyDeps, o: Outgoing, now: Date): Promise<boolean> {
  // track D: burst grouping and anti-flapping; undefined = held in the outbox or dropped.
  const next = await hold(deps, o, now);
  if (!next) return true;
  o = next;
  // track H: one delivery per browser / phone, so a retry goes only to the device that failed.
  if ('via' in o.target && o.target.via === 'push' && !o.target.subscriptionId) {
    const { userId } = o.target;
    const subs = await deps.store.listPushSubscriptions(userId);
    const results = await Promise.all(subs.map((s) => send(deps, { ...o, target: { userId, via: 'push', subscriptionId: s.id } }, now)));
    return results.some(Boolean);
  }
  let result: Attempt;
  if ('channelId' in o.target) {
    const ch = o.channel ?? (await deps.store.getChannel(o.target.channelId));
    if (!ch) return false;
    result = await attemptChannel(deps, ch, o.message, now, o.event);
  } else {
    try {
      await deliverPersonal(deps, o.target, o, now);
      result = { ok: true };
    } catch (e) {
      result = failure(e);
      console.error(`Personal delivery failed (${o.target.via}) for ${o.target.userId}: ${result.error}`);
    }
  }
  if (result.ok) {
    if (o.sentKeys) await Promise.all(o.sentKeys.map((k) => deps.store.markSent(k.key, k.ttlDays)));
    return true;
  }
  const attempts = (o.attempts ?? 0) + 1;
  if (!result.permanent && !o.sentKeys && attempts < MAX_ATTEMPTS) {
    const wait = RETRY_BACKOFF_MINUTES[Math.min(attempts, RETRY_BACKOFF_MINUTES.length) - 1];
    await enqueue(deps, o, now, new Date(now.getTime() + wait * 60_000), attempts, result.error).catch((e) =>
      console.error('retry enqueue failed', e),
    );
  } else if ('channelId' in o.target) {
    await countLoss(deps, o.target.channelId, result.error, now);
  }
  return false;
}

/** Puts a message in the outbox, to be sent by flushDue at `dueAt` (delays, grouping, retries). */
export async function enqueue(deps: NotifyDeps, o: Outgoing, now: Date, dueAt: Date, attempts = 0, lastError?: string) {
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
    lastError,
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
    let channel: Channel | undefined;
    if ('channelId' in entry.target) {
      channel = await deps.store.getChannel(entry.target.channelId);
      // Deleted or switched off (by hand or auto-pause) since it was queued: drop it.
      if (!channel?.enabled) continue;
    }
    const ok = await send(
      deps,
      {
        target: entry.target,
        channel,
        event: entry.event,
        message: entry.message,
        projectId: entry.projectId,
        sentKeys: entry.sentKeys,
        attempts: entry.attempts,
      },
      now,
    );
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
