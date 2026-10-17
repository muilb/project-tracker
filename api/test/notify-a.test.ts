import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { can } from '../src/auth.js';
import type { Message } from '../src/notify/message.js';
import { runHourly } from '../src/notify/pipeline.js';
import type { TelegramChat, TelegramClient } from '../src/notify/telegram.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel, NotifyPrefs } from '../src/types.js';

// Sample "now" is 09:45 Vietnam time: P03 is late ≥ 2× its 8h cycle, several PLs are late,
// son owns an overdue issue, dung an overdue issue, khanh a milestone tomorrow.
const now = new Date(vnToIso(SAMPLE_NOW_VN));
const at = (vn: string) => new Date(vnToIso(vn));
const id = (name: string) => `${name}@example.com`;
const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';

let store: MemoryStore;
let sent: { channel: string; msg: Message }[];
let failSend: string | undefined;
const send = async (ch: Channel, msg: Message) => {
  if (failSend) throw new Error(failSend);
  sent.push({ channel: ch.id, msg });
};
const deps = () => ({ store, send, webUrl: 'https://web.example' });

let chats: (TelegramChat & { text: string })[];
let tgSent: { chatId: string; html: string }[];
const telegram: TelegramClient = {
  async getMe() {
    return { username: 'pt_bot' };
  },
  async findChatByText(_token, needle) {
    const c = [...chats].reverse().find((m) => m.text.toLowerCase().includes(needle.toLowerCase()));
    return { chat: c && { id: c.id, title: c.title, type: c.type }, seen: chats.map((m) => m.title) };
  },
  async sendMessage(_token, chatId, html) {
    tgSent.push({ chatId, html });
  },
};

const call = (method: string, path: string, as: string, body?: unknown, clock = now, lang = 'vi') =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => clock, send, telegram, webUrl: 'https://web.example' }).request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-user': id(as), 'accept-language': lang },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );

async function setPrefs(name: string, over: Partial<NotifyPrefs>) {
  const user = (await store.getUser(id(name)))!;
  const { defaultPrefs } = await import('../src/notify/personal.js');
  await store.putNotifyPrefs({ ...defaultPrefs(user, now), ...over });
}

const inboxOf = async (name: string) => store.listInbox(id(name), 100);
const telegramTo = (name: string) => sent.filter((s) => s.channel === `U:${id(name)}`);

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
  failSend = undefined;
  chats = [];
  tgSent = [];
});

afterEach(() => vi.restoreAllMocks());

describe('hourly personal reminders', () => {
  it('reminds PLs, escalates to the GL and lists my items due, once', async () => {
    await runHourly(deps(), now);
    // son: P03 late ≥ 2× its cycle (escalation) + his overdue issue, batched in one message.
    const son = await inboxOf('son');
    expect(son).toHaveLength(1);
    expect(son[0]).toMatchObject({ event: 'reminders', title: expect.stringContaining('(2)') });
    expect(son[0].lines.map((x) => x.text).join('\n')).toMatch(/🚨 P03[\s\S]*⚠ P03/);
    // PLs of late projects.
    expect((await inboxOf('cuong'))[0]).toMatchObject({ event: 'late_update_mine', projectId: 'P03' });
    expect((await inboxOf('dung'))[0].lines).toHaveLength(2); // late P04 + overdue item
    expect((await inboxOf('khanh'))[0].lines.map((x) => x.text).join()).toContain('Ngày mai');
    // Nobody else: hung's projects are not escalated, mai only gets ≥ 4×.
    expect(await inboxOf('hung')).toHaveLength(0);
    expect(await inboxOf('mai')).toHaveLength(0);
    expect(await inboxOf('long')).toHaveLength(0);

    // De-duplicated: the next hour adds nothing.
    await runHourly(deps(), new Date(now.getTime() + 3_600_000));
    expect(await inboxOf('son')).toHaveLength(1);
    expect(await inboxOf('cuong')).toHaveLength(1);
  });

  it('escalates to the project PMO at 4× the cycle', async () => {
    await runHourly(deps(), at('2026-10-10 09:45')); // P03: ≥ 32h late
    const mai = await inboxOf('mai');
    expect(mai).toHaveLength(1);
    expect(mai[0]).toMatchObject({ event: 'escalation', projectId: 'P03' });
    expect(mai[0].lines[0].text).toContain('≥ 4');
  });

  it('warns the PL 4 hours before the update is due', async () => {
    // P01 (24h cycle): an update 21h ago is due in 3h.
    await store.putUpdate({
      id: 'u1',
      projectId: 'P01',
      at: at('2026-10-08 12:45').toISOString(),
      author: id('an'),
      authorRole: 'PL',
      health: 'green',
      summary: 'ok',
    });
    await runHourly(deps(), now);
    const an = await inboxOf('an');
    expect(an).toHaveLength(1);
    expect(an[0]).toMatchObject({ event: 'update_due_soon', projectId: 'P01' });
    expect(an[0].lines[0].text).toContain('3 giờ');
  });

  it('only sends events the person switched on', async () => {
    await setPrefs('cuong', { events: ['assigned_to_me'] });
    await setPrefs('son', { events: ['my_item_due'] });
    await runHourly(deps(), now);
    expect(await inboxOf('cuong')).toHaveLength(0);
    expect((await inboxOf('son'))[0]).toMatchObject({ event: 'my_item_due' });
  });

  it('holds reminders during quiet hours and while paused', async () => {
    const night = at('2026-10-09 23:00');
    await setPrefs('dung', { schedule: { quietFrom: 0, quietTo: 0 } }); // no quiet hours
    await runHourly(deps(), night);
    expect(await inboxOf('cuong')).toHaveLength(0);
    expect(await inboxOf('dung')).toHaveLength(1);
    // Not marked as sent: it arrives after the quiet hours.
    await setPrefs('khanh', { pausedUntil: at('2026-10-12 00:00').toISOString() });
    await runHourly(deps(), at('2026-10-10 07:00'));
    expect(await inboxOf('cuong')).toHaveLength(1);
    expect(await inboxOf('khanh')).toHaveLength(0);
  });

  it('lists my items due only from the digest hour', async () => {
    await setPrefs('son', { events: ['my_item_due'] });
    await runHourly(deps(), at('2026-10-09 07:30'));
    expect(await inboxOf('son')).toHaveLength(0);
    await runHourly(deps(), at('2026-10-09 08:00'));
    expect(await inboxOf('son')).toHaveLength(1);
  });

  it('also sends to the linked Telegram chat, in the person’s language', async () => {
    await setPrefs('cuong', { telegram: true, telegramChatId: '42', lang: 'ja' });
    await runHourly(deps(), now);
    expect(telegramTo('cuong')).toHaveLength(1);
    expect(telegramTo('cuong')[0].msg.title).toContain('リマインダー');
    expect((await inboxOf('cuong'))[0].title).toContain('リマインダー');
  });

  it('skips projects the person may not see', async () => {
    vi.spyOn(can, 'viewProject').mockImplementation((u, p) => !(u.id === id('son') && p.id === 'P03'));
    await runHourly(deps(), now);
    expect(await inboxOf('son')).toHaveLength(0);
    expect(await inboxOf('cuong')).toHaveLength(1);
  });
});

