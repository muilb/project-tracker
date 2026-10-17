import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { enqueue, flushDue } from '../src/notify/deliver.js';
import type { Message } from '../src/notify/message.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel, InboxEntry } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const URL_A = 'https://prod-01.southeastasia.logic.azure.com:443/workflows/a/triggers/manual/paths/invoke?sig=SECRET_A';

let store: MemoryStore;
let sent: { channel: string; msg: Message }[];
const send = async (ch: Channel, msg: Message) => void sent.push({ channel: ch.id, msg });
const deps = () => ({ store, send, webUrl: 'https://web.example' });

const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send, webUrl: 'https://web.example' }).request(path, {
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
    events: ['became_red', 'high_issue'],
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

const inbox = (id: string, at: string): InboxEntry => ({ userId: 'an@example.com', id, at, event: 'assigned_to_me', title: id, lines: [] });

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
});

describe('store: inbox, outbox, delivery log', () => {
  it('pages the inbox newest first and tracks unread', async () => {
    for (let i = 1; i <= 5; i++) await store.addInbox(inbox(`M${i}`, `2026-10-0${i}T00:00:00.000Z`));
    const first = await store.listInbox('an@example.com', 2);
    expect(first.map((e) => e.id)).toEqual(['M5', 'M4']);
    expect((await store.listInbox('an@example.com', 2, `${first[1].at}#${first[1].id}`)).map((e) => e.id)).toEqual(['M3', 'M2']);
    await store.markInboxRead('an@example.com', ['M5'], now.toISOString());
    expect(await store.countUnread('an@example.com')).toBe(4);
    await store.markInboxRead('an@example.com', 'all', now.toISOString());
    expect(await store.countUnread('an@example.com')).toBe(0);
  });

  it('sends due outbox entries once and records their de-duplication keys', async () => {
    await addChannel();
    const msg: Message = { title: 'Muộn', lines: [] };
    const later = new Date(now.getTime() + 120_000);
    await enqueue(
      deps(),
      { target: { channelId: 'C1' }, event: 'hourly', message: msg, sentKeys: [{ key: 'k1', ttlDays: 1 }] },
      now,
      later,
    );
    expect((await flushDue(deps(), now)).sent).toBe(0);
    expect((await flushDue(deps(), later)).sent).toBe(1);
    expect((await flushDue(deps(), later)).sent).toBe(0); // claimed, not sent twice
    expect(sent.map((s) => s.msg.title)).toEqual(['Muộn']);
    expect(await store.hasSent('k1')).toBe(true);
    const log = await store.listDeliveryLog('C1', 10);
    expect(log).toMatchObject([{ ok: true, event: 'hourly', title: 'Muộn' }]);
  });

  it('delivers personal outbox entries to the inbox', async () => {
    await enqueue(
      deps(),
      {
        target: { userId: 'an@example.com', via: 'inbox' },
        event: 'assigned_to_me',
        message: { title: 'Bạn được giao', lines: [] },
        projectId: 'P01',
      },
      now,
      now,
    );
    await flushDue(deps(), now);
    expect(await store.listInbox('an@example.com', 10)).toMatchObject([{ title: 'Bạn được giao', projectId: 'P01' }]);
  });
});

describe('emit from the routes', () => {
  it('still sends immediate alerts and logs the delivery', async () => {
    await addChannel();
    await call('POST', '/projects/P07/updates', 'long', { health: 'red', summary: 'Khách huỷ yêu cầu' });
    expect(sent).toHaveLength(1);
    expect((await store.listDeliveryLog('C1', 10))[0]).toMatchObject({ ok: true, event: 'became_red' });
  });

  it('editing an item does not repeat the high-priority alert', async () => {
    await addChannel();
    const res = await call('POST', '/projects/P01/items', 'an', {
      type: 'issue',
      title: 'Server hỏng',
      priority: 'high',
      date: '2026-10-10',
    });
    const { item } = await res.json();
    await call('PATCH', `/projects/P01/items/${item.id}`, 'an', { title: 'Server hỏng hẳn' });
    await flushDue(deps(), new Date(now.getTime() + 120_000)); // high-priority issues wait 2 minutes
    expect(sent).toHaveLength(1);
  });

  it('skips paused channels', async () => {
    await addChannel({ pausedUntil: new Date(now.getTime() + 3600_000).toISOString() });
    await call('POST', '/projects/P07/updates', 'long', { health: 'red', summary: 'Đỏ' });
    expect(sent).toHaveLength(0);
  });
});

