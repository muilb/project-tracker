// When a channel (or a person) may receive messages. Track D extends these rules with `schedule`.
import type { ChannelSchedule } from '../types.js';

export const vnHour = (now: Date) => (now.getUTCHours() + 7) % 24;

interface Timing {
  quietHours?: boolean;
  schedule?: ChannelSchedule;
  pausedUntil?: string;
}

/** Hourly alerts are held back during quiet hours (22:00–07:00 Vietnam time). */
export function isQuiet(t: Timing, now: Date): boolean {
  const hour = vnHour(now);
  return !!t.quietHours && (hour >= 22 || hour < 7);
}

/** The daily digest goes out in the 08:00 run. */
export function digestDue(_t: Timing, now: Date): boolean {
  return vnHour(now) === 8;
}

/** Nothing is sent before `pausedUntil`. */
export function isPaused(t: Timing, now: Date): boolean {
  return !!t.pausedUntil && Date.parse(t.pausedUntil) > now.getTime();
}
