const TZ = 'Asia/Ho_Chi_Minh';
import { l, lang } from './i18n';

const WEEKDAY = { vi: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], ja: ['日', '月', '火', '水', '木', '金', '土'] };

/** "08/10 08:30" (ja: "10/08 08:30") in Vietnam time. */
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
  const dm = lang === 'ja' ? `${get('month')}/${get('day')}` : `${get('day')}/${get('month')}`;
  return `${dm} ${get('hour')}:${get('minute')}`;
}

/** "T6 09/10" (ja: "10/09(金)") for a YYYY-MM-DD date. */
export function fmtDay(date?: string, withWeekday = true): string {
  if (!date) return '—';
  const wd = WEEKDAY[lang][new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (lang === 'ja') {
    const md = `${date.slice(5, 7)}/${date.slice(8, 10)}`;
    return withWeekday ? `${md}(${wd})` : md;
  }
  const dm = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return withWeekday ? `${wd} ${dm}` : dm;
}

export function fmtDaysLeft(n: number): string {
  if (n < 0) return l(`Quá hạn ${-n} ngày`, `${-n}日超過`);
  if (n === 0) return l('Hôm nay', '今日');
  if (n === 1) return l('Ngày mai', '明日');
  return l(`Còn ${n} ngày`, `残り${n}日`);
}

/** 91.2 → "3 ngày 19 giờ" */
export function fmtHours(h: number): string {
  const total = Math.round(h);
  const days = Math.floor(total / 24);
  const hours = total % 24;
  const [d, hu] = [l(' ngày', '日'), l(' giờ', '時間')];
  if (days === 0) return `${hours}${hu}`;
  return hours ? `${days}${d} ${hours}${hu}` : `${days}${d}`;
}

/** YYYY-MM-DD of today in Vietnam time. */
export function todayVN(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