describe('immediate personal messages', () => {
  const postUpdate = (as: string, body: object, clock = now) =>
    call('POST', '/projects/P01/updates', as, { summary: 'Tình hình', ...body }, clock);

  it('need help + health change: GL and PMO, never the author', async () => {
    expect((await postUpdate('an', { health: 'red', needHelp: 'Cần thêm người' })).status).toBe(201);
    const hung = await inboxOf('hung');
    expect(hung).toHaveLength(1); // health_changed + need_help in one message
    expect(hung[0]).toMatchObject({ event: 'health_changed', projectId: 'P01' });
    expect(hung[0].lines.map((x) => x.text).join('\n')).toContain('Cần thêm người');
    expect((await inboxOf('lan'))[0]).toMatchObject({ event: 'need_help' }); // PMO of P01
    expect(await inboxOf('an')).toHaveLength(0); // the author (PL)
    expect(await inboxOf('mai')).toHaveLength(0); // PMO of other projects
  });

  it('health change both ways; the GL posting gets nothing', async () => {
    await postUpdate('an', { health: 'yellow' });
    expect((await inboxOf('hung'))[0].title).toMatch(/Xanh → .*Vàng/);
    await setPrefs('an', { events: ['health_changed'] });
    await postUpdate('hung', { health: 'green' }, at('2026-10-09 10:00'));
    expect(await inboxOf('hung')).toHaveLength(1);
    expect((await inboxOf('an'))[0].title).toMatch(/Vàng → .*Xanh/);
  });

  it('watchers: turned red, new high issue; OTHER only for projects they see', async () => {
    await setPrefs('phuc', { watch: ['P01'] });
    await setPrefs('quang', { watch: ['P01'] });
    vi.spyOn(can, 'viewProject').mockImplementation((u, p) => !(u.id === id('quang') && p.id === 'P01'));
    await postUpdate('an', { health: 'red' });
    expect((await inboxOf('phuc'))[0]).toMatchObject({ event: 'watched_red', title: expect.stringContaining('ĐỎ') });
    expect(await inboxOf('quang')).toHaveLength(0);

    await call(
      'POST',
      '/projects/P01/items',
      'an',
      { type: 'issue', title: 'Lỗi lớn', priority: 'high', date: '2026-10-12', owner: id('an') },
      at('2026-10-09 10:00'),
    );
    expect((await inboxOf('phuc'))[0]).toMatchObject({ event: 'watched_high_issue' });
    expect(await inboxOf('quang')).toHaveLength(0);
  });

  it('assigned to me: on create or owner change, not when self-assigned', async () => {
    await call('POST', '/projects/P01/items', 'an', { type: 'event', title: 'Họp', date: '2026-10-12', owner: id('an') });
    expect(await inboxOf('an')).toHaveLength(0);
    const res = await call('POST', '/projects/P01/items', 'an', { type: 'event', title: 'Demo', date: '2026-10-12', owner: id('binh') });
    const { item } = await res.json();
    expect((await inboxOf('binh'))[0]).toMatchObject({ event: 'assigned_to_me', title: expect.stringContaining('P01') });
    // Unchanged owner: nothing new; owner changed: the new owner.
    await call('PATCH', `/projects/P01/items/${item.id}`, 'an', { title: 'Demo 2' });
    expect(await inboxOf('binh')).toHaveLength(1);
    await call('PATCH', `/projects/P01/items/${item.id}`, 'an', { owner: id('long') });
    expect(await inboxOf('long')).toHaveLength(1);
  });

  it('pause stops everything; quiet hours hold back only Telegram', async () => {
    await setPrefs('hung', { telegram: true, telegramChatId: '7', pausedUntil: at('2026-10-10 00:00').toISOString() });
    await postUpdate('an', { needHelp: 'Giúp' });
    expect(await inboxOf('hung')).toHaveLength(0);

    await setPrefs('lan', { telegram: true, telegramChatId: '8' });
    await postUpdate('an', { needHelp: 'Giúp' });
    expect(telegramTo('lan')).toHaveLength(1);
    await postUpdate('an', { needHelp: 'Giúp nữa' }, at('2026-10-09 23:00'));
    expect(await inboxOf('lan')).toHaveLength(3);
    expect(telegramTo('lan')).toHaveLength(1);
  });
});

