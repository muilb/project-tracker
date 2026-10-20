// Comments: Lan (PMO) asks Hùng (GL) under An's update with "@"; Hùng finds it in 🔔 and lands on the thread.
import { apiAs, expect, signIn, test } from './fixtures';

test('a mention reaches the person, whose 🔔 opens the thread', async ({ page }) => {
  await signIn(page, /Lan · PMO/);
  await page.goto('/projects/P01');
  const update = page.locator('.history > li').filter({ hasText: 'Test tích hợp module nhập kho' });
  await update.getByRole('button', { name: 'Bình luận' }).click();
  const box = update.getByRole('combobox', { name: 'Bình luận' });
  await box.pressSequentially('@hu');
  await expect(update.getByRole('option')).toHaveText(['Hùng GL']);
  await box.press('Enter');
  await box.pressSequentially('duyệt thêm 1 tester được không?');
  await update.getByRole('button', { name: 'Gửi' }).click();
  await expect(update.locator('.comment-text')).toHaveText('@Hùng duyệt thêm 1 tester được không?');
  await expect(update.getByRole('button', { name: 'Bình luận (1)' })).toBeVisible();

  try {
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await signIn(page, /Hùng · GL/);
    await page.getByRole('button', { name: /Thông báo \(1 chưa đọc\)/ }).click();
    const entry = page.getByRole('dialog', { name: 'Thông báo' }).getByText('💬 Lan nhắc đến bạn – P01 · Hệ thống quản lý kho');
    await entry.click();
    await expect(page).toHaveURL(/\/projects\/P01#update-/);
    await expect(page.locator('.comment-text')).toHaveText('@Hùng duyệt thêm 1 tester được không?');
  } finally {
    const { comments } = await apiAs('lan', 'GET', '/projects/P01/comments');
    for (const c of comments) await apiAs('lan', 'DELETE', `/projects/P01/comments/${c.id}`);
  }
});
