import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blankAction, type AiClient, type AiRawAction } from '../src/ai/assistant.js';
import { createApp } from '../src/app.js';
import { parseCommand } from '../src/bot/webhook.js';
import type { Message } from '../src/notify/message.js';
import { defaultPrefs } from '../src/notify/personal.js';
import { runHourly } from '../src/notify/pipeline.js';
import type { TelegramClient } from '../src/notify/telegram.js';
import { sameSecret } from '../src/routes/telegram.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel, NotifyPrefs } from '../src/types.js';

// Sample "now" is 09:45 Vietnam time: P03 is late, son owns the overdue issue I0007 (P03).
const now = new Date(vnToIso(SAMPLE_NOW_VN));
const id = (name: string) => `${name}@example.com`;
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const SECRET = 's3cret-for-tests';

let store: MemoryStore;
let sent: { channel: string; msg: Message }[];
let tg: { chatId: string; html: string; buttons?: { label: string; data: string }[] }[];
let answers: { id: string; text?: string }[];
let webhookCalls: { method: string; url?: string; secret?: string }[];
let setWebhookFails: boolean;
let legacyChats: { text: string; id: string; title: string; type?: string }[];
let aiActions: AiRawAction[];
let updateId: number;

const send = async (ch: Channel, msg: Message) => void sent.push({ channel: ch.id, msg });

const telegram: TelegramClient = {
  getMe: async () => ({ username: 'pt_bot' }),
  async findChatByText(_t, needle) {
    const c = legacyChats.find((m) => m.text.includes(needle));
    return { chat: c && { id: c.id, title: c.title, type: c.type }, seen: [] };
  },
  async sendMessage(_t, chatId, html, buttons) {
    tg.push({ chatId, html, buttons });
  },
  async setWebhook(_t, url, secret) {
    webhookCalls.push({ method: 'set', url, secret });
    if (setWebhookFails) throw new Error('Telegram: bad webhook: HTTPS url must be provided for webhook');
  },
  async deleteWebhook() {
    webhookCalls.push({ method: 'delete' });
  },
  getWebhookInfo: async () => ({ url: 'http://localhost/telegram/webhook', pendingUpdates: 2, lastError: 'Connection timed out' }),
  async answerCallbackQuery(_t, cbId, text) {
    answers.push({ id: cbId, text });
  },
  clearButtons: async () => {},
};

const ai: AiClient = {
  verifyKey: async () => {},
  extract: vi.fn(async () => ({ actions: aiActions, questions: [] })),
  ask: async () => ({ answer: '', truncated: false }),
};

const app = () =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send, telegram, ai, webUrl: 'https://web.example' });

const call = (method: string, path: string, as: string, body?: unknown) =>
  app().request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': id(as) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** `null` sends no secret header at all. */
const hook = (update: object, secret: string | null = SECRET) =>
  app().request('/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret !== null ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
    body: JSON.stringify({ update_id: ++updateId, ...update }),
  });

const privateChat = (chatId: number, name = 'Cuong') => ({ id: chatId, type: 'private', first_name: name });
const group = (chatId: number, title = 'Nhóm ERP') => ({ id: chatId, type: 'supergroup', title });
const say = (chat: object, text: string, from = { id: 1, language_code: 'vi' }) => hook({ message: { message_id: 1, chat, from, text } });
const press = (chat: object, data: string, from = { id: 1 }) =>
  hook({ callback_query: { id: `cb${updateId}`, from, data, message: { message_id: 9, chat } } });
const lastTo = (chatId: number) => tg.filter((m) => m.chatId === String(chatId)).at(-1);

async function link(name: string, chatId: number, over: Partial<NotifyPrefs> = {}) {
  const user = (await store.getUser(id(name)))!;
  await store.putNotifyPrefs({ ...defaultPrefs(user, now), telegram: true, telegramChatId: String(chatId), ...over });
}

async function telegramChannel(over: Partial<Channel> = {}): Promise<Channel> {
  const ch: Channel = {
    id: 'C001',
    name: 'Nhóm ERP',
    kind: 'telegram',
    telegramChatId: '-100500',
    telegramChatTitle: 'Nhóm ERP',
    scope: { type: 'projects', projects: ['P03', 'P04'] },
    events: ['became_red'],
    quietHours: false,
    enabled: true,
    createdBy: id('son'),
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
  await store.putTelegramBot({ token: TOKEN, username: 'pt_bot', webhookSecret: SECRET, webhookUrl: 'http://localhost/telegram/webhook' });
  sent = [];
  tg = [];
  answers = [];
  webhookCalls = [];
  setWebhookFails = false;
  legacyChats = [];
  aiActions = [];
  updateId = 1000;
  vi.mocked(ai.extract).mockClear();
});

