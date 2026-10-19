// A PL's daily round trip: report red on the project page, see it on the dashboard and the public page.
import { apiAs, expect, signIn, test } from './fixtures';

test('a red update reaches the dashboard and the public page', async ({ page }) => {
  await page.goto('/public');
  const urgent = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Dự án khẩn cấp / cần chú ý' }) });
  const publicP01 = urgent.locator('li').filter({ hasText: 'P01' });
  await expect(page.getByRole('heading', { name: 'Tình hình dự án' })).toBeVisible();
  await expect(publicP01).toHaveCount(0); // green and on time: not on the public "urgent" list

  await signIn(page, /An · PL/);
  await page.getByRole('navigation').getByRole('link', { name: 'Dự án' }).click();
  await page.getByRole('link', { name: /P01/ }).first().click();
  await expect(page.getByRole('heading', { name: 'P01 · Hệ thống quản lý kho' })).toBeVisible();
  await page.getByRole('radio', { name: 'Đỏ' }).check();
  await page.getByRole('textbox', { name: 'Tình hình (1–3 dòng)' }).fill('Khách dừng UAT, cần họp gấp');
  await page.getByRole('textbox', { name: 'Cần hỗ trợ / chỉ đạo (nếu có)' }).fill('GL họp với khách trong tuần');
  await page.getByRole('button', { name: 'Lưu cập nhật' }).click();
  await expect(page.locator('.history li').first()).toContainText('Khách dừng UAT, cần họp gấp');
  await expect(page.locator('.badges')).toContainText('■ Đỏ');
  await expect(page.locator('.badges')).toContainText('■ Khẩn cấp');

  try {
    await page.getByRole('navigation').getByRole('link', { name: 'Tổng quan' }).click();
    const attention = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Cần chú ý' }) });
    const row = attention.locator('.row').filter({ hasText: 'P01' });
    await expect(row).toContainText('■ Đỏ');
    await expect(row).toContainText('Khách dừng UAT, cần họp gấp');
    await expect(row).toContainText('🙋 GL họp với khách trong tuần');

    await page.goto('/public');
    await expect(publicP01).toHaveCount(1);
    await expect(publicP01).toContainText('Khẩn cấp');
    // The public page never shows what was written.
    await expect(page.locator('body')).not.toContainText('Khách dừng UAT');
    await expect(page.locator('body')).not.toContainText('GL họp với khách');
  } finally {
    // One API process serves every test: take the update back out.
    const { updates } = await apiAs('an', 'GET', '/projects/P01');
    const mine = updates.find((u: { summary: string }) => u.summary === 'Khách dừng UAT, cần họp gấp');
    if (mine) await apiAs('an', 'DELETE', `/projects/P01/updates/${mine.id}`);
  }
});
