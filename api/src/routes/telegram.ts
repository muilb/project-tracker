// track G: updates from Telegram. Public route: the only proof the request comes from Telegram is the
// secret given to setWebhook, so nothing is read before it matches, and the answer never carries data.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { handleUpdate } from '../bot/webhook.js';
import type { TgUpdate } from '../bot/who.js';
import type { AppEnv } from '../env.js';
import { scrubError } from '../notify/errors.js';

export const telegramWebhook = new Hono<AppEnv>();

/** Constant-time comparison (of digests, so different lengths take the same time too). */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) && given.length > 0;
}

telegramWebhook.post('/webhook', bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({}, 413) }), async (c) => {
  const store = c.get('store');
  const bot = await store.getTelegramBot();
  if (!bot?.webhookSecret || !sameSecret(c.req.header('x-telegram-bot-api-secret-token') ?? '', bot.webhookSecret)) return c.json({}, 401);
  const update = (await c.req.json().catch(() => undefined)) as TgUpdate | undefined;
  if (update && typeof update === 'object') {
    try {
      await handleUpdate({ store, notify: c.get('notify'), telegram: c.get('telegram'), ai: c.get('ai'), now: c.get('now'), bot }, update);
    } catch (e) {
      // 200 anyway: Telegram would re-send the same update again and again.
      console.error('telegram update failed:', scrubError((e as Error)?.message ?? String(e)).slice(0, 300));
    }
  }
  return c.json({ ok: true });
});