describe('webhook setup', () => {
  it('saving the bot points it at this API with a new secret; removing it deletes the webhook', async () => {
    await store.putTelegramBot(undefined);
    const res = await call('PUT', '/settings/telegram', 'admin', { token: TOKEN });
    const body = await res.json();
    expect(body).toEqual({ configured: true, username: 'pt_bot', webhook: { active: true, url: 'http://localhost/telegram/webhook' } });
    const saved = (await store.getTelegramBot())!;
    expect(webhookCalls[0]).toEqual({ method: 'set', url: 'http://localhost/telegram/webhook', secret: saved.webhookSecret });
    expect(saved.webhookSecret).toMatch(/^[0-9a-f]{64}$/);

    // Status: the secret is never returned; Telegram's delivery errors only for the system admin.
    const admin = await (await call('GET', '/settings/telegram', 'admin')).text();
    expect(admin).not.toContain(saved.webhookSecret!);
    expect(JSON.parse(admin).webhook).toMatchObject({ active: true, pendingUpdates: 2, lastError: 'Connection timed out' });
    const pl = await (await call('GET', '/settings/telegram', 'an')).json();
    expect(pl.webhook).toEqual({ active: true, url: 'http://localhost/telegram/webhook' });

    expect((await call('DELETE', '/settings/telegram', 'admin')).status).toBe(200);
    expect(webhookCalls.at(-1)).toEqual({ method: 'delete' });
  });

  it('a failed setWebhook keeps the bot one-way: connect codes are read with getUpdates as before', async () => {
    setWebhookFails = true;
    const body = await (await call('PUT', '/settings/telegram', 'admin', { token: TOKEN })).json();
    expect(body.webhook).toMatchObject({ active: false, error: expect.stringContaining('HTTPS') });
    expect((await store.getTelegramBot())!.webhookSecret).toBeUndefined();
    legacyChats = [{ text: '/connect@pt_bot PT-LEGAC', id: '-100777', title: 'Nhóm cũ', type: 'group' }];
    const res = await call('POST', '/channels', 'son', {
      kind: 'telegram',
      name: 'Kênh cũ',
      connectCode: 'PT-LEGAC',
      scope: { type: 'all' },
      events: ['became_red'],
    });
    expect(res.status).toBe(201);
    // Re-registering later works once the URL is reachable.
    setWebhookFails = false;
    const again = await (await call('POST', '/settings/telegram/webhook', 'admin')).json();
    expect(again.webhook.active).toBe(true);
    expect((await call('POST', '/settings/telegram/webhook', 'lan')).status).toBe(403);
  });
});

describe('webhook security', () => {
  it('rejects requests without the matching secret and never answers with data', async () => {
    await link('cuong', 42);
    for (const secret of [null, '', 'wrong', `${SECRET}x`]) {
      const res = await say(privateChat(42), '/mine'); // the right secret, for contrast
      expect(res.status).toBe(200);
      const bad = await hook({ message: { message_id: 1, chat: privateChat(42), text: '/mine' } }, secret);
      expect(bad.status).toBe(401);
      expect(await bad.text()).toBe('{}');
    }
    // Only the 4 valid requests were answered in the chat.
    expect(tg).toHaveLength(4);
    const ok = await say(privateChat(42), '/mine');
    expect(await ok.json()).toEqual({ ok: true });
  });

  it('is closed while the bot has no webhook secret', async () => {
    await store.putTelegramBot({ token: TOKEN, username: 'pt_bot' });
    expect((await hook({}, '')).status).toBe(401);
    expect((await hook({}, 'anything')).status).toBe(401);
  });

  it('compares secrets in constant time, answers 200 to junk, and handles each update once', async () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret('abd', 'abc')).toBe(false);
    const junk = await app().request('/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: 'not json',
    });
    expect(junk.status).toBe(200);
    await link('cuong', 42);
    const update = { update_id: 5, message: { message_id: 1, chat: privateChat(42), text: '/late' } };
    for (let i = 0; i < 2; i++)
      await app().request('/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': SECRET },
        body: JSON.stringify(update),
      });
    expect(tg).toHaveLength(1);
  });

  it('rate-limits each chat', async () => {
    await link('cuong', 42);
    for (let i = 0; i < 25; i++) await say(privateChat(42), '/help');
    expect(tg).toHaveLength(20);
  });

  it('parses commands addressed to this bot only', () => {
    expect(parseCommand('/status P03', 'pt_bot')).toEqual({ name: 'status', args: 'P03' });
    expect(parseCommand('/status@PT_bot p03', 'pt_bot')).toEqual({ name: 'status', args: 'p03' });
    expect(parseCommand('/status@other_bot P03', 'pt_bot')).toBeNull();
    expect(parseCommand('hello', 'pt_bot')).toBeNull();
  });
});

