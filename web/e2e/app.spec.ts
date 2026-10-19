import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { expect, signIn, test } from './fixtures';

test('the production build loads its config, signs in and shows the dashboard', async ({ page }) => {
  const config = page.waitForRequest('**/config.json');
  await page.goto('/');
  await config;
  // Signed out: the app sends the visitor to the login page.
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: /Lan · PMO/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
  await expect(page.getByText('Cập nhật lúc 09/10 09:45')).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'Đang chạy' })).toContainText('7');
  await expect(page.getByRole('link', { name: 'P03 · Nâng cấp ERP' }).first()).toBeVisible();
  // The stylesheet is applied (status colours are not plain text).
  const red = page.locator('.badge.tone-red').first();
  await expect(red).toContainText('■ Đỏ');
  expect(await red.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test.describe('links opened directly and reloads', () => {
  test('signed in: deep links and F5 keep the page and the login', async ({ page }) => {
    await signIn(page, /An · PL/);
    await page.goto('/projects/P03');
    await expect(page.getByRole('heading', { name: 'P03 · Nâng cấp ERP' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'P03 · Nâng cấp ERP' })).toBeVisible();
    await expect(page.getByText('An · PL')).toBeVisible();
    await page.goto('/projects?q=kho');
    await expect(page.getByRole('heading', { name: 'Dự án' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'P03 · Nâng cấp ERP' })).toBeVisible();
  });

  test('signed out: a deep link comes back after signing in', async ({ page }) => {
    await page.goto('/projects/P06');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('button', { name: /Hùng · GL/ }).click();
    await expect(page).toHaveURL(/\/projects\/P06$/);
    await expect(page.getByRole('heading', { name: 'P06 · Chuyển đổi cloud' })).toBeVisible();
  });

  test('public pages open without signing in', async ({ page }) => {
    await page.goto('/public');
    await expect(page.getByRole('heading', { name: 'Tình hình dự án' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Tình hình dự án' })).toBeVisible();
    await page.goto('/help#cap-nhat');
    await expect(page.getByRole('heading', { name: /^6\. Cập nhật tình hình/ })).toBeInViewport();
  });
});

test('switching the language reloads in Japanese and stays so', async ({ page }) => {
  await signIn(page, /Lan · PMO/);
  await page.getByRole('button', { name: '日本語' }).click();
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ja');
  await page.getByRole('navigation').getByRole('link', { name: 'プロジェクト' }).click();
  await expect(page.getByRole('heading', { name: 'プロジェクト' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'プロジェクト' })).toBeVisible();
  // User-entered data is not translated.
  await expect(page.getByText('Nâng cấp ERP').first()).toBeVisible();
  await page.goto('/public');
  await expect(page.getByRole('heading', { name: 'プロジェクト状況' })).toBeVisible();
  await page.getByRole('button', { name: 'VI' }).click();
  await expect(page.getByRole('heading', { name: 'Tình hình dự án' })).toBeVisible();
});

/** Entry names and contents of a zip (stored or deflated entries, as the export writes). */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength);
    const data = buf.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    at += 30 + nameLength + extra + size;
  }
  return files;
}

test('"Xuất Excel" downloads a workbook with three sheets', async ({ page }) => {
  await signIn(page, /Lan · PMO/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Xuất Excel/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^project-tracker-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const parts = unzip(await readFile((await file.path())!));
  expect([...parts.keys()].filter((n) => n.startsWith('xl/worksheets/'))).toEqual([
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml',
    'xl/worksheets/sheet3.xml',
  ]);
  const sheetNames = [...parts.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  expect(sheetNames).toEqual(['Dự án', 'Vấn đề, sự kiện, mốc', 'Cập nhật 60 ngày']);
  expect(parts.get('xl/worksheets/sheet1.xml')).toContain('Nâng cấp ERP');
  await expect(page.getByRole('button', { name: /Xuất Excel/ })).toBeEnabled();
});
