const TZ = 'Asia/Ho_Chi_Minh';
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "08/10 08:30" in Vietnam time. */
export function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}

/** "T6 09/10" for a YYYY-MM-DD date. */
export function fmtDay(date?: string, withWeekday = true): string {
  if (!date) return '—';
  const d = new Date(`${date}T00:00:00Z`);
  const dm = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return withWeekday ? `${WEEKDAY[d.getUTCDay()]} ${dm}` : dm;
}

export function fmtDaysLeft(n: number): string {
  if (n < 0) return `Quá hạn ${-n} ngày`;
  if (n === 0) return 'Hôm nay';
  if (n === 1) return 'Ngày mai';
  return `Còn ${n} ngày`;
}

/** 91.2 → "3 ngày 19 giờ" */
export function fmtHours(h: number): string {
  const total = Math.round(h);
  const days = Math.floor(total / 24);
  const hours = total % 24;
  if (days === 0) return `${hours} giờ`;
  return hours ? `${days} ngày ${hours} giờ` : `${days} ngày`;
}

/** YYYY-MM-DD of today in Vietnam time. */
export function todayVN(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