describe('connect codes through the webhook', () => {
  it('group: /connect@bot PT-… is remembered, the channel page finds the group', async () => {
    const before = await call('POST', '/channels', 'son', {
      kind: 'telegram',
      name: 'Nhóm ERP',
      connectCode: 'PT-ABCDE',
      scope: { type: 'all' },
      events: ['became_red'],
    });
    expect(before.status).toBe(400);
    expect((await before.json()).error).toContain('Bot chưa nhận được mã PT-ABCDE');

    await say(group(-100900, 'Nhóm khác'), '/help@pt_bot');
    const miss = await call('POST', '/channels', 'son', {
      kind: 'telegram',
      name: 'Nhóm ERP',
      connectCode: 'PT-ABCDE',
      scope: { type: 'all' },
      events: ['became_red'],
    });
    expect((await miss.json()).error).toContain('Nhóm khác');

    await say(group(-100500), '/connect@pt_bot pt-abcde');
    expect(lastTo(-100500)!.html).toContain('Bot đã nhận mã kết nối');
    const res = await call('POST', '/channels', 'son', {
      kind: 'telegram',
      name: 'Nhóm ERP',
      connectCode: 'PT-ABCDE',
      scope: { type: 'all' },
      events: ['became_red'],
    });
    expect(res.status).toBe(201);
    const { channel } = await res.json();
    expect(channel).toMatchObject({ telegramChatTitle: 'Nhóm ERP' });
    expect((await store.getChannel(channel.id))!.telegramChatId).toBe('-100500');
  });

  it('personal: /start PT-… then "I pressed Start" links the private chat; a group code is refused', async () => {
    const { code } = await (await call('POST', '/me/notify/telegram/link', 'cuong')).json();
    const early = await call('POST', '/me/notify/telegram/confirm', 'cuong', { code });
    expect((await early.json()).error).toContain(`Bot chưa nhận được mã ${code}`);

    await say(group(-100600), `/connect@pt_bot ${code}`);
    const inGroup = await call('POST', '/me/notify/telegram/confirm', 'cuong', { code });
    expect((await inGroup.json()).error).toContain('được gửi trong một nhóm');

    await say(privateChat(42, 'Cường'), `/start ${code}`, { id: 42, language_code: 'ja' });
    expect(lastTo(42)!.html).toContain('接続コードを受信しました');
    const res = await call('POST', '/me/notify/telegram/confirm', 'cuong', { code });
    expect(res.status).toBe(200);
    expect((await res.json()).prefs).toMatchObject({ telegram: true, telegramLinked: true, telegramChatTitle: 'Cường' });
    expect((await store.getNotifyPrefs(id('cuong')))!.telegramChatId).toBe('42');
  });
});