describe('personal Telegram link', () => {
  it('needs the system bot', async () => {
    const res = await call('POST', '/me/notify/telegram/link', 'an');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('bot Telegram');
  });

  it('links a private chat with a code, with clear errors', async () => {
    await store.putTelegramBot({ token: TOKEN, username: 'pt_bot' });
    const link = await (await call('POST', '/me/notify/telegram/link', 'an')).json();
    expect(link.code).toMatch(/^PT-[A-Z0-9]{5}$/);
    expect(link.url).toBe(`https://t.me/pt_bot?start=${link.code}`);
    expect(JSON.stringify(link)).not.toContain(TOKEN);

    const confirm = (as = 'an', code = link.code, lang = 'vi') => call('POST', '/me/notify/telegram/confirm', as, { code }, now, lang);
    expect((await confirm('an', 'xx')).status).toBe(400);
    // Someone else's code.
    expect((await confirm('binh')).status).toBe(400);
    // Not received yet; other people's chats are never listed.
    chats.push({ id: '99', title: 'Người lạ', type: 'private', text: 'hello' });
    let res = await confirm();
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toContain('Người lạ');
    // Sent in a group: refused.
    chats.push({ id: '-100', title: 'Nhóm', type: 'group', text: `/start ${link.code}` });
    res = await confirm('an', link.code, 'ja');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('グループ');
    // Private chat: a test message, then saved.
    chats.push({ id: '555', title: 'An Nguyen', type: 'private', text: `/start ${link.code}` });
    res = await confirm('an', link.code.toLowerCase());
    expect(res.status).toBe(200);
    const { prefs } = await res.json();
    expect(prefs).toMatchObject({ telegram: true, telegramLinked: true, telegramChatTitle: 'An Nguyen' });
    expect(prefs.telegramChatId).toBeUndefined();
    expect(tgSent).toMatchObject([{ chatId: '555' }]);
    expect((await store.getNotifyPrefs(id('an')))?.telegramChatId).toBe('555');
    // A code works once.
    expect((await confirm()).status).toBe(400);
  });

  it('reports a failed test message and does not save', async () => {
    await store.putTelegramBot({ token: TOKEN, username: 'pt_bot' });
    const { code } = await (await call('POST', '/me/notify/telegram/link', 'an')).json();
    chats.push({ id: '555', title: 'An', type: 'private', text: `/start ${code}` });
    telegram.sendMessage = async () => {
      throw new Error('Telegram: Forbidden: bot was blocked by the user');
    };
    const res = await call('POST', '/me/notify/telegram/confirm', 'an', { code });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('blocked');
    expect(await store.getNotifyPrefs(id('an'))).toBeUndefined();
    telegram.sendMessage = async (_t, chatId, html) => void tgSent.push({ chatId, html });
  });
});

describe('POST /me/notify/test', () => {
  it('writes to the inbox, and to Telegram when linked', async () => {
    let body = await (await call('POST', '/me/notify/test', 'an')).json();
    expect(body).toEqual({ inbox: true });
    expect((await inboxOf('an'))[0]).toMatchObject({ event: 'test', title: expect.stringContaining('Tin thử') });

    await setPrefs('an', { telegramChatId: '555', lang: 'ja' });
    body = await (await call('POST', '/me/notify/test', 'an')).json();
    expect(body).toEqual({ inbox: true, telegram: { ok: true } });
    expect(telegramTo('an')[0].msg.title).toContain('テスト');

    failSend = 'Telegram: Forbidden: bot was blocked by the user';
    body = await (await call('POST', '/me/notify/test', 'an')).json();
    expect(body.telegram).toEqual({ ok: false, error: failSend });
  });
});
