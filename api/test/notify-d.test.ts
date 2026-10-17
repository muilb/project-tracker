// Track D: schedules (quiet hours, weekends, digest days, lead days), burst grouping, anti-flapping.
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Message } from '../src/notify/message.js';
import { flushDue, runHourly } from '../src/notify/pipeline.js';
import { digestDue, isPaused, isQuiet, resolveSchedule } from '../src/notify/policy.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel, ChannelSchedule } from '../src/types.js';

// 2026-10-09 is a Friday, 2026-10-10 a Saturday, 2026-10-12 a Monday.
const vn = (local: string) => new Date(vnToIso(local));
const now = vn(SAMPLE_NOW_VN);
const URL_A = 'https://prod-01.southeastasia.logic.azure.com:443/workflows/a/triggers/manual/paths/invoke?sig=SECRET_A';

let store: MemoryStore;
let sent: { channel: string; msg: Message }[];
let clock: Date;
const send = async (ch: Channel, msg: Message) => void sent.push({ channel: ch.id, msg });
const deps = () => ({ store, send, webUrl: 'https://web.example' });
const text = (m: Message) => [m.title, ...m.lines.map((x) => x.text)].join('\n');

const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => clock, send, webUrl: 'https://web.example' }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function addChannel(over: Partial<Channel> = {}) {
  const ch: Channel = {
    id: 'C1',
    name: 'Kênh test',
    kind: 'teams',
    webhookUrl: URL_A,
    scope: { type: 'all' },
    events: ['became_red', 'high_issue', 'overdue', 'late_update', 'milestone_soon', 'daily_digest'],
    quietHours: true,
    enabled: true,
    createdBy: 'lan@example.com',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...over,
  };
  await store.putChannel(ch);
  return ch;
}

async function reset(at: Date) {
  store = new MemoryStore();
  await loadSample(store, at);
  sent = [];
  clock = at;
}

beforeEach(() => reset(now));

