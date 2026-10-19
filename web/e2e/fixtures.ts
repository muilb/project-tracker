// Shared setup: the app's /config.json (CDK writes it in production), the browser clock at the sample's
// "now", sign-in through the login page, and a check that a test left no console errors, uncaught
// exceptions or failed requests behind.
import { test as base, expect, type Page } from '@playwright/test';

/** The sample's "now" (2026-10-09 09:45 Vietnam time); the API clock starts there too (SAMPLE_NOW=1). */
export const NOW = new Date('2026-10-09T02:45:00Z');
/** The API itself, for setup and clean-up outside the browser. */
export const API = 'http://localhost:3101';

export const test = base.extend<{ problems: string[] }>({
  problems: async ({}, use) => use([]),
  page: async ({ page, problems }, use) => {
    await page.route('**/config.json', (route) => route.fulfill({ json: { apiUrl: '/api', devAuth: true } }));
    await page.clock.setFixedTime(NOW);
    page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
    page.on('requestfailed', (r) => {
      // Downloads and navigations away cancel requests; those are not failures.
      if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
    });
    page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`));
    await use(page);
    expect(problems, 'console errors, exceptions or failed requests').toEqual([]);
  },
});
export { expect };

/** Signs in with one of the local sample accounts on the login page ("lan" → "Lan · PMO"). */
export async function signIn(page: Page, button: RegExp) {
  await page.goto('/login');
  await page.getByRole('button', { name: button }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.locator('.brand')).toBeVisible();
}

/** Calls the API directly as `<user>@example.com`. */
export async function apiAs(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'x-dev-user': `${user}@example.com`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