describe('commands', () => {
  it('/mine, /late and /status for a linked person', async () => {
    await link('cuong', 42);
    await say(privateChat(42), '/mine');
    const mine = lastTo(42)!.html;
    expect(mine).toContain('Dự án của tôi (1)');
    expect(mine).toMatch(/■ Đỏ <b>P03<\/b> · Nâng cấp ERP — trễ cập nhật/);

    await say(privateChat(42), '/late');
    expect(lastTo(42)!.html).toContain('Đang trễ cập nhật');
    expect(lastTo(42)!.html).toContain('P03');

    await say(privateChat(42), '/status p01');
    expect(lastTo(42)!.html).toContain('P01 · Hệ thống quản lý kho');
    expect(lastTo(42)!.html).toContain('Test tích hợp');

    await say(privateChat(42), '/status');
    expect(lastTo(42)!.html).toContain('/status P03');
    await say(privateChat(42), '/start');
    expect(lastTo(42)!.html).toContain('/mine');
  });

  it("follows the person's visibility and language", async () => {
    // phuc (OTHER) supports P01 and P04 only.
    await link('phuc', 43, { lang: 'ja' });
    await say(privateChat(43), '/status P03');
    expect(lastTo(43)!.html).toContain('プロジェクト P03 が見つかりません');
    await say(privateChat(43), '/late');
    expect(lastTo(43)!.html).not.toContain('P03');
    await say(privateChat(43), '/mine');
    expect(lastTo(43)!.html).toContain('(2)');
    expect(lastTo(43)!.html).toContain('P01');
    expect(lastTo(43)!.html).toContain('P04');
  });

  it('in a group: the channel scope, seen by its creator; compact channels hide typed text', async () => {
    await telegramChannel();
    await say(group(-100500), '/late@pt_bot');
    const late = lastTo(-100500)!.html;
    expect(late).toContain('P03');
    expect(late).not.toContain('P02'); // late, but outside the scope
    await say(group(-100500), '/status P01');
    expect(lastTo(-100500)!.html).toContain('Không tìm thấy dự án P01');
    await say(group(-100500), '/status P03');
    expect(lastTo(-100500)!.html).toContain('PMO xác nhận Đỏ');

    await telegramChannel({ detail: 'compact' });
    await say(group(-100500), '/status P03');
    expect(lastTo(-100500)!.html).not.toContain('PMO xác nhận Đỏ');
    expect(lastTo(-100500)!.html).toContain('Cập nhật gần nhất');
    // Plain group chatter is ignored.
    const n = tg.length;
    await say(group(-100500), 'chào cả nhà');
    expect(tg).toHaveLength(n);
  });

  it('unlinked chats get a short hint', async () => {
    await say(privateChat(77), '/mine', { id: 77, language_code: 'ja' });
    expect(lastTo(77)!.html).toContain('アカウントが連携されていません');
    await say(group(-100999), '/mine@pt_bot');
    expect(lastTo(-100999)!.html).toContain('chưa được kết nối làm kênh');
  });
});

describe('buttons', () => {
  it('"Close item" under assigned_to_me closes it as the linked person, once', async () => {
    await link('an', 50);
    // lan assigns P01's milestone to an → an's personal Telegram message has a close button.
    await call('PATCH', '/projects/P01/items/I0002', 'lan', { owner: id('binh') });
    await call('PATCH', '/projects/P01/items/I0002', 'lan', { owner: id('an') });
    const msg = sent.find((s) => s.channel === `U:${id('an')}`)!.msg;
    expect(msg.actions).toEqual([{ label: '✓ Đóng mục I0002', data: 'c:P01:I0002' }]);

    await press(privateChat(50), 'c:P01:I0002');
    expect((await store.getItem('P01', 'I0002'))!.status).toBe('done');
    expect(answers.at(-1)!.text).toBe('✓ Đã đóng I0002');
    const updatedAt = (await store.getItem('P01', 'I0002'))!.updatedAt;
    await press(privateChat(50), 'c:P01:I0002');
    expect(answers.at(-1)!.text).toBe('I0002 đã đóng trước đó');
    expect((await store.getItem('P01', 'I0002'))!.updatedAt).toBe(updatedAt);
  });

  it('acts with the person\'s permissions: invisible projects answer "not found"', async () => {
    await link('phuc', 43);
    await press(privateChat(43), 'c:P03:I0007');
    expect(answers.at(-1)!.text).toContain('Không tìm thấy dự án P03');
    expect((await store.getItem('P03', 'I0007'))!.status).toBe('in_progress');
    // An unlinked chat cannot press anything.
    await press(privateChat(99), 'c:P01:I0001');
    expect(answers.at(-1)!.text).toContain('chưa liên kết');
    expect((await store.getItem('P01', 'I0001'))!.status).toBe('open');
  });

  it('"Snooze 1 day" under hourly reminders skips them until tomorrow', async () => {
    await link('son', 51);
    await runHourly({ store, send, webUrl: 'https://web.example' }, now);
    const msg = sent.find((s) => s.channel === `U:${id('son')}`)!.msg;
    expect(msg.actions!.map((a) => a.label)).toEqual(['✓ Đóng mục I0007', '⏰ Hoãn nhắc 1 ngày']);
    const snooze = msg.actions!.at(-1)!.data;

    await press(privateChat(51), snooze);
    expect(answers.at(-1)!.text).toContain('Đã hoãn');
    // Another person cannot use son's snooze button.
    await link('cuong', 42);
    await press(privateChat(42), snooze);
    expect(answers.at(-1)!.text).toContain('hết hạn');

    // A day later the dedupe keys of today's reminders no longer match, but the snooze holds them back.
    for (const k of [...store.sent.keys()]) if (!k.includes('snooze')) store.sent.delete(k);
    sent = [];
    await runHourly({ store, send, webUrl: 'https://web.example' }, now);
    expect(sent.filter((s) => s.channel === `U:${id('son')}`)).toHaveLength(0);
  });

  it('no buttons while the bot has no webhook (nobody would receive the press)', async () => {
    const { createSender } = await import('../src/notify/sender.js');
    await store.putTelegramBot({ token: TOKEN, username: 'pt_bot' });
    await link('an', 50);
    const real = createSender(store, telegram);
    await real({ id: `U:${id('an')}`, kind: 'telegram', telegramChatId: '50' } as Channel, {
      title: 't',
      lines: [],
      actions: [{ label: 'x', data: 'c:P01:I0001' }],
    });
    expect(tg.at(-1)!.buttons).toBeUndefined();
  });
});