describe('policy: quiet hours and digest days (Vietnam time)', () => {
  const legacy = { quietHours: true };

  it('channels without schedule keep 22:00–07:00 and the 08:00 daily digest', () => {
    expect(isQuiet(legacy, vn('2026-10-09 21:59'))).toBe(false);
    expect(isQuiet(legacy, vn('2026-10-09 22:00'))).toBe(true);
    expect(isQuiet(legacy, vn('2026-10-10 03:00'))).toBe(true);
    expect(isQuiet(legacy, vn('2026-10-10 06:59'))).toBe(true);
    expect(isQuiet(legacy, vn('2026-10-10 07:00'))).toBe(false);
    expect(isQuiet({ quietHours: false }, vn('2026-10-09 23:00'))).toBe(false);
    // Weekends are not skipped and the digest goes out every day at 08:00.
    expect(isQuiet(legacy, vn('2026-10-10 10:00'))).toBe(false);
    expect(digestDue(legacy, vn('2026-10-10 08:00'))).toBe(true);
    expect(digestDue(legacy, vn('2026-10-10 07:59'))).toBe(false);
    expect(resolveSchedule(legacy)).toEqual({
      quietFrom: 22,
      quietTo: 7,
      skipWeekends: false,
      digestHour: 8,
      digestDays: 'daily',
      milestoneLeadDays: [1],
    });
    expect(resolveSchedule({ quietHours: false })).toMatchObject({ quietFrom: 0, quietTo: 0 });
  });

  it('custom quiet hours, overnight or within the day; equal hours = none', () => {
    const night = { quietHours: true, schedule: { quietFrom: 23, quietTo: 6 } };
    expect(isQuiet(night, vn('2026-10-09 22:00'))).toBe(false);
    expect(isQuiet(night, vn('2026-10-09 23:00'))).toBe(true);
    expect(isQuiet(night, vn('2026-10-10 05:59'))).toBe(true);
    expect(isQuiet(night, vn('2026-10-10 06:00'))).toBe(false);
    const lunch = { quietHours: false, schedule: { quietFrom: 12, quietTo: 13 } };
    expect(isQuiet(lunch, vn('2026-10-09 11:59'))).toBe(false);
    expect(isQuiet(lunch, vn('2026-10-09 12:30'))).toBe(true);
    expect(isQuiet(lunch, vn('2026-10-09 13:00'))).toBe(false);
    // schedule replaces quietHours
    expect(isQuiet({ quietHours: true, schedule: { quietFrom: 0, quietTo: 0 } }, vn('2026-10-09 23:00'))).toBe(false);
  });

  it('skips Saturday and Sunday for hourly alerts and the digest', () => {
    const t = { quietHours: true, schedule: { skipWeekends: true } };
    expect(isQuiet(t, vn('2026-10-09 10:00'))).toBe(false); // Friday
    expect(isQuiet(t, vn('2026-10-10 10:00'))).toBe(true); // Saturday
    expect(isQuiet(t, vn('2026-10-11 23:59'))).toBe(true); // Sunday
    expect(isQuiet(t, vn('2026-10-12 08:00'))).toBe(false); // Monday
    expect(digestDue(t, vn('2026-10-10 08:00'))).toBe(false);
    expect(digestDue(t, vn('2026-10-12 08:00'))).toBe(true);
  });

  it('digest hour and days: weekdays, Monday only', () => {
    const at = (s: ChannelSchedule) => ({ quietHours: true, schedule: s });
    expect(digestDue(at({ digestHour: 17 }), vn('2026-10-09 08:00'))).toBe(false);
    expect(digestDue(at({ digestHour: 17 }), vn('2026-10-09 17:30'))).toBe(true);
    expect(digestDue(at({ digestDays: 'weekdays' }), vn('2026-10-09 08:00'))).toBe(true);
    expect(digestDue(at({ digestDays: 'weekdays' }), vn('2026-10-10 08:00'))).toBe(false);
    expect(digestDue(at({ digestDays: 'monday' }), vn('2026-10-12 08:00'))).toBe(true);
    expect(digestDue(at({ digestDays: 'monday' }), vn('2026-10-12 07:59'))).toBe(false);
    expect(digestDue(at({ digestDays: 'monday' }), vn('2026-10-13 08:00'))).toBe(false);
  });

  it('pausedUntil', () => {
    const t = { pausedUntil: vnToIso('2026-10-10 00:00') };
    expect(isPaused(t, vn('2026-10-09 23:59'))).toBe(true);
    expect(isPaused(t, vn('2026-10-10 00:00'))).toBe(false);
  });
});

