import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runHourly } from '../src/notify/alerts.js';
import { isTeamsWebhookUrl } from '../src/notify/teams.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN)); // 09:45 Vietnam time
const URL_A = 'https://prod-01.southeastasia.logic.azure.com:443/workflows/a/triggers/manual/paths/invoke?sig=SECRET_A';
const URL_B = 'https://x.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/b?sig=SECRET_B';

let store: MemoryStore;
let sent: { url: string; text: string }[];
let failing: boolean;
const send = async (url: string, payload: unknown) => {
  if (failing) throw new Error('Teams trả về HTTP 500');
  sent.push({ url, text: JSON.stringify(payload) });
};
const deps = () => ({ store, send, webUrl: 'https://web.example' });

function app() {
  return createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send, webUrl: 'https://web.example' });
}
function call(method: string, path: string, as: string, body?: unknown) {
  return app().request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function addChannel(over: Partial<Channel> = {}) {
  const ch: Channel = {
    id: `C${store.channels.size + 1}`,
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

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
  failing = false;
});

describe('channel registration', () => {
  const body = { name: 'Nhóm Hùng', webhookUrl: URL_A, scope: { type: 'gl', gl: 'hung@example.com' }, events: ['became_red'] };

  it('only accepts Teams Workflows URLs', () => {
    expect(isTeamsWebhookUrl(URL_A)).toBe(true);
    expect(isTeamsWebhookUrl(URL_B)).toBe(true);
    expect(isTeamsWebhookUrl('http://prod-01.logic.azure.com/x')).toBe(false);
    expect(isTeamsWebhookUrl('https://evil.example/logic.azure.com')).toBe(false);
  });

  it('sends a test message before saving and never returns the webhook URL', async () => {
    const res = await call('POST', '/channels', 'an', body);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain('SECRET');
    expect(json.channel.webhookUrlMasked).toBe('https://prod-01.southeastasia.logic.azure.com/workflows/a/tri…');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Đã kết nối kênh');

    const list = await (await call('GET', '/channels', 'an')).json();
    expect(JSON.stringify(list)).not.toContain('SECRET_A');
  });

  it('rejects bad URLs and does not save when the test message fails', async () => {
    expect((await call('POST', '/channels', 'an', { ...body, webhookUrl: 'https://example.com/hook' })).status).toBe(400);
    expect((await call('POST', '/channels', 'an', { ...body, scope: { type: 'gl' } })).status).toBe(400);
    failing = true;
    const res = await call('POST', '/channels', 'an', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Không gửi được tin thử');
    expect(store.channels.size).toBe(0);
  });

  it('users see and edit only their own channels; admins see all', async () => {
    await call('POST', '/channels', 'an', body);
    expect((await (await call('GET', '/channels', 'binh')).json()).channels).toHaveLength(0);
    expect((await (await call('GET', '/channels', 'lan')).json()).channels).toHaveLength(1);
    const id = [...store.channels.keys()][0];
    expect((await call('PATCH', `/channels/${id}`, 'binh', { enabled: false })).status).toBe(403);
    expect((await call('PATCH', `/channels/${id}`, 'an', { enabled: false })).status).toBe(200);
    expect((await call('DELETE', `/channels/${id}`, 'lan')).status).toBe(200);
    expect(store.channels.size).toBe(0);
  });
});

describe('immediate alerts', () => {
  it('notifies channels in scope when a project turns red, once', async () => {
    await addChannel({ id: 'ALL' });
    await addChannel({ id: 'SON', webhookUrl: URL_B, scope: { type: 'gl', gl: 'son@example.com' } });
    await call('POST', '/projects/P07/updates', 'long', { health: 'red', summary: 'Khách huỷ yêu cầu chính' });
    expect(sent.map((s) => s.url)).toEqual([URL_A]); // P07 belongs to GL Hùng, not Sơn
    expect(sent[0].text).toContain('P07 · Web thương mại chuyển sang ĐỎ');
    expect(sent[0].text).toContain('https://web.example/projects/P07');

    await call('POST', '/projects/P07/updates', 'long', { health: 'red', summary: 'Vẫn đỏ' });
    expect(sent).toHaveLength(1); // already red → no new alert
  });

  it('notifies on a new high-priority issue only', async () => {
    await addChannel();
    await call('POST', '/projects/P01/items', 'an', { type: 'issue', title: 'Server test hỏng', priority: 'high', date: '2026-10-10' });
    await call('POST', '/projects/P01/items', 'an', { type: 'issue', title: 'Lỗi chính tả', priority: 'low', date: '2026-10-10' });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Server test hỏng');
  });

  it('a failing Teams webhook does not fail the update', async () => {
    await addChannel();
    failing = true;
    const res = await call('POST', '/projects/P07/updates', 'long', { health: 'red', summary: 'Đỏ' });
    expect(res.status).toBe(201);
    expect((await store.getChannel('C1'))?.lastError).toContain('HTTP 500');
  });
});

describe('hourly job', () => {
  it('batches late updates, overdue items and tomorrow events into one message, then de-duplicates', async () => {
    await addChannel({ events: ['late_update', 'overdue', 'milestone_soon'] });
    expect((await runHourly(deps(), now)).messages).toBe(1);
    const text = sent[0].text;
    expect(text).toContain('P05 · Bảo trì hệ thống bán hàng: trễ cập nhật');
    expect(text).toContain('Môi trường test của khách chưa sẵn sàng\\" quá hạn 6 ngày');
    expect(text).toContain('Ngày mai 10/10 – P06');

    const later = new Date(now.getTime() + 600_000); // same hour → nothing new
    expect((await runHourly(deps(), later)).messages).toBe(0);

    // P06 is 47.75h late now; one more hour crosses 48h → a fresh 24h reminder for it only.
    await runHourly(deps(), new Date(now.getTime() + 3600_000));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain('P06');
    expect(sent[1].text).not.toContain('P05');
  });

  it('respects scope and quiet hours', async () => {
    await addChannel({ events: ['late_update'], scope: { type: 'projects', projects: ['P07'] } });
    expect((await runHourly(deps(), now)).messages).toBe(0); // P07 is not late

    const night = new Date(vnToIso('2026-10-09 23:00'));
    await addChannel({ id: 'Q', events: ['late_update'], quietHours: true });
    await addChannel({ id: 'N', events: ['late_update'], quietHours: false, webhookUrl: URL_B });
    await runHourly(deps(), night);
    expect(sent.map((s) => s.url)).toEqual([URL_B]);
  });

  it('retries after a failed delivery', async () => {
    await addChannel({ events: ['overdue'] });
    failing = true;
    await runHourly(deps(), now);
    expect(sent).toHaveLength(0);
    failing = false;
    expect((await runHourly(deps(), now)).messages).toBe(1);
  });

  it('sends the daily digest at 08:00 once', async () => {
    await addChannel({ events: ['daily_digest'] });
    expect((await runHourly(deps(), now)).messages).toBe(0); // 09:45
    const eight = new Date(vnToIso('2026-10-09 08:05'));
    expect((await runHourly(deps(), eight)).messages).toBe(1);
    expect(sent[0].text).toContain('Tóm tắt dự án 09/10');
    expect(sent[0].text).toContain('P03 · Nâng cấp ERP');
    expect((await runHourly(deps(), new Date(eight.getTime() + 600_000))).messages).toBe(0);
  });
});
