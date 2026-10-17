import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { flushDue, MAX_ATTEMPTS, send } from '../src/notify/deliver.js';
import type { Message } from '../src/notify/message.js';
import { runHourly } from '../src/notify/pipeline.js';
import { defaultPrefs } from '../src/notify/personal.js';
import { isPushEndpoint, MAX_PAYLOAD_BYTES, pushPayload, PushHttpError, subscriptionId, type PushRequest } from '../src/notify/push.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { NotifyPrefs } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const at = (vn: string) => new Date(vnToIso(vn));
const id = (name: string) => `${name}@example.com`;
const ENDPOINT_A = 'https://fcm.googleapis.com/fcm/send/device-a';
const ENDPOINT_B = 'https://updates.push.services.mozilla.com/wpush/v2/device-b';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

let store: MemoryStore;
let pushed: PushRequest[];
/** Errors the fake push service throws, keyed by endpoint, one per call (undefined = success). */
let failures: Map<string, (Error | undefined)[]>;
const push = async (req: PushRequest) => {
  const e = failures.get(req.subscription.endpoint)?.shift();
  if (e) throw e;
  pushed.push(req);
};
const sendChannel = async () => {};
const deps = () => ({ store, send: sendChannel, push, webUrl: 'https://web.example' });

const call = (method: string, path: string, as: string, body?: unknown, clock = now) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => clock, send: sendChannel, push, webUrl: 'https://web.example' }).request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-user': id(as) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );

async function setPrefs(name: string, over: Partial<NotifyPrefs>) {
  const user = (await store.getUser(id(name)))!;
  await store.putNotifyPrefs({ ...defaultPrefs(user, now), ...over });
}

const subscribe = (as: string, endpoint = ENDPOINT_A, label = 'Chrome · Windows') =>
  call('POST', '/me/push/subscriptions', as, { endpoint, keys: KEYS, label });
const pushedTo = (endpoint: string) => pushed.filter((p) => p.subscription.endpoint === endpoint);
const msg: Message = { title: 'Tin', lines: [{ text: 'Dòng 1' }] };

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  pushed = [];
  failures = new Map();
});

