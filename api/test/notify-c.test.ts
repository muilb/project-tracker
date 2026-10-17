import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAccounts } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import { AUTO_PAUSE_FAILURES, deliver, flushDue, send } from '../src/notify/deliver.js';
import { PermanentDeliveryError, scrubError } from '../src/notify/errors.js';
import type { Message } from '../src/notify/message.js';
import { createSender } from '../src/notify/sender.js';
import { postSlack } from '../src/notify/slack.js';
import { isLegacyTeamsUrl, isTeamsWebhookUrl, postTeams } from '../src/notify/teams.js';
import { TelegramMigratedError, telegramError, type TelegramClient } from '../src/notify/telegram.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const min = (n: number) => new Date(now.getTime() + n * 60_000);
const URL_A = 'https://prod-01.southeastasia.logic.azure.com:443/workflows/a/triggers/manual/paths/invoke?sig=SECRET_A';
const URL_LEGACY = 'https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/123/456';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const msg: Message = { title: 'Tin', lines: [] };

let store: MemoryStore;
let sent: string[];
/** Errors the fake sender throws, one per call (undefined = success). */
let failures: (Error | undefined)[];
const send_ = async (ch: Channel, m: Message) => {
  const e = failures.shift();
  if (e) throw e;
  sent.push(`${ch.id}:${m.title}`);
};
const deps = () => ({ store, send: send_, webUrl: 'https://web.example' });

let accounts: MemoryAccounts;
const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: send_, accounts, webUrl: 'https://web.example' }).request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );

async function addChannel(over: Partial<Channel> = {}) {
  const ch: Channel = {
    id: 'C1',
    name: 'Kênh test',
    kind: 'teams',
    webhookUrl: URL_A,
    scope: { type: 'all' },
    events: ['became_red', 'high_issue'],
    quietHours: true,
    enabled: true,
    createdBy: 'an@example.com',
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
  failures = [];
  accounts = new MemoryAccounts();
});

