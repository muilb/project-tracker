// Web Push (track H): VAPID keys, the notification payload, and delivery to one browser / phone.
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { Store } from '../store/store.js';
import type { PushConfig, PushSubscriptionRecord } from '../types.js';
import type { NotifyDeps } from './deps.js';
import { PermanentDeliveryError, scrubError } from './errors.js';
import type { Message } from './message.js';

/** What the push service needs to deliver one payload (tests pass a fake). */
export interface PushRequest {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: string;
  vapid: { subject: string; publicKey: string; privateKey: string };
  /** Seconds the push service keeps the message for an offline device. */
  ttl: number;
  urgency: 'normal' | 'high';
}

/** Sends one encrypted, VAPID-signed message; throws PushHttpError when the push service refuses. */
export type PushSender = (req: PushRequest) => Promise<void>;

export class PushHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const webPushSender: PushSender = async (req) => {
  try {
    await webpush.sendNotification(req.subscription, req.payload, {
      vapidDetails: req.vapid,
      TTL: req.ttl,
      urgency: req.urgency,
      timeout: 10_000,
    });
  } catch (e) {
    if (e instanceof webpush.WebPushError) throw new PushHttpError(e.statusCode, `HTTP ${e.statusCode} ${e.body ?? ''}`.trim());
    throw e;
  }
};

/** Push services of the browsers that support Web Push; anything else is refused (the API posts to it). */
const PUSH_HOSTS = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Stable id of a subscription: the same browser subscribing again replaces its row. */
export const subscriptionId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 16);

/** The VAPID keys, generated and stored on first need. */
export async function pushConfig(store: Store, now: Date): Promise<PushConfig> {
  const saved = await store.getPushConfig();
  if (saved) return saved;
  const keys = webpush.generateVAPIDKeys();
  return store.initPushConfig({ ...keys, createdAt: now.toISOString() });
}

/** Browsers drop payloads over ~4 KB (after encryption); stay well below. */
export const MAX_PAYLOAD_BYTES = 3000;
const PUSH_LINES = 4;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plain = (s: string) => s.replace(/\*\*/g, '');

/** What the service worker (web/public/sw.js) shows: title, the first lines, link, tag per project. */
export function pushPayload(message: Message, opts: { projectId?: string; event: string }): string {
  const main = message.lines.filter((x) => !x.subtle);
  const lines = (main.length ? main : message.lines).map((x) => plain(x.text));
  const body = { title: clip(plain(message.title), 120), body: clip(lines.slice(0, PUSH_LINES).join('\n'), 500) };
  const data = {
    ...body,
    url: message.link?.url,
    // A newer message about the same project replaces the older one in the notification list.
    tag: opts.projectId ? `project-${opts.projectId}` : opts.event,
  };
  let json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX_PAYLOAD_BYTES) json = JSON.stringify({ ...data, body: clip(body.body, 120) });
  return json;
}

/** VAPID "subject": the app's https URL (push services contact it about problems). */
const subject = (deps: NotifyDeps) =>
  deps.webUrl?.startsWith('https://') ? deps.webUrl : 'mailto:noreply@example.com';

/**
 * Sends one message to one browser / phone and records the outcome on the subscription.
 * 404 / 410 (unsubscribed or expired) delete the subscription; those and other 4xx are permanent
 * (no retry). 429, 5xx and network errors are thrown as-is, so deliver.ts retries them.
 */
export async function pushTo(deps: NotifyDeps, sub: PushSubscriptionRecord, message: Message, now: Date, event: string, projectId?: string) {
  const vapid = await pushConfig(deps.store, now);
  try {
    await (deps.push ?? webPushSender)({
      subscription: { endpoint: sub.endpoint, keys: sub.keys },
      payload: pushPayload(message, { projectId, event }),
      vapid: { subject: subject(deps), publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      ttl: 24 * 3600,
      urgency: message.tone === 'attention' ? 'high' : 'normal',
    });
  } catch (e) {
    const status = e instanceof PushHttpError ? e.status : 0;
    const error = scrubError((e as Error).message ?? String(e)).slice(0, 300);
    if (status === 404 || status === 410) {
      await deps.store.deletePushSubscription(sub.userId, sub.id);
      throw new PermanentDeliveryError(`Push subscription gone (HTTP ${status}), removed`);
    }
    await deps.store.putPushSubscription({ ...sub, lastError: error });
    if (status >= 400 && status < 500 && status !== 429) throw new PermanentDeliveryError(error);
    throw e;
  }
  await deps.store.putPushSubscription({ ...sub, lastSentAt: now.toISOString(), lastError: undefined });
}