describe('channels: new fields', () => {
  it('does not accept Slack yet, and a null pause clears it', async () => {
    const slack = await call('POST', '/channels', 'lan', {
      kind: 'slack',
      name: 'S',
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      scope: { type: 'all' },
      events: ['became_red'],
    });
    expect(slack.status).toBe(400);
    await addChannel({ pausedUntil: '2030-01-01T00:00:00.000Z' });
    const res = await call('PATCH', '/channels/C1', 'lan', { pausedUntil: null, schedule: { skipWeekends: true } });
    expect(res.status).toBe(200);
    expect(await store.getChannel('C1')).toMatchObject({ schedule: { skipWeekends: true } });
    expect((await store.getChannel('C1'))?.pausedUntil).toBeUndefined();
  });
});

describe('/me notification settings and inbox', () => {
  it('starts from role defaults and saves changes', async () => {
    const { prefs } = await (await call('GET', '/me/notify', 'long')).json(); // PL
    expect(prefs.events).toContain('update_due_soon');
    expect(prefs.telegramLinked).toBe(false);
    const hung = await (await call('GET', '/me/notify', 'hung')).json(); // GL
    expect(hung.prefs.events).toContain('escalation');

    const res = await call('PUT', '/me/notify', 'long', { events: ['assigned_to_me'], telegram: true, watch: ['p01', 'P01'] });
    const saved = (await res.json()).prefs;
    expect(saved).toMatchObject({ events: ['assigned_to_me'], telegram: false, watch: ['P01'] }); // no chat linked yet
    expect(await store.getNotifyPrefs('long@example.com')).toMatchObject({ events: ['assigned_to_me'] });
  });

  it('never returns the personal chat id, and can unlink it', async () => {
    await store.putNotifyPrefs({
      userId: 'an@example.com',
      events: [],
      telegram: true,
      telegramChatId: '12345',
      telegramChatTitle: 'An',
      watch: [],
      updatedAt: now.toISOString(),
    });
    const body = await (await call('GET', '/me/notify', 'an')).json();
    expect(JSON.stringify(body)).not.toContain('12345');
    expect(body.prefs).toMatchObject({ telegramLinked: true, telegramChatTitle: 'An' });
    await call('DELETE', '/me/notify/telegram', 'an');
    expect(await store.getNotifyPrefs('an@example.com')).toMatchObject({ telegram: false });
    expect((await store.getNotifyPrefs('an@example.com'))?.telegramChatId).toBeUndefined();
  });

  it('lists only my inbox, pages it and marks entries read', async () => {
    for (let i = 1; i <= 35; i++) await store.addInbox(inbox(`M${i}`, new Date(now.getTime() - i * 60_000).toISOString()));
    await store.addInbox({ ...inbox('OTHER', now.toISOString()), userId: 'hung@example.com' });
    const page = await (await call('GET', '/me/inbox', 'an')).json();
    expect(page.entries).toHaveLength(30);
    expect(page.unread).toBe(35);
    const next = await (await call('GET', `/me/inbox?before=${encodeURIComponent(page.nextBefore)}`, 'an')).json();
    expect(next.entries).toHaveLength(5);
    expect(next.nextBefore).toBeUndefined();

    expect((await (await call('POST', '/me/inbox/read', 'an', { ids: ['M1'] })).json()).unread).toBe(34);
    expect((await (await call('POST', '/me/inbox/read', 'an', { all: true })).json()).unread).toBe(0);
    expect((await call('POST', '/me/inbox/read', 'an', {})).status).toBe(400);
  });

  it('answers 501 for the parts track A builds', async () => {
    expect((await call('POST', '/me/notify/telegram/link', 'an')).status).toBe(501);
    expect((await call('POST', '/me/notify/test', 'an')).status).toBe(501);
  });
});
