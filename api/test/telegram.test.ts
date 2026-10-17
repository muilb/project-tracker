import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Message } from '../src/notify/message.js';
import { createSender } from '../src/notify/sender.js';
import { looksLikeBotToken, renderTelegram, type TelegramClient } from '../src/notify/telegram.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { channelFromRow, channelToRow } from '../src/store/dynamo.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

let store: MemoryStore;
let tgSent: { token: string; chatId: string; html: string }[];
let chats: { text: string; id: string; title: string }[];
let badToken: boolean;
const telegram: TelegramClient = {
  async getMe(token) {
    if (badToken) throw new Error('Telegram: Unauthorized');
    expect(token).toBe(TOKEN);
    return { username: 'du_an_bot' };
  },
  async findChatByText(_token, needle) {
    const c = chats.find((m) => m.text.toLowerCase().includes(needle.toLowerCase()));
    return { chat: c && { id: c.id, title: c.title }, seen: chats.filter((m) => m !== c).map((m) => m.title) };
  },
  async sendMessage(token, chatId, html) {
    tgSent.push({ token, chatId, html });
  },
};

function app() {
  return createApp({
    store,
    auth: { mode: 'dev', adminEmails: [] },
    clock: () => now,
    send: createSender(store, telegram),
    telegram,
    webUrl: 'https://web.example',
  });
}
const call = (method: string, path: string, as: string, body?: unknown) =>
  app().request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const channelBody = (code: string) => ({
  kind: 'telegram',
  name: 'Nhóm dự án',
  connectCode: code,
  scope: { type: 'all' },
  events: ['became_red'],
});

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  tgSent = [];
  chats = [];
  badToken = false;
});

describe('rendering', () => {
  it('escapes HTML, keeps bold and adds the link', () => {
    const msg: Message = {
      title: '■ P03 · <ERP> & co',
      lines: [{ text: '**Cần chú ý**' }, { text: 'a < b', subtle: true }],
      link: { title: 'Mở dự án', url: 'https://web.example/projects/P03?a=1&b=2' },
    };
    expect(renderTelegram(msg)).toBe(
      '<b>■ P03 · &lt;ERP&gt; &amp; co</b>\n<b>Cần chú ý</b>\n<i>a &lt; b</i>\n<a href="https://web.example/projects/P03?a=1&amp;b=2">Mở dự án →</a>',
    );
  });

  it('recognises bot tokens', () => {
    expect(looksLikeBotToken(TOKEN)).toBe(true);
    expect(looksLikeBotToken('abc')).toBe(false);
  });
});

describe('bot setup', () => {
  it('only admins set the token; it is validated and never returned', async () => {
    expect((await call('PUT', '/settings/telegram', 'an', { token: TOKEN })).status).toBe(403);
    expect((await call('PUT', '/settings/telegram', 'lan', { token: 'not-a-token-at-all' })).status).toBe(400);
    badToken = true;
    expect((await call('PUT', '/settings/telegram', 'lan', { token: TOKEN })).status).toBe(400);
    badToken = false;
    const res = await call('PUT', '/settings/telegram', 'lan', { token: TOKEN });
    expect(await res.json()).toEqual({ configured: true, username: 'du_an_bot' });
    const status = await call('GET', '/settings/telegram', 'an');
    const text = await status.text();
    expect(JSON.parse(text)).toEqual({ configured: true, username: 'du_an_bot' });
    expect(text).not.toContain(TOKEN);
    expect((await call('DELETE', '/settings/telegram', 'lan')).status).toBe(200);
    expect(await store.getTelegramBot()).toBeUndefined();
  });
});