describe('hourly job with a schedule', () => {
  it('a channel without schedule behaves as before (quiet at 22:00, not at 21:59)', async () => {
    await addChannel({ events: ['late_update'] });
    await runHourly(deps(), vn('2026-10-09 22:00'));
    expect(sent).toHaveLength(0);
    await runHourly(deps(), vn('2026-10-09 21:59'));
    expect(sent).toHaveLength(1);
  });

  it('custom quiet hours and weekend skipping hold back hourly alerts', async () => {
    await addChannel({ events: ['late_update'], schedule: { quietFrom: 20, quietTo: 8, skipWeekends: true } });
    await runHourly(deps(), vn('2026-10-09 07:30'));
    expect(sent).toHaveLength(0);
    await runHourly(deps(), vn('2026-10-10 10:00')); // Saturday
    expect(sent).toHaveLength(0);
    await runHourly(deps(), vn('2026-10-09 10:00'));
    expect(sent).toHaveLength(1);
  });

  it('daily digest at the chosen hour only on weekdays', async () => {
    await addChannel({ events: ['daily_digest'], schedule: { digestHour: 17, digestDays: 'weekdays' } });
    await runHourly(deps(), vn('2026-10-09 08:00'));
    expect(sent).toHaveLength(0);
    await runHourly(deps(), vn('2026-10-10 17:00')); // Saturday
    expect(sent).toHaveLength(0);
    await runHourly(deps(), vn('2026-10-09 17:00'));
    expect(sent.map((s) => s.msg.title)).toEqual([expect.stringContaining('Tóm tắt dự án')]);
  });

  it('reminds at each milestone lead day once, and only at day 1 without schedule', async () => {
    await addChannel({ id: 'LEAD', events: ['milestone_soon'], schedule: { milestoneLeadDays: [7, 3, 1] } });
    await addChannel({ id: 'OLD', events: ['milestone_soon'] });
    // P01 milestone "Giao hàng phase 1" is on 2026-10-20 in the sample.
    const day = (d: string) => vn(`${d} 10:00`);
    const lines = (id: string) =>
      sent
        .filter((s) => s.channel === id)
        .flatMap((s) => s.msg.lines.map((x) => x.text))
        .filter((t) => t.includes('Giao hàng phase 1'));

    await runHourly(deps(), day('2026-10-13')); // 7 days left
    await runHourly(deps(), day('2026-10-13'));
    expect(lines('LEAD')).toEqual([expect.stringContaining('Còn 7 ngày (20/10)')]);
    await runHourly(deps(), day('2026-10-15')); // 5 days: nothing new
    await runHourly(deps(), day('2026-10-17')); // 3 days
    await runHourly(deps(), day('2026-10-19')); // tomorrow
    expect(lines('LEAD')).toEqual([
      expect.stringContaining('Còn 7 ngày'),
      expect.stringContaining('Còn 3 ngày'),
      expect.stringContaining('Ngày mai 20/10'),
    ]);
    expect(lines('OLD')).toEqual([expect.stringContaining('Ngày mai 20/10')]);
  });

  it('an item added inside a lead window still gets one reminder for it', async () => {
    await addChannel({ events: ['milestone_soon'], schedule: { milestoneLeadDays: [1, 7] } });
    await runHourly(deps(), vn('2026-10-15 10:00')); // 5 days before 20/10 → lead 7
    await runHourly(deps(), vn('2026-10-16 10:00'));
    const hits = sent.flatMap((s) => s.msg.lines.map((x) => x.text)).filter((t) => t.includes('Giao hàng phase 1'));
    expect(hits).toEqual([expect.stringContaining('Còn 5 ngày')]);
  });
});

describe('weekly digest (Monday)', () => {
  it('compares with last week: colour changes, items closed, the next 7 days', async () => {
    const monday = vn('2026-10-12 08:00');
    await reset(monday);
    await addChannel({ events: ['daily_digest'], schedule: { digestDays: 'monday' } });
    const item = (await store.listItems('P01')).find((i) => i.title === 'Báo cáo tháng cho khách')!;
    await store.putItem({ ...item, status: 'done', updatedAt: new Date(monday.getTime() - 86_400_000).toISOString() });

    await runHourly(deps(), vn('2026-10-09 08:00')); // a Friday: no weekly digest
    expect(sent).toHaveLength(0);
    await runHourly(deps(), monday);
    await runHourly(deps(), monday);
    expect(sent).toHaveLength(1);
    const body = text(sent[0].msg);
    expect(sent[0].msg.title).toContain('🗓 Tóm tắt tuần 12/10 – Kênh test');
    expect(body).toMatch(/P03 · Nâng cấp ERP: .* → ■ Đỏ/); // no update a week ago, red now
    expect(body).toContain('Đã đóng trong tuần** (1)');
    expect(body).toContain('P01: ● Sự kiện "Báo cáo tháng cho khách"');
    expect(body).toContain('Mốc / sự kiện 7 ngày tới');
    expect(body).not.toContain('Giao hàng phase 1'); // 23/10 is more than 7 days ahead
  });
});