describe('notes by chat (AI)', () => {
  beforeEach(() => store.putAiConfig({ apiKey: 'sk-ant-test' }));

  it('proposes, and writes only on Confirm, through the normal paths (alerts included), once', async () => {
    await link('cuong', 42);
    aiActions = [
      blankAction({ kind: 'update', projectId: 'P03', health: 'yellow', summary: 'UAT bắt đầu', needHelp: 'Cần thêm tester' }),
      blankAction({ kind: 'item', projectId: 'P03', itemType: 'issue', title: 'Thiếu dữ liệu UAT', priority: 'high', date: '2026-10-12' }),
      blankAction({ kind: 'update', projectId: '', summary: 'không rõ dự án' }),
    ];
    await say(privateChat(42), 'P03 UAT bắt đầu, chuyển vàng; thêm issue thiếu dữ liệu');
    const reply = lastTo(42)!;
    expect(reply.html).toContain('AI đề xuất 2 thay đổi');
    expect(reply.html).toContain('Không rõ dự án');
    expect(reply.buttons!.map((b) => b.label)).toEqual(['✓ Xác nhận (2)', '✗ Huỷ']);
    expect(await store.listUpdates('P03')).toHaveLength(4); // nothing written yet

    const confirm = reply.buttons![0].data;
    await press(privateChat(42), confirm);
    expect(lastTo(42)!.html).toContain('Đã ghi 2 thay đổi');
    const updates = await store.listUpdates('P03');
    expect(updates).toHaveLength(5);
    expect(updates.find((u) => u.summary === 'UAT bắt đầu')).toMatchObject({
      author: id('cuong'),
      health: 'yellow',
      rawText: 'P03 UAT bắt đầu, chuyển vàng; thêm issue thiếu dữ liệu',
    });
    expect((await store.listItems('P03')).some((i) => i.title === 'Thiếu dữ liệu UAT' && i.createdBy === id('cuong'))).toBe(true);
    // emit ran: son (GL of P03) is asked for help in his inbox.
    expect((await store.listInbox(id('son'), 10)).some((e) => e.event === 'need_help')).toBe(true);

    await press(privateChat(42), confirm);
    expect(answers.at(-1)!.text).toContain('đã xử lý');
    expect(await store.listUpdates('P03')).toHaveLength(5);
  });

  it('Cancel writes nothing; a new project and its update are created in order', async () => {
    await link('cuong', 42);
    aiActions = [blankAction({ kind: 'update', projectId: 'P03', summary: 'x' })];
    await say(privateChat(42), 'P03 x');
    await press(privateChat(42), lastTo(42)!.buttons![1].data);
    expect(lastTo(42)!.html).toContain('Đã huỷ');
    expect(await store.listUpdates('P03')).toHaveLength(4);

    aiActions = [
      blankAction({ kind: 'update', projectId: 'NEW1', summary: 'Kick-off xong' }),
      blankAction({ kind: 'project_create', projectId: 'NEW1', name: 'Dự án mới' }),
    ];
    await say(privateChat(42), 'dự án mới, kick-off xong');
    await press(privateChat(42), lastTo(42)!.buttons![0].data);
    expect(lastTo(42)!.html).toContain('Đã ghi 2 thay đổi');
    const created = [...store.projects.values()].find((p) => p.name === 'Dự án mới')!;
    expect(created).toMatchObject({ pl: id('cuong'), createdBy: id('cuong') });
    expect((await store.listUpdates(created.id))[0].summary).toBe('Kick-off xong');
  });

  it('a failing write is reported, the rest is saved', async () => {
    await link('cuong', 42);
    aiActions = [
      blankAction({ kind: 'update', projectId: 'P03', summary: 'ok' }),
      blankAction({ kind: 'item_status', projectId: 'P03', itemId: 'I0007', status: 'done' }),
    ];
    await say(privateChat(42), 'P03 ok, đóng I0007');
    // The item is deleted before the person confirms.
    const item = (await store.getItem('P03', 'I0007'))!;
    await store.putItem({ ...item, deletedAt: now.toISOString() });
    await press(privateChat(42), lastTo(42)!.buttons![0].data);
    expect(lastTo(42)!.html).toContain('Đã ghi 1/2 thay đổi');
    expect(lastTo(42)!.html).toContain('Không tìm thấy vấn đề / sự kiện');
  });

  it('explains when there is no AI key, or the person is not PL+', async () => {
    await store.putAiConfig(undefined);
    await link('cuong', 42);
    await say(privateChat(42), 'P03 xong UAT');
    expect(lastTo(42)!.html).toContain('chưa cài API key AI');
    await store.putAiConfig({ apiKey: 'sk-ant-test' });
    await link('phuc', 43);
    await say(privateChat(43), 'P01 xong');
    expect(lastTo(43)!.html).toContain('Chỉ PL trở lên');
    expect(ai.extract).not.toHaveBeenCalled();
  });

  it('only the person and chat that asked can confirm', async () => {
    await link('cuong', 42);
    await link('an', 50);
    aiActions = [blankAction({ kind: 'update', projectId: 'P03', summary: 'x' })];
    await say(privateChat(42), 'P03 x');
    const confirm = lastTo(42)!.buttons![0].data;
    await press(privateChat(50), confirm);
    expect(await store.listUpdates('P03')).toHaveLength(4);
    await press(privateChat(42), confirm);
    expect(await store.listUpdates('P03')).toHaveLength(5);
  });
});

