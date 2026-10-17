// When a channel (or a person) may receive messages, and the noise control applied at send time.
import { withLang } from '../i18n.js';
import type { ChannelSchedule } from '../types.js';
import type { NotifyDeps } from './deps.js';
import { enqueue, type Outgoing } from './deliver.js';
import { highIssueGroupMessage } from './render.js';

const VN_OFFSET_MS = 7 * 3600_000;

export const vnHour = (now: Date) => (now.getUTCHours() + 7) % 24;
/** Day of the week in Vietnam time: 0 = Sunday … 6 = Saturday. */
export const vnWeekday = (now: Date) => new Date(now.getTime() + VN_OFFSET_MS).getUTCDay();
export const isWeekend = (now: Date) => vnWeekday(now) === 0 || vnWeekday(now) === 6;

interface Timing {
  quietHours?: boolean;
  schedule?: ChannelSchedule;
  pausedUntil?: string;
}

export const DEFAULT_SCHEDULE: Required<ChannelSchedule> = {
  quietFrom: 22,
  quietTo: 7,
  skipWeekends: false,
  digestHour: 8,
  digestDays: 'daily',
  milestoneLeadDays: [1],
};

/**
 * The schedule with defaults filled in. Without `schedule` (channels saved before it existed)
 * this is today's behaviour: quiet 22–7 when `quietHours`, digest at 08:00 every day.
 */
export function resolveSchedule(t: Timing): Required<ChannelSchedule> {
  const s = t.schedule ?? {};
  const quiet = s.quietFrom !== undefined && s.quietTo !== undefined;
  const legacy = t.quietHours ? [DEFAULT_SCHEDULE.quietFrom, DEFAULT_SCHEDULE.quietTo] : [0, 0];
  const lead = [...new Set(s.milestoneLeadDays ?? [])].sort((a, b) => a - b);
  return {
    quietFrom: quiet ? s.quietFrom! : legacy[0],
    quietTo: quiet ? s.quietTo! : legacy[1],
    skipWeekends: s.skipWeekends ?? DEFAULT_SCHEDULE.skipWeekends,
    digestHour: s.digestHour ?? DEFAULT_SCHEDULE.digestHour,
    digestDays: s.digestDays ?? DEFAULT_SCHEDULE.digestDays,
    milestoneLeadDays: lead.length ? lead : [...DEFAULT_SCHEDULE.milestoneLeadDays],
  };
}

/** Whether `hour` falls in [from, to), wrapping midnight when from > to. from = to means never. */
export function inHours(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Hourly alerts are held back during quiet hours and, with skipWeekends, on Saturday / Sunday. */
export function isQuiet(t: Timing, now: Date): boolean {
  const s = resolveSchedule(t);
  return inHours(vnHour(now), s.quietFrom, s.quietTo) || (s.skipWeekends && isWeekend(now));
}

/** The digest goes out in the run of its hour, on its days (daily / weekdays / Monday only). */
export function digestDue(t: Timing, now: Date): boolean {
  const s = resolveSchedule(t);
  if (vnHour(now) !== s.digestHour) return false;
  if (s.digestDays === 'monday') return vnWeekday(now) === 1;
  if (s.digestDays === 'weekdays' || s.skipWeekends) return !isWeekend(now);
  return true;
}

/** The Monday digest compares with the previous week instead of summarising the day. */
export const isWeeklyDigest = (t: Timing) => resolveSchedule(t).digestDays === 'monday';

/** Nothing is sent before `pausedUntil`. */
export function isPaused(t: Timing, now: Date): boolean {
  return !!t.pausedUntil && Date.parse(t.pausedUntil) > now.getTime();
}

// ---------- Noise control at send time (deliver.send calls hold) ----------

/** High-priority issues wait this long so a burst becomes one message. */
export const BURST_MS = 2 * 60_000;
/** Event of a high-priority issue waiting in the outbox for others to join it. */
export const BURST_HELD_EVENT = 'high_issue_held';
/** Event of a merged burst (never held or merged again, e.g. when retried). */
export const BURST_GROUP_EVENT = 'high_issue_group';
/** A project that turns red again within this window is not announced again. */
export const FLAP_MS = 6 * 3600_000;
const FLAP_SLOT_MS = 15 * 60_000;

/** De-duplication keys of the 15-minute slots covering the last FLAP_MS (current slot first). */
export function flapKeys(channelId: string, projectId: string, now: Date): string[] {
  const slot = Math.floor(now.getTime() / FLAP_SLOT_MS);
  return Array.from({ length: FLAP_MS / FLAP_SLOT_MS }, (_, i) => `${channelId}#red#${projectId}#${slot - i}`);
}

/**
 * Runs before every delivery (first attempts and retries). Returns the message to send now, or
 * undefined when it was held (queued for grouping) or dropped (flapping). Retries (`attempts`)
 * pass through unchanged, so the retry / auto-pause handling in deliver.ts applies to them.
 * - A new high-priority issue to a channel is queued for BURST_MS as `high_issue_held`. When the
 *   outbox delivers it, the other due held issues of the same channel are claimed and merged
 *   into one `high_issue_group` message (a lone issue goes out as plain `high_issue`).
 * - A channel is told a project turned red only if it was not told so in the last FLAP_MS. The
 *   alert counts from its first attempt; a failed one is retried by deliver.ts.
 */
export async function hold(deps: NotifyDeps, o: Outgoing, now: Date): Promise<Outgoing | undefined> {
  if (!('channelId' in o.target) || o.attempts) return o;
  const channelId = o.target.channelId;

  if (o.event === 'high_issue') {
    await enqueue(deps, { ...o, event: BURST_HELD_EVENT }, now, new Date(now.getTime() + BURST_MS));
    return undefined;
  }

  if (o.event === BURST_HELD_EVENT) {
    const due = (await deps.store.listDue(now, 50)).filter(
      (e) => e.event === BURST_HELD_EVENT && 'channelId' in e.target && e.target.channelId === channelId,
    );
    const merged: Outgoing[] = [];
    for (const e of due) if (await deps.store.claimOutbox(e)) merged.push({ ...e });
    if (!merged.length) return { ...o, event: 'high_issue' };
    const all = [o, ...merged];
    const projects = new Set(all.map((x) => x.projectId));
    const ch = o.channel ?? (await deps.store.getChannel(channelId));
    return {
      ...o,
      event: BURST_GROUP_EVENT,
      projectId: projects.size === 1 ? o.projectId : undefined,
      sentKeys: undefined,
      message: withLang(ch?.lang, () => highIssueGroupMessage(deps, all)),
    };
  }

  if (o.event === 'became_red' && o.projectId) {
    const keys = flapKeys(channelId, o.projectId, now);
    const seen = await Promise.all(keys.map((k) => deps.store.hasSent(k)));
    if (seen.some(Boolean)) return undefined;
    await deps.store.markSent(keys[0], 1);
  }
  return o;
}