describe('burst grouping of high-priority issues', () => {
  const issue = (projectId: string, title: string, as = 'an') =>
    call('POST', `/projects/${projectId}/items`, as, { type: 'issue', title, priority: 'high', date: '2026-10-20' });
  const later = () => new Date(now.getTime() + 120_000);

  it('merges issues of the same channel that are due together into one message', async () => {
    await addChannel({ events: ['high_issue'] });
    await addChannel({ id: 'JA', webhookUrl: URL_A, events: ['high_issue'], lang: 'ja' });
    for (const t of ['Server hỏng', 'Mất dữ liệu', 'Khách khiếu nại']) await issue('P01', t);
    expect(sent).toHaveLength(0);
    expect((await flushDue(deps(), new Date(now.getTime() + 60_000))).sent).toBe(0);

    await flushDue(deps(), later());
    expect(sent.map((s) => s.channel).sort()).toEqual(['C1', 'JA']);
    const vi = sent.find((s) => s.channel === 'C1')!.msg;
    expect(vi.title).toBe('▲ 3 vấn đề ưu tiên cao mới ở P01');
    expect(text(vi)).toContain('**P01**: Server hỏng');
    expect(text(vi)).toContain('**P01**: Khách khiếu nại');
    expect(vi.link?.url).toBe('https://web.example/projects/P01');
    expect(sent.find((s) => s.channel === 'JA')!.msg.title).toBe('▲ P01 に優先度「高」の新しい課題が 3 件');
    expect(await store.listDue(new Date(now.getTime() + 3600_000), 50)).toHaveLength(0);
    expect((await store.listDeliveryLog('C1', 5))[0]).toMatchObject({ ok: true, event: 'high_issue_group' });
  });

  it('a single issue keeps its own message; several projects get a neutral title', async () => {
    await addChannel({ events: ['high_issue'] });
    await issue('P01', 'Server hỏng');
    await flushDue(deps(), later());
    expect(sent[0].msg.title).toContain('▲ Vấn đề ưu tiên cao mới – P01');

    sent = [];
    clock = new Date(now.getTime() + 600_000);
    await issue('P01', 'Một');
    await issue('P07', 'Hai', 'long');
    await flushDue(deps(), new Date(clock.getTime() + 120_000));
    expect(sent).toHaveLength(1);
    expect(sent[0].msg.title).toBe('▲ 2 vấn đề ưu tiên cao mới');
    expect(sent[0].msg.link?.url).toBe('https://web.example/');
  });
});

describe('anti-flapping', () => {
  const post = (health: string, hoursLater: number) => {
    clock = new Date(now.getTime() + hoursLater * 3600_000);
    return call('POST', '/projects/P07/updates', 'long', { health, summary: `${health} sau ${hoursLater}h` });
  };

  it('red → not red → red within 6 hours alerts only the first time', async () => {
    await addChannel({ events: ['became_red'] });
    await post('red', 0);
    expect(sent).toHaveLength(1);
    await post('green', 1);
    await post('red', 3); // flapping: no new alert
    expect(sent).toHaveLength(1);
    await post('green', 4);
    await post('red', 7); // last alert 7 hours ago
    expect(sent).toHaveLength(2);
    expect(sent[1].msg.title).toContain('P07 · Web thương mại chuyển sang ĐỎ');
  });

  it('is per channel; a failed alert is retried and still counts', async () => {
    await addChannel({ events: ['became_red'] });
    let failing = true;
    const flaky = async (ch: Channel, msg: Message) => {
      if (failing) throw new Error('HTTP 500');
      sent.push({ channel: ch.id, msg });
    };
    const app = () =>
      createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => clock, send: flaky, webUrl: 'https://web.example' });
    const postWith = (health: string, h: number) => {
      clock = new Date(now.getTime() + h * 3600_000);
      return app().request('/projects/P07/updates', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-user': 'long@example.com' },
        body: JSON.stringify({ health, summary: health }),
      });
    };
    await postWith('red', 0); // fails → queued for a retry in 1 minute
    failing = false;
    await flushDue({ store, send: flaky }, new Date(now.getTime() + 60_000));
    expect(sent).toHaveLength(1);
    await postWith('green', 1);
    await postWith('red', 2); // within 6 hours of the first alert
    expect(sent).toHaveLength(1);
    await addChannel({ id: 'C2', events: ['became_red'] });
    await postWith('green', 3);
    await postWith('red', 4);
    expect(sent.map((s) => s.channel)).toEqual(['C1', 'C2']);
  });
});