describe('membership changes', () => {
  it('bot removed from a group: the channel is switched off with a clear reason, the owner is told', async () => {
    await telegramChannel();
    await hook({ my_chat_member: { chat: group(-100500), new_chat_member: { status: 'kicked' } } });
    const ch = (await store.getChannel('C001'))!;
    expect(ch.enabled).toBe(false);
    expect(ch.lastError).toContain('bot đã bị xoá khỏi nhóm');
    expect((await store.listInbox(id('son'), 5))[0]).toMatchObject({ event: 'channel_broken', title: expect.stringContaining('Nhóm ERP') });
  });

  it('a person blocked the bot: personal Telegram is switched off and the reason kept', async () => {
    await link('cuong', 42);
    await hook({ my_chat_member: { chat: privateChat(42), new_chat_member: { status: 'kicked' } } });
    const prefs = (await store.getNotifyPrefs(id('cuong')))!;
    expect(prefs).toMatchObject({ telegram: false, telegramChatId: undefined, telegramBroken: expect.stringContaining('chặn') });
    // Linking again clears it.
    const { code } = await (await call('POST', '/me/notify/telegram/link', 'cuong')).json();
    await say(privateChat(42), `/start ${code}`);
    await call('POST', '/me/notify/telegram/confirm', 'cuong', { code });
    expect((await store.getNotifyPrefs(id('cuong')))!.telegramBroken).toBeUndefined();
  });

  it('a group that became a supergroup keeps its channels', async () => {
    await telegramChannel();
    await hook({ message: { message_id: 1, chat: group(-100500), migrate_to_chat_id: -1009999 } });
    expect((await store.getChannel('C001'))!.telegramChatId).toBe('-1009999');
  });
});
