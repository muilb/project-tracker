// The production build as it is served: security headers, the service worker under them, and pages
// loaded on first visit (code splitting), including a tab left open across a deploy.
import { expect, signIn, test } from './fixtures';

test('security headers are sent and the app works under them', async ({ page }) => {
  const res = await page.goto('/login');
  const headers = res!.headers();
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('microphone=(self)');
  // The Web Push service worker and the manifest are allowed (worker-src / manifest-src).
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active)).toBe(true);
  expect((await page.request.get('/manifest.webmanifest')).ok()).toBe(true);
});

test('seldom-used pages load on first visit', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (r) => r.resourceType() === 'script' && scripts.push(new URL(r.url()).pathname));
  await signIn(page, /Lan · PMO/);
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
  expect(scripts.some((s) => /\/Settings-/.test(s))).toBe(false);
  await page.getByRole('navigation').getByRole('link', { name: 'Cài đặt' }).click();
  await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible();
  expect(scripts.some((s) => /\/Settings-/.test(s))).toBe(true);
});

test('a tab opened before a deploy reloads instead of failing', async ({ page, problems }) => {
  await signIn(page, /An · PL/);
  // The old version's file is gone after the deploy: the first request for it fails.
  let failed = 0;
  await page.route('**/assets/Help-*.js', (route) => (failed++ === 0 ? route.abort() : route.continue()));
  const reloaded = page.waitForEvent('load');
  await page.getByRole('navigation').getByRole('link', { name: 'Hướng dẫn' }).click();
  await reloaded;
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { name: 'Hướng dẫn sử dụng' })).toBeVisible();
  expect(failed).toBe(2);
  // The failed request and its error are what this test sets up.
  problems.splice(0, problems.length, ...problems.filter((p) => !/Help-|net::ERR_FAILED/.test(p)));
});