describe('VAPID keys', () => {
  it('are generated once and only the public key is returned', async () => {
    expect(await store.getPushConfig()).toBeUndefined();
    const a = await (await call('GET', '/me/push/key', 'an')).json();
    const b = await (await call('GET', '/me/push/key', 'binh')).json();
    const config = (await store.getPushConfig())!;
    expect(a).toEqual({ publicKey: config.publicKey });
    expect(b).toEqual(a);
    expect(config.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(JSON.stringify(a)).not.toContain(config.privateKey);
  });

  it('two first requests agree on one key pair', async () => {
    const [a, b] = await Promise.all([call('GET', '/me/push/key', 'an'), call('GET', '/me/push/key', 'binh')]);
    expect((await a.json()).publicKey).toBe((await b.json()).publicKey);
  });
});

describe('subscriptions', () => {
  it('saves several devices per person, without endpoint or keys in responses', async () => {
    const res = await subscribe('an');
    expect(res.status).toBe(201);
    const { subscription } = await res.json();
    expect(subscription).toEqual({ id: subscriptionId(ENDPOINT_A), label: 'Chrome · Windows', createdAt: now.toISOString() });
    await subscribe('an', ENDPOINT_B, 'Firefox · Linux');
    // Same browser again: replaced, not duplicated.
    await subscribe('an', ENDPOINT_A, 'Chrome · Windows 11');

    const list = await call('GET', '/me/push/subscriptions', 'an');
    const text = await list.text();
    const { subscriptions } = JSON.parse(text);
    expect(subscriptions.map((s: { label: string }) => s.label)).toEqual(['Chrome · Windows 11', 'Firefox · Linux']);
    expect(text).not.toContain('fcm.googleapis.com');
    expect(text).not.toContain(KEYS.p256dh);
    expect(text).not.toContain(KEYS.auth);
    // Other people see only their own.
    expect((await (await call('GET', '/me/push/subscriptions', 'binh')).json()).subscriptions).toEqual([]);
  });

  it('refuses endpoints outside the known push services and bad keys', async () => {
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/x'])
      expect((await subscribe('an', endpoint)).status).toBe(400);
    expect(
      (await call('POST', '/me/push/subscriptions', 'an', { endpoint: ENDPOINT_A, keys: { p256dh: 'a b', auth: 'x' }, label: 'x' })).status,
    ).toBe(400);
    expect(isPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
  });

  it('deletes only my own devices', async () => {
    await subscribe('an');
    const sid = subscriptionId(ENDPOINT_A);
    expect((await call('DELETE', `/me/push/subscriptions/${sid}`, 'binh')).status).toBe(404);
    expect(await store.listPushSubscriptions(id('an'))).toHaveLength(1);
    expect((await call('DELETE', `/me/push/subscriptions/${sid}`, 'an')).status).toBe(200);
    expect(await store.listPushSubscriptions(id('an'))).toHaveLength(0);
  });

  it('keeps at most 10 devices, dropping the oldest', async () => {
    for (let i = 0; i < 12; i++)
      await call('POST', '/me/push/subscriptions', 'an', { endpoint: `${ENDPOINT_A}${i}`, keys: KEYS, label: `D${i}` }, new Date(now.getTime() + i * 1000));
    const labels = (await store.listPushSubscriptions(id('an'))).map((s) => s.label);
    expect(labels).toHaveLength(10);
    expect(labels[0]).toBe('D2');
  });

  it('the push setting is saved with the preferences and kept when omitted', async () => {
    const body = { events: ['assigned_to_me'], telegram: false, watch: [] };
    expect((await (await call('PUT', '/me/notify', 'an', { ...body, push: true })).json()).prefs.push).toBe(true);
    expect((await (await call('PUT', '/me/notify', 'an', body)).json()).prefs.push).toBe(true);
    expect((await (await call('PUT', '/me/notify', 'an', { ...body, push: false })).json()).prefs.push).toBe(false);
  });
});

describe('delivery', () => {
  const postUpdate = (as: string, body: object, clock = now) =>
    call('POST', '/projects/P01/updates', as, { summary: 'Tình hình', ...body }, clock);

  it('sends to every device of a person who switched push on', async () => {
    await subscribe('hung');
    await subscribe('hung', ENDPOINT_B);
    await setPrefs('hung', { push: true });
    await subscribe('lan'); // push off: nothing
    await postUpdate('an', { health: 'red', needHelp: 'Cần thêm người' });
    expect(pushed).toHaveLength(2);
    const payload = JSON.parse(pushed[0].payload);
    expect(payload).toMatchObject({ tag: 'project-P01', url: 'https://web.example/projects/P01' });
    expect(payload.title).toContain('P01');
    expect(payload.body).toContain('Cần thêm người');
    expect(pushed[0].urgency).toBe('high');
    expect(pushed[0].vapid).toMatchObject({ subject: 'https://web.example', publicKey: (await store.getPushConfig())!.publicKey });
    expect((await store.listPushSubscriptions(id('hung')))[0].lastSentAt).toBe(now.toISOString());
  });

  it('410 / 404 remove the device, without retry', async () => {
    await subscribe('hung');
    await subscribe('hung', ENDPOINT_B);
    await setPrefs('hung', { push: true });
    failures.set(ENDPOINT_A, [new PushHttpError(410, 'HTTP 410 Gone')]);
    failures.set(ENDPOINT_B, [new PushHttpError(404, 'HTTP 404')]);
    expect(await send(deps(), { target: { userId: id('hung'), via: 'push' }, event: 'need_help', message: msg }, now)).toBe(false);
    expect(await store.listPushSubscriptions(id('hung'))).toEqual([]);
    expect(await store.listDue(new Date(now.getTime() + 86_400_000), 10)).toEqual([]);
  });

  it('retries 5xx / 429 on the failing device only', async () => {
    await subscribe('hung');
    await subscribe('hung', ENDPOINT_B);
    failures.set(ENDPOINT_A, [new PushHttpError(503, 'HTTP 503'), new PushHttpError(429, 'HTTP 429')]);
    expect(await send(deps(), { target: { userId: id('hung'), via: 'push' }, event: 'need_help', message: msg }, now)).toBe(true);
    expect(pushedTo(ENDPOINT_B)).toHaveLength(1);
    const [queued] = await store.listDue(new Date(now.getTime() + 60_000), 10);
    expect(queued).toMatchObject({ target: { userId: id('hung'), via: 'push', subscriptionId: subscriptionId(ENDPOINT_A) }, attempts: 1 });
    expect((await store.getPushSubscription(id('hung'), subscriptionId(ENDPOINT_A)))!.lastError).toContain('503');

    await flushDue(deps(), new Date(now.getTime() + 60_000)); // 429 → retried again in 5 min
    expect(pushed).toHaveLength(1);
    await flushDue(deps(), new Date(now.getTime() + 6 * 60_000));
    expect(pushedTo(ENDPOINT_A)).toHaveLength(1);
    expect(pushedTo(ENDPOINT_B)).toHaveLength(1);
    expect(await store.listDue(new Date(now.getTime() + 86_400_000), 10)).toEqual([]);
  });

  it('other 4xx are permanent; the device is kept with its error', async () => {
    await subscribe('hung');
    failures.set(ENDPOINT_A, [new PushHttpError(403, 'HTTP 403 VAPID mismatch')]);
    expect(await send(deps(), { target: { userId: id('hung'), via: 'push' }, event: 'need_help', message: msg }, now)).toBe(false);
    expect(await store.listDue(new Date(now.getTime() + 86_400_000), 10)).toEqual([]);
    expect((await store.listPushSubscriptions(id('hung')))[0].lastError).toContain('403');
  });

  it('gives up after MAX_ATTEMPTS', async () => {
    await subscribe('hung');
    failures.set(ENDPOINT_A, Array(10).fill(new Error('ECONNRESET')));
    await send(deps(), { target: { userId: id('hung'), via: 'push' }, event: 'need_help', message: msg }, now);
    let t = now;
    for (let i = 0; i < 10; i++) {
      t = new Date(t.getTime() + 2 * 3600_000);
      await flushDue(deps(), t);
    }
    expect(failures.get(ENDPOINT_A)).toHaveLength(10 - MAX_ATTEMPTS);
  });

  it('respects pause and quiet hours like Telegram', async () => {
    await subscribe('hung');
    await setPrefs('hung', { push: true, pausedUntil: at('2026-10-10 00:00').toISOString() });
    await postUpdate('an', { needHelp: 'Giúp' });
    expect(pushed).toHaveLength(0);

    await setPrefs('hung', { push: true });
    await postUpdate('an', { needHelp: 'Giúp nữa' }, at('2026-10-09 23:00')); // quiet hours: inbox only
    expect(pushed).toHaveLength(0);
    expect(await store.listInbox(id('hung'), 10)).toHaveLength(1);

    await setPrefs('hung', { push: true, schedule: { quietFrom: 0, quietTo: 0 } });
    await postUpdate('an', { needHelp: 'Giúp lần 3' }, at('2026-10-09 23:30'));
    expect(pushed).toHaveLength(1);
  });

  it('hourly reminders go to push once, after quiet hours', async () => {
    await subscribe('cuong');
    await setPrefs('cuong', { push: true });
    await runHourly(deps(), at('2026-10-09 23:00'));
    expect(pushed).toHaveLength(0);
    await runHourly(deps(), now);
    expect(pushed).toHaveLength(1);
    expect(JSON.parse(pushed[0].payload).title).toContain('Nhắc việc');
    await runHourly(deps(), new Date(now.getTime() + 3_600_000));
    expect(pushed).toHaveLength(1);
  });

  it('keeps the payload small', () => {
    const long: Message = { title: 'T'.repeat(500), lines: Array(30).fill({ text: 'ư'.repeat(400) }) };
    const p = pushPayload(long, { event: 'reminders' });
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(JSON.parse(p)).toMatchObject({ tag: 'reminders' });
  });
});

describe('test message', () => {
  it('goes to push when switched on, and reports failures', async () => {
    await subscribe('an');
    expect((await (await call('POST', '/me/notify/test', 'an')).json()).push).toBeUndefined();
    await setPrefs('an', { push: true });
    await subscribe('an', ENDPOINT_B, 'Firefox · Linux');
    failures.set(ENDPOINT_B, [new PushHttpError(410, 'HTTP 410')]);
    const body = await (await call('POST', '/me/notify/test', 'an')).json();
    expect(body.push).toMatchObject({ sent: 1, failed: 1 });
    expect(body.push.errors[0]).toContain('Firefox · Linux');
    expect(await store.listPushSubscriptions(id('an'))).toHaveLength(1);
  });

  it('never returns the private key', async () => {
    await subscribe('lan');
    await setPrefs('lan', { push: true });
    await call('GET', '/me/push/key', 'an');
    const secret = (await store.getPushConfig())!.privateKey;
    expect(secret.length).toBeGreaterThan(20);
    const spy = vi.spyOn(console, 'log');
    for (const [method, path] of [
      ['GET', '/me/push/key'],
      ['GET', '/me/push/subscriptions'],
      ['GET', '/me/notify'],
      ['POST', '/me/notify/test'],
      ['GET', '/settings'],
    ])
      expect(await (await call(method, path, 'lan')).text()).not.toContain(secret);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  });
});
