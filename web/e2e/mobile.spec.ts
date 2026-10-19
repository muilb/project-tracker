// Phone width (390 px): no page scrolls sideways, and the menu folds behind ☰.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from './fixtures';

async function noSideScroll(page: Page) {
  // Wait for the page's data, then compare the document's width to the screen's.
  await page.waitForLoadState('networkidle');
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${page.url()} is wider than the screen`).toBeLessThanOrEqual(client);
}

test('signed-in pages fit the screen', async ({ page }) => {
  await signIn(page, /Lan · PMO/);
  for (const [path, heading] of [
    ['/', 'Tổng quan'],
    ['/projects', 'Dự án'],
    ['/projects/P03', 'P03 · Nâng cấp ERP'],
    ['/projects/P03/edit', 'Sửa dự án P03'],
    ['/projects/new', 'Tạo dự án mới'],
    ['/me/notify', 'Thông báo của tôi'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await noSideScroll(page);
  }
});

test('public pages fit the screen', async ({ page }) => {
  for (const path of ['/public', '/help', '/login']) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await noSideScroll(page);
  }
});

test('the menu folds behind ☰ and closes after navigating', async ({ page }) => {
  await signIn(page, /An · PL/);
  const toggle = page.getByRole('button', { name: 'Menu' });
  const projects = page.getByRole('navigation').getByRole('link', { name: 'Dự án' });
  await expect(toggle).toBeVisible();
  await expect(projects).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(projects).toBeVisible();
  await projects.click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(projects).toBeHidden();
});
