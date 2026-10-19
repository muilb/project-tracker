import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscriptionId } from '../../../api/src/notify/push';
import { deviceLabel, forgetPushDevice, pushSupport, subscriptionIdOf } from '../../src/push';

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  operaAndroid:
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 OPR/90.0.0.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 16328.55.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

const setUserAgent = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Web Push in the browser', () => {
  it('names the device so the person recognises it', () => {
    expect({
      chromeWindows: deviceLabel(UA.chromeWindows),
      edgeWindows: deviceLabel(UA.edgeWindows),
      safariMac: deviceLabel(UA.safariMac),
      safariIphone: deviceLabel(UA.safariIphone),
      chromeIphone: deviceLabel(UA.chromeIphone),
      firefoxLinux: deviceLabel(UA.firefoxLinux),
      samsungAndroid: deviceLabel(UA.samsungAndroid),
      operaAndroid: deviceLabel(UA.operaAndroid),
      chromebook: deviceLabel(UA.chromebook),
      unknown: deviceLabel('curl/8.0'),
    }).toEqual({
      chromeWindows: 'Chrome · Windows',
      edgeWindows: 'Edge · Windows',
      safariMac: 'Safari · macOS',
      safariIphone: 'Safari · iPhone',
      chromeIphone: 'Chrome · iPhone',
      firefoxLinux: 'Firefox · Linux',
      samsungAndroid: 'Samsung Internet · Android',
      operaAndroid: 'Opera · Android',
      chromebook: 'Chrome · ChromeOS',
      unknown: 'Browser',
    });
  });

  it('an iPad asking for the desktop site is still an iPad', () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true }); // jsdom has none
    try {
      expect(deviceLabel(UA.safariMac)).toBe('Safari · iPad');
    } finally {
      delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
    }
  });

  it('computes the same device id as the API', async () => {
    for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc:def', 'https://web.push.apple.com/QWxhZGRpbg', 'x']) {
      expect(await subscriptionIdOf(endpoint)).toBe(subscriptionId(endpoint));
    }
  });

  it('iPhone in Safari: push needs the app on the Home Screen', () => {
    setUserAgent(UA.safariIphone);
    expect(pushSupport()).toBe('ios-home-screen');
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({ matches: q === '(display-mode: standalone)' }) as MediaQueryList);
    // Opened from the Home Screen: no longer the iOS hint (jsdom itself has no push support).
    expect(pushSupport()).toBe('unsupported');
  });

  it('signing out in a browser without push does nothing and never throws', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(forgetPushDevice()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
