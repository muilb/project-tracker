import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { langFromHeader } from '../src/i18n.js';
import { runHourly } from '../src/notify/pipeline.js';
import type { Message } from '../src/notify/message.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
let sent: { channel: string; msg: Message }[];
const send = async (ch: Channel, msg: Message) => void sent.push({ channel: ch.id, msg });

function call(method: string, path: string, as: string, body?: unknown, language?: string) {
  const app = createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send });
  return app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-dev-user': `${as}@example.com`,
      ...(language ? { 'accept-language': language } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function channel(id: string, lang?: Channel['lang']): Channel {
  return {
    id,
    name: id,
    kind: 'teams',
    webhookUrl: 'https://prod-01.southeastasia.logic.azure.com/workflows/x?sig=S',
    scope: { type: 'all' },
    events: ['high_issue', 'overdue', 'late_update', 'milestone_soon'],
    quietHours: false,
    enabled: true,
    lang,
    createdBy: 'lan@example.com',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
});

describe('language', () => {
  it('reads the language from Accept-Language', () => {
    expect(langFromHeader('ja-JP,ja;q=0.9')).toBe('ja');
    expect(langFromHeader('vi')).toBe('vi');
    expect(langFromHeader('en-US')).toBe('vi');
    expect(langFromHeader(undefined)).toBe('vi');
  });

  it('answers errors in the caller language', async () => {
    const vi = await call('GET', '/projects/NOPE', 'an');
    expect((await vi.json()).error).toBe('Không tìm thấy dự án NOPE');
    const ja = await call('GET', '/projects/NOPE', 'an', undefined, 'ja');
    expect((await ja.json()).error).toBe('プロジェクト NOPE が見つかりません');
  });

  it('translates validation messages, custom and built-in', async () => {
    const res = await call('POST', '/projects', 'an', { name: '', startDate: 'x' }, 'ja');
    const { error } = await res.json();
    expect(res.status).toBe(400);
    expect(error).toContain('プロジェクト名を入力してください');
    expect(error).toContain('YYYY-MM-DD 形式');
  });

  it('sends each channel alerts in its own language', async () => {
    await store.putChannel(channel('C1'));
    await store.putChannel(channel('C2', 'ja'));
    // Request in Japanese; the Vietnamese channel still gets Vietnamese.
    await call('POST', '/projects/P01/items', 'an', { type: 'issue', title: 'Server hỏng', priority: 'high', date: '2026-10-10' }, 'ja');
    const title = (id: string) => sent.find((s) => s.channel === id)!.msg.title;
    expect(title('C1')).toContain('Vấn đề ưu tiên cao mới');
    expect(title('C2')).toContain('優先度「高」の新しい課題');

    sent = [];
    await runHourly({ store, send }, now);
    expect(sent.find((s) => s.channel === 'C1')!.msg.title).toContain('Cần chú ý');
    expect(sent.find((s) => s.channel === 'C2')!.msg.title).toContain('要注意');
  });

  it('stores the channel language, defaulting to the creator language', async () => {
    const url = 'https://prod-01.southeastasia.logic.azure.com/workflows/y?sig=S';
    const base = { name: 'K', webhookUrl: url, scope: { type: 'all' }, events: ['daily_digest'] };
    const ja = await (await call('POST', '/channels', 'lan', base, 'ja')).json();
    expect(ja.channel.lang).toBe('ja');
    expect(sent.at(-1)!.msg.title).toContain('接続しました');
    const vi = await (await call('POST', '/channels', 'lan', { ...base, lang: 'vi' }, 'ja')).json();
    expect(vi.channel.lang).toBe('vi');
    const patched = await (await call('PATCH', `/channels/${vi.channel.id}`, 'lan', { lang: 'ja' })).json();
    expect(patched.channel.lang).toBe('ja');
  });
});
