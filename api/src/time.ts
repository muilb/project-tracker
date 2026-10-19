// All "calendar day" logic uses Vietnam time (UTC+7, no DST).
const VN_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD of `now` in Vietnam time. */
export function vnDate(now: Date): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole days from Vietnam "today" to `date` (YYYY-MM-DD). Negative = in the past. */
export function daysUntil(date: string, now: Date): number {
  return Math.round((Date.parse(date) - Date.parse(vnDate(now))) / DAY_MS);
}

/** Converts a Vietnam local time like "2026-10-08 08:30" to an ISO UTC string. */
export function vnToIso(local: string): string {
  return new Date(Date.parse(local.replace(' ', 'T') + ':00Z') - VN_OFFSET_MS).toISOString();
}

export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3600_000).toISOString();
}

export function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** "YYYY-MM-DD HH:mm" in Vietnam time, for messages and exports. */
export function vnDateTime(iso: string): string {
  return new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** The YYYY-MM-DD `days` after `date` (before, when negative). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the week of `date` (YYYY-MM-DD). */
export function weekStart(date: string): string {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}
