// Web Push in the browser (track H): service worker, permission, this device's subscription.
import { api } from './api';
import { l } from './i18n';

/** Registered on every load so a subscription made earlier keeps working; the worker never caches. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('service worker', e));
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * 'ios-home-screen': iPhone / iPad only allow push for an app added to the Home Screen (iOS 16.4+)
 * and opened from there.
 */
export function pushSupport(): 'ok' | 'ios-home-screen' | 'unsupported' {
  if (isIos() && !isStandalone()) return 'ios-home-screen';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

export const permission = (): NotificationPermission => ('Notification' in window ? Notification.permission : 'default');

/** e.g. "Chrome · Windows", sent with the subscription so the person recognises the device. */
export function deviceLabel(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  return os ? `${browser} · ${os}` : browser;
}

/** Same id as the API (`subscriptionId` in api/src/notify/push.ts): sha-256 of the endpoint, 16 hex chars. */
export async function subscriptionIdOf(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/** This browser's subscription, if any (without registering anything). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Asks for permission (only ever called from a click), subscribes this browser and saves it.
 * `mine` = ids of the person's saved devices: a subscription of this browser that is not among
 * them (left by someone else on a shared computer) or made with another key is replaced.
 */
export async function enablePush(mine: string[]): Promise<NotificationPermission> {
  const result = await Notification.requestPermission();
  if (result !== 'granted') return result;
  const { publicKey } = await api.get<{ publicKey: string }>('/me/push/key');
  const key = keyBytes(publicKey);
  await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && (!sameKey(sub.options.applicationServerKey, key) || !mine.includes(await subscriptionIdOf(sub.endpoint)))) {
    await sub.unsubscribe();
    sub = null;
  }
  try {
    sub ??= await Promise.race([
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 20_000)),
    ]);
  } catch (e) {
    // e.g. private / incognito windows, or the browser's push service is unreachable.
    throw new Error(
      l(
        'Trình duyệt không đăng ký được nhận thông báo (cửa sổ ẩn danh, hoặc không kết nối được dịch vụ thông báo của trình duyệt). Hãy thử cửa sổ thường hoặc trình duyệt khác.',
        'ブラウザが通知の登録に失敗しました（シークレットウィンドウ、またはブラウザの通知サービスに接続できません）。通常のウィンドウか別のブラウザでお試しください。',
      ) + ` (${(e as Error).message})`,
    );
  }
  const json = sub.toJSON();
  await api.post('/me/push/subscriptions', { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() });
  return result;
}

/** Removes a saved device; when it is this browser, also unsubscribes it. */
export async function removeDevice(id: string) {
  await api.del(`/me/push/subscriptions/${id}`);
  const sub = await currentSubscription();
  if (sub && (await subscriptionIdOf(sub.endpoint)) === id) await sub.unsubscribe();
}

/** On sign-out: this browser stops receiving the person's notifications (shared computers). */
export async function forgetPushDevice() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    const id = await subscriptionIdOf(sub.endpoint);
    await Promise.race([api.del(`/me/push/subscriptions/${id}`).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await sub.unsubscribe();
  } catch (e) {
    console.warn('push sign-out', e);
  }
}
