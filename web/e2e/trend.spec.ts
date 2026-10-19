// Health trend: the dashboard's weekly counts and a project's calendar, from the sample's recorded days
// (the 27 days before the sample's "now", plus today's from the data); and the end-date warning.
import { apiAs, expect, signIn, test } from './fixtures';

test('the dashboard shows the weekly counts and who got worse or better', async ({ page }) => {
  await signIn(page, /Lan · PMO/);
  await page.goto('/?scope=all');
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Xu hướng 12 tuần' }) });
  const thisWeek = card.getByRole('row').filter({ hasText: 'Tuần này' });
  await expect(thisWeek.getByRole('cell')).toHaveText(['Tuần này', '', '1', '3', '3', '0']);
  await expect(card.getByRole('row')).toHaveCount(6); // header + 5 weeks since the history started
  const worse = card.locator('div').filter({ has: page.getByRole('heading', { name: 'Xấu đi so với tuần trước' }) }).last();
  await expect(worse.getByRole('listitem')).toHaveText([/P03 · Nâng cấp ERP.*Vàng.*Đỏ/, /P04 · Portal nội bộ.*Xanh.*Vàng/]);
  const better = card.locator('div').filter({ has: page.getByRole('heading', { name: 'Tốt lên so với tuần trước' }) }).last();
  await expect(better.getByRole('listitem')).toHaveText([/P06 · Chuyển đổi cloud.*Đỏ.*Vàng/]);
});

test('a project shows its colour per day; a tap shows the day', async ({ page }) => {
  await signIn(page, /Lan · PMO/);
  await page.goto('/projects/P03');
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Xu hướng màu 12 tuần' }) });
  // Today is picked first.
  await expect(card.locator('.trend-pick')).toContainText('T6 09/10: ■ Đỏ');
  await expect(card.locator('[data-date].tc-red')).toHaveCount(3);
  await expect(card.locator('[data-date].tc-yellow')).toHaveCount(25);
  await card.locator('[data-date="2026-10-06"]').click();
  await expect(card.locator('.trend-pick')).toContainText('T3 06/10: ▲ Vàng');
  await expect(card.locator('.trend-runs li')).toHaveText([/07\/10 → 09\/10.*Đỏ.*3 ngày/, /12\/09 → 06\/10.*Vàng.*25 ngày/]);
  await expect(card.getByText('Kết thúc dự kiến CN 15/11 · còn 37 ngày')).toBeVisible();
});

test('a running project past its end date is flagged on the dashboard and its page', async ({ page }) => {
  await signIn(page, /Lan · PMO/);
  const { project } = await apiAs('lan', 'GET', '/projects/P01');
  await apiAs('lan', 'PATCH', '/projects/P01', { endDate: '2026-10-06' });
  try {
    await page.goto('/?scope=all');
    await expect(page.locator('.kpi').filter({ hasText: 'Quá ngày kết thúc' })).toContainText('1');
    // P01 is green and on time: listed under "Cần chú ý" only for this, after the other projects.
    await page.getByRole('button', { name: /Xem thêm/ }).first().click();
    await expect(page.locator('.row').filter({ hasText: 'P01' })).toContainText('🏁 Quá ngày kết thúc 3 ngày');
    await page.goto('/projects/P01');
    await expect(page.getByText('🏁 Quá ngày kết thúc 3 ngày (kết thúc dự kiến T3 06/10)')).toBeVisible();
    // The calendar runs to the end date: the 🏁 cell is the 06/10 one.
    await expect(page.locator('[data-date="2026-10-06"]')).toHaveText('🏁');
  } finally {
    await apiAs('lan', 'PATCH', '/projects/P01', { endDate: project.endDate });
  }
});