describe('retries', () => {
  it('queues a failed message with backoff 1 → 5 → 15 → 60 min, 6 attempts in all', async () => {
    await addChannel();
    failures = Array(10).fill(new Error('HTTP 502'));
    expect(await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now)).toBe(false);
    const due: number[] = [];
    let t = now;
    for (;;) {
      const [next] = await store.listDue(new Date(t.getTime() + 24 * 3600_000), 10);
      if (!next) break;
      due.push((Date.parse(next.dueAt) - t.getTime()) / 60_000);
      t = new Date(next.dueAt);
      await flushDue(deps(), t);
    }
    expect(due).toEqual([1, 5, 15, 60, 60]);
    expect(failures).toHaveLength(4); // 6 attempts used
    expect((await store.listDeliveryLog('C1', 20)).filter((d) => !d.ok)).toHaveLength(6);
  });

  it('delivers on a later attempt and resets the failure count', async () => {
    await addChannel({ failCount: 3 });
    failures = [new Error('timeout')];
    await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    expect((await flushDue(deps(), min(1))).sent).toBe(1);
    expect(sent).toEqual(['C1:Tin']);
    expect((await store.getChannel('C1'))?.failCount).toBe(0);
  });

  it('does not retry permanent errors', async () => {
    await addChannel();
    failures = [new PermanentDeliveryError('HTTP 404')];
    await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    expect(await store.listDue(min(120), 10)).toHaveLength(0);
    expect((await store.getChannel('C1'))?.failCount).toBe(1);
  });

  it('does not queue hourly messages (the next hourly run rebuilds them)', async () => {
    await addChannel();
    failures = [new Error('HTTP 500')];
    const o = { target: { channelId: 'C1' }, event: 'hourly', message: msg, sentKeys: [{ key: 'k', ttlDays: 1 }] };
    await send(deps(), o, now);
    expect(await store.listDue(min(120), 10)).toHaveLength(0);
    expect(await store.hasSent('k')).toBe(false);
  });

  it('retries personal Telegram messages too', async () => {
    await store.putNotifyPrefs({ userId: 'an@example.com', events: [], telegram: true, telegramChatId: '42', watch: [], updatedAt: '' });
    failures = [new Error('HTTP 502')];
    await send(deps(), { target: { userId: 'an@example.com', via: 'telegram' }, event: 'assigned_to_me', message: msg }, now);
    expect(await flushDue(deps(), min(1))).toEqual({ sent: 1, failed: 0 });
  });

  it('drops queued messages of a channel switched off meanwhile', async () => {
    await addChannel();
    failures = [new Error('HTTP 502')];
    await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    await store.putChannel({ ...(await store.getChannel('C1'))!, enabled: false });
    expect(await flushDue(deps(), min(1))).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe('auto-pause', () => {
  it(`switches a channel off after ${AUTO_PAUSE_FAILURES} lost messages in a row and tells its owner`, async () => {
    await addChannel();
    for (let i = 0; i < AUTO_PAUSE_FAILURES; i++) {
      failures = [new PermanentDeliveryError('HTTP 404')];
      await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    }
    const ch = (await store.getChannel('C1'))!;
    expect(ch).toMatchObject({ enabled: false, failCount: AUTO_PAUSE_FAILURES, autoPausedAt: now.toISOString() });
    expect(await store.listAudit(10)).toMatchObject([{ actor: 'system', action: 'channel_auto_pause', target: 'C1' }]);
    const [notice] = await store.listInbox('an@example.com', 10);
    expect(notice).toMatchObject({ event: 'channel_auto_pause', link: { url: 'https://web.example/channels' } });
    expect(notice.title).toContain('Kênh test');

    // Switching it back on by hand starts over.
    const res = await call('PATCH', '/channels/C1', 'an', { enabled: true });
    expect((await res.json()).channel).toMatchObject({ enabled: true, failCount: 0 });
    expect((await store.getChannel('C1'))?.autoPausedAt).toBeUndefined();
  });

  it('a success in between resets the count', async () => {
    await addChannel({ failCount: AUTO_PAUSE_FAILURES - 1 });
    await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    failures = [new PermanentDeliveryError('HTTP 404')];
    await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    expect(await store.getChannel('C1')).toMatchObject({ enabled: true, failCount: 1 });
  });

  it('a manual test send never pauses the channel', async () => {
    await addChannel({ failCount: AUTO_PAUSE_FAILURES - 1 });
    failures = [new PermanentDeliveryError('HTTP 404')];
    expect(await deliver(deps(), (await store.getChannel('C1'))!, msg, now)).toBe(false);
    expect((await store.getChannel('C1'))?.enabled).toBe(true);
  });
});

describe('telegram', () => {
  let tgSent: { chatId: string }[];
  let migrate: boolean;
  const telegram: TelegramClient = {
    getMe: async () => ({ username: 'du_an_bot' }),
    findChatByText: async () => ({ seen: [] }),
    async sendMessage(_token, chatId) {
      if (migrate && chatId === '-100') throw new TelegramMigratedError('-1009999');
      tgSent.push({ chatId });
    },
  };
  beforeEach(async () => {
    tgSent = [];
    migrate = true;
    await store.putTelegramBot({ token: TOKEN, username: 'du_an_bot' });
  });

  it('follows a group that became a supergroup and keeps the new chat id', async () => {
    await addChannel({ kind: 'telegram', webhookUrl: undefined, telegramChatId: '-100', telegramChatTitle: 'Nhóm' });
    const ok = await send({ store, send: createSender(store, telegram) }, { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    expect(ok).toBe(true);
    expect(tgSent).toEqual([{ chatId: '-1009999' }]);
    expect((await store.getChannel('C1'))?.telegramChatId).toBe('-1009999');
  });

  it('explains "bot was kicked" / "chat not found" in both languages, as permanent errors', () => {
    const kicked = telegramError(403, 'Forbidden: bot was kicked from the group chat');
    expect(kicked).toBeInstanceOf(PermanentDeliveryError);
    expect(kicked.message).toContain('bot đã bị xoá khỏi nhóm');
    expect(telegramError(400, 'Bad Request: chat not found')).toBeInstanceOf(PermanentDeliveryError);
    expect(telegramError(429, 'Too Many Requests')).not.toBeInstanceOf(PermanentDeliveryError);
    expect(telegramError(502, 'Bad Gateway')).not.toBeInstanceOf(PermanentDeliveryError);
  });
});

describe('teams', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('no longer accepts legacy webhook.office.com URLs', async () => {
    expect(isTeamsWebhookUrl(URL_LEGACY)).toBe(false);
    expect(isLegacyTeamsUrl(URL_LEGACY)).toBe(true);
    expect(isTeamsWebhookUrl(URL_A)).toBe(true);
    const res = await call('POST', '/channels', 'an', {
      kind: 'teams',
      name: 'Cũ',
      webhookUrl: URL_LEGACY,
      scope: { type: 'all' },
      events: ['became_red'],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Microsoft');
  });

  it('flags existing legacy channels without showing the URL', async () => {
    await addChannel({ webhookUrl: URL_LEGACY });
    const text = await (await call('GET', '/channels', 'an')).text();
    expect(JSON.parse(text).channels[0]).toMatchObject({ legacyWebhook: true });
    expect(text).not.toContain('IncomingWebhook/123');
  });

  it('treats a vanished workflow (404) as permanent, a 503 as temporary', async () => {
    vi.stubGlobal('fetch', async () => new Response('gone', { status: 404 }));
    await expect(postTeams(URL_A, {})).rejects.toBeInstanceOf(PermanentDeliveryError);
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }));
    await expect(postTeams(URL_A, {})).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });

  it('Slack: an archived channel / removed app is permanent, rate limits are retried', async () => {
    const hook = 'https://hooks.slack.com/services/T000/B000/XXXX';
    vi.stubGlobal('fetch', async () => new Response('channel_is_archived', { status: 410 }));
    await expect(postSlack(hook, {})).rejects.toBeInstanceOf(PermanentDeliveryError);
    vi.stubGlobal('fetch', async () => new Response('rate_limited', { status: 429 }));
    await expect(postSlack(hook, {})).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });
});

describe('secrets stay out of logs and errors', () => {
  it('scrubs bot tokens and URL query strings', () => {
    const s = scrubError(`fetch https://api.telegram.org/bot${TOKEN}/sendMessage failed; ${URL_A}`);
    expect(s).not.toContain(TOKEN);
    expect(s).not.toContain('SECRET_A');
    expect(scrubError('POST https://hooks.slack.com/services/T01/B02/SlackSecret9 failed')).not.toContain('SlackSecret9');
  });

  it('the delivery log and the channel never store them', async () => {
    await addChannel();
    failures = [new Error(`posting to ${URL_A} with bot${TOKEN} failed`)];
    await send(deps(), { target: { channelId: 'C1' }, event: 'became_red', message: msg }, now);
    const res = await call('GET', '/channels/C1/deliveries', 'an');
    const text = await res.text();
    expect(JSON.parse(text).deliveries).toHaveLength(1);
    expect(text).not.toContain('SECRET_A');
    expect(text).not.toContain(TOKEN);
    expect(JSON.stringify(await store.getChannel('C1'))).not.toContain(TOKEN);
    expect(JSON.stringify(await store.listDue(min(5), 10))).not.toContain('SECRET_A');
  });
});

describe('delivery log endpoint', () => {
  it('returns the last 20 deliveries to the owner and PMO only', async () => {
    await addChannel();
    for (let i = 0; i < 25; i++) await deliver(deps(), (await store.getChannel('C1'))!, { title: `T${i}`, lines: [] }, min(i));
    const { deliveries } = await (await call('GET', '/channels/C1/deliveries', 'lan')).json();
    expect(deliveries).toHaveLength(20);
    expect(deliveries[0].title).toBe('T24');
    expect((await call('GET', '/channels/C1/deliveries', 'binh')).status).toBe(403);
  });
});

describe('audit and transfer', () => {
  const body = { kind: 'teams', name: 'Kênh A', webhookUrl: URL_A, scope: { type: 'all' }, events: ['became_red'] };

  it('records create, update and delete without the webhook URL', async () => {
    const { channel } = await (await call('POST', '/channels', 'an', body)).json();
    await call('PATCH', `/channels/${channel.id}`, 'an', { scope: { type: 'projects', projects: ['P01'] }, webhookUrl: URL_A.replace('SECRET_A', 'SECRET_B') });
    await call('PATCH', `/channels/${channel.id}`, 'an', { name: 'Kênh A' }); // nothing changed: no entry
    await call('DELETE', `/channels/${channel.id}`, 'an');
    const log = await store.listAudit(10);
    expect(log.map((e) => e.action)).toEqual(['channel_delete', 'channel_update', 'channel_create']);
    expect(log[1].detail).toContain('scope');
    expect(log[1].detail).toContain('webhookUrl');
    expect(JSON.stringify(log)).not.toContain('SECRET');
  });

  it('transfers to someone with a login account; creator or PMO only', async () => {
    await addChannel();
    accounts = new MemoryAccounts([], new Set(['an@example.com', 'binh@example.com', 'lan@example.com']));
    expect((await call('POST', '/channels/C1/transfer', 'binh', { to: 'binh@example.com' })).status).toBe(403);
    // Known user without a login account.
    const users = await store.listUsers();
    const noAccount = users.find((u) => !['an@example.com', 'binh@example.com', 'lan@example.com'].includes(u.id))!;
    const refused = await call('POST', '/channels/C1/transfer', 'an', { to: noAccount.id });
    expect(refused.status).toBe(400);
    expect((await call('POST', '/channels/C1/transfer', 'an', { to: 'nobody@example.com' })).status).toBe(400);

    const res = await call('POST', '/channels/C1/transfer', 'lan', { to: 'binh@example.com' });
    expect((await res.json()).channel.createdBy).toBe('binh@example.com');
    expect(await store.listAudit(1)).toMatchObject([
      { actor: 'lan@example.com', action: 'channel_transfer', detail: 'Kênh test: an@example.com → binh@example.com' },
    ]);
    // The new owner can now edit it; the old one cannot.
    expect((await call('PATCH', '/channels/C1', 'binh', { enabled: false })).status).toBe(200);
    expect((await call('PATCH', '/channels/C1', 'an', { enabled: true })).status).toBe(403);
  });

  it('flags orphaned channels in the PMO list', async () => {
    await addChannel();
    await addChannel({ id: 'C2', createdBy: 'gone@example.com' });
    accounts = new MemoryAccounts([], new Set(['an@example.com', 'lan@example.com']));
    const { channels } = await (await call('GET', '/channels', 'lan')).json();
    expect(channels.map((c: { id: string; orphan?: boolean }) => [c.id, !!c.orphan])).toEqual([
      ['C1', false],
      ['C2', true],
    ]);
    // Owners do not get the flag on their own list.
    expect((await (await call('GET', '/channels', 'an')).json()).channels[0].orphan).toBeUndefined();
  });
});
