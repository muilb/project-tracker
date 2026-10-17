// track H: the signed-in person's browsers / phones for Web Push (mounted at /me/push).
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { l } from '../i18n.js';
import type { NotifyDeps } from '../notify/deps.js';
import type { Message } from '../notify/message.js';
import { isPushEndpoint, pushConfig, pushTo, subscriptionId } from '../notify/push.js';
import { parseBody } from '../schemas.js';
import type { PushSubscriptionRecord } from '../types.js';

export const push = new Hono<AppEnv>();

/** Devices per person; the oldest is replaced beyond this. */
export const MAX_PUSH_DEVICES = 10;

const base64url = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/);

const subscribeSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .max(1000)
    .refine(isPushEndpoint, { error: () => l('Địa chỉ nhận thông báo không hợp lệ', '通知の受信先アドレスが正しくありません') }),
  keys: z.object({ p256dh: base64url(200), auth: base64url(100) }),
  label: z.string().trim().min(1).max(60),
});

/** The device as the owner sees it: never the endpoint or the keys. */
const publicSub = ({ endpoint: _e, keys: _k, userId: _u, ...rest }: PushSubscriptionRecord) => rest;

push.get('/key', async (c) => {
  const { publicKey } = await pushConfig(c.get('store'), c.get('now'));
  return c.json({ publicKey });
});

push.get('/subscriptions', async (c) => {
  const subs = await c.get('store').listPushSubscriptions(c.get('user').id);
  return c.json({ subscriptions: subs.map(publicSub) });
});

push.post('/subscriptions', async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const body = await parseBody(c.req, subscribeSchema);
  const id = subscriptionId(body.endpoint);
  const existing = await store.listPushSubscriptions(userId);
  // Beyond MAX_PUSH_DEVICES the oldest devices make room (listPushSubscriptions is oldest first).
  const others = existing.filter((s) => s.id !== id);
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_PUSH_DEVICES)))
    await store.deletePushSubscription(userId, old.id);
  const sub: PushSubscriptionRecord = {
    userId,
    id,
    endpoint: body.endpoint,
    keys: body.keys,
    label: body.label,
    createdAt: existing.find((s) => s.id === id)?.createdAt ?? c.get('now').toISOString(),
  };
  await store.putPushSubscription(sub);
  return c.json({ subscription: publicSub(sub) }, 201);
});

push.delete('/subscriptions/:id', async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  // Only the person's own rows are looked up, so someone else's id is simply "not found".
  if (!(await store.getPushSubscription(userId, c.req.param('id'))))
    throw new HTTPException(404, { message: l('Không tìm thấy thiết bị', 'デバイスが見つかりません') });
  await store.deletePushSubscription(userId, c.req.param('id'));
  return c.json({ ok: true });
});

/** "Send test" to every device of the person; no retry. */
export async function testPush(deps: NotifyDeps, userId: string, message: Message, now: Date) {
  const subs = await deps.store.listPushSubscriptions(userId);
  let sent = 0;
  const errors: string[] = [];
  for (const sub of subs) {
    try {
      await pushTo(deps, sub, message, now, 'test');
      sent++;
    } catch (e) {
      errors.push(`${sub.label}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return { sent, failed: errors.length, errors };
}