describe('telegram channels', () => {
  it('needs a bot first', async () => {
    const res = await call('POST', '/channels', 'an', channelBody('PT-1234'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('chưa cài bot');
  });

  it('finds the chat by the connect code, sends a test message and saves it', async () => {
    await store.putTelegramBot({ token: TOKEN, username: 'du_an_bot' });
    let res = await call('POST', '/channels', 'an', channelBody('PT-ABCD'));
    expect(res.status).toBe(400);
    let error = (await res.json()).error;
    expect(error).toContain('/connect@du_an_bot PT-ABCD');
    expect(error).toContain('chưa nhận được tin nào');

    chats.push({ text: 'xin chào', id: '-1009', title: 'Nhóm khác' });
    error = (await (await call('POST', '/channels', 'an', channelBody('PT-ABCD'))).json()).error;
    expect(error).toContain('chỉ nhận được tin từ: Nhóm khác');

    chats.push({ text: '/connect@du_an_bot pt-abcd', id: '-1001234', title: 'Dự án kho' });
    res = await call('POST', '/channels', 'an', channelBody('PT-ABCD'));
    expect(res.status).toBe(201);
    const { channel } = await res.json();
    expect(channel).toMatchObject({ kind: 'telegram', telegramChatId: '-1001234', telegramChatTitle: 'Dự án kho' });
    expect(JSON.stringify(channel)).not.toContain(TOKEN);
    expect(tgSent).toEqual([{ token: TOKEN, chatId: '-1001234', html: expect.stringContaining('Đã kết nối') }]);
  });

  it('sends alerts to telegram channels', async () => {
    await store.putTelegramBot({ token: TOKEN, username: 'du_an_bot' });
    const ch: Channel = {
      id: 'T1',
      name: 'TG',
      kind: 'telegram',
      telegramChatId: '42',
      scope: { type: 'all' },
      events: ['became_red'],
      quietHours: true,
      enabled: true,
      createdBy: 'an@example.com',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await store.putChannel(ch);
    await call('POST', '/projects/P07/updates', 'long', { health: 'red', summary: 'Khách huỷ <hợp đồng>' });
    expect(tgSent).toHaveLength(1);
    expect(tgSent[0].html).toContain('<b>■ P07 · Web thương mại chuyển sang ĐỎ</b>');
    expect(tgSent[0].html).toContain('Khách huỷ &lt;hợp đồng&gt;');
  });

  it('records the error when the bot was removed', async () => {
    const ch: Channel = {
      id: 'T1',
      name: 'TG',
      kind: 'telegram',
      telegramChatId: '42',
      scope: { type: 'all' },
      events: ['became_red'],
      quietHours: true,
      enabled: true,
      createdBy: 'an@example.com',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await store.putChannel(ch);
    expect((await call('POST', '/projects/P07/updates', 'long', { health: 'red', summary: 'Đỏ' })).status).toBe(201);
    expect((await store.getChannel('T1'))?.lastError).toContain('Chưa cài bot Telegram');
  });
});

describe('dynamo channel rows', () => {
  const ch: Channel = {
    id: 'C001',
    name: 'TG',
    kind: 'telegram',
    telegramChatId: '-100',
    scope: { type: 'all' },
    events: ['became_red'],
    quietHours: true,
    enabled: true,
    createdBy: 'an@example.com',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  it('keeps the channel kind apart from the row kind', () => {
    const row = { ...channelToRow(ch), pk: 'CHANNEL#C001', sk: 'CHANNEL', kind: 'CHANNEL' };
    expect(channelFromRow(row)).toEqual(ch);
    expect(channelFromRow({ ...channelToRow({ ...ch, kind: 'teams', telegramChatId: undefined }), kind: 'CHANNEL' }).kind).toBe('teams');
  });

  it('repairs rows saved before the fix', () => {
    const { kind: _k, ...old } = ch;
    expect(channelFromRow({ ...old, pk: 'CHANNEL#C001', sk: 'CHANNEL', kind: 'CHANNEL' }).kind).toBe('telegram');
    expect(channelFromRow({ ...old, telegramChatId: undefined, webhookUrl: 'https://x', kind: 'CHANNEL' }).kind).toBe('teams');
  });
});

describe('moving a Telegram channel to another chat', () => {
  beforeEach(() => store.putTelegramBot({ token: TOKEN, username: 'du_an_bot' }));

  it('finds the new chat by code, sends a test message and keeps the settings', async () => {
    chats = [{ text: '/connect@du_an_bot PT-OLD01', id: '-100111', title: 'Nhóm cũ' }];
    const created = await (await call('POST', '/channels', 'lan', channelBody('PT-OLD01'))).json();
    chats.push({ text: '/connect@du_an_bot PT-NEW02', id: '-100222', title: 'Nhóm mới' });
    tgSent = [];
    const res = await call('PATCH', `/channels/${created.channel.id}`, 'lan', { connectCode: 'PT-NEW02' });
    expect(res.status).toBe(200);
    const { channel } = await res.json();
    expect(channel).toMatchObject({ telegramChatId: '-100222', telegramChatTitle: 'Nhóm mới', name: 'Nhóm dự án', events: ['became_red'] });
    expect(tgSent.map((m) => m.chatId)).toEqual(['-100222']);
  });

  it('explains a code the bot did not receive, and refuses Teams channels', async () => {
    chats = [{ text: '/connect@du_an_bot PT-OLD01', id: '-100111', title: 'Nhóm cũ' }];
    const created = await (await call('POST', '/channels', 'lan', channelBody('PT-OLD01'))).json();
    const miss = await call('PATCH', `/channels/${created.channel.id}`, 'lan', { connectCode: 'PT-NONE9' });
    expect(miss.status).toBe(400);
    expect((await miss.json()).error).toContain('PT-NONE9');

    await store.putChannel({ ...created.channel, id: 'C900', kind: 'teams', webhookUrl: 'https://x.logic.azure.com/w?sig=s' });
    expect((await call('PATCH', '/channels/C900', 'lan', { connectCode: 'PT-OLD01' })).status).toBe(400);
  });
});
