import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryStore } from '../../../api/src/store/memory';
import { vnToIso } from '../../../api/src/time';
import { renderApp, startApi } from '../harness';

let store: MemoryStore;
let requests: { method: string; path: string }[];
beforeEach(async () => {
  ({ store, requests } = await startApi());
});

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;
const rowTexts = (section: HTMLElement) =>
  within(section)
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));

describe('dashboard trend', () => {
  it('weekly counts, newest first, and the projects that changed since last week', async () => {
    await renderApp('/?scope=all', 'lan');
    await screen.findByRole('heading', { name: 'Xu hướng 12 tuần' });
    const trend = card('Xu hướng 12 tuần');
    await waitFor(() => expect(within(trend).getAllByRole('row')).toHaveLength(6));
    expect(rowTexts(trend)[0]).toEqual(['Tuần này', '', '1', '3', '3', '0']);
    expect(rowTexts(trend)[3]).toEqual(['14/09 – 20/09', '', '0', '1', '5', '1']);
    const worse = screen.getByRole('heading', { name: 'Xấu đi so với tuần trước' }).parentElement!;
    expect(within(worse).getAllByRole('link').map((a) => a.textContent)).toEqual(['P03 · Nâng cấp ERP', 'P04 · Portal nội bộ']);
    const better = screen.getByRole('heading', { name: 'Tốt lên so với tuần trước' }).parentElement!;
    expect(within(better).getAllByRole('link').map((a) => a.textContent)).toEqual(['P06 · Chuyển đổi cloud']);
  });

  it('follows the dashboard filters', async () => {
    const { user } = await renderApp('/?scope=all', 'lan');
    await screen.findByRole('heading', { name: 'Xu hướng 12 tuần' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc theo GL' }), 'tuan@example.com');
    await waitFor(() => expect(requests.map((r) => r.path)).toContain('/dashboard/trend?scope=all&gl=tuan%40example.com'));
    await waitFor(() => expect(rowTexts(card('Xu hướng 12 tuần'))[0]).toEqual(['Tuần này', '', '0', '1', '1', '0']));
  });

  it('says so before anything was recorded', async () => {
    store.healthDays.clear();
    await renderApp('/', 'lan');
    expect(await screen.findByText(/Chưa có dữ liệu\. Màu của dự án được ghi lại mỗi giờ/)).toBeInTheDocument();
  });
});

describe('project trend', () => {
  it('a calendar of the recorded days; a click shows what made the colour', async () => {
    const { user } = await renderApp('/projects/P03', 'lan');
    await screen.findByRole('heading', { name: 'Xu hướng màu 12 tuần' });
    const trend = card('Xu hướng màu 12 tuần');
    await waitFor(() => expect(trend.querySelectorAll('[data-date]')).toHaveLength(28));
    expect(trend.querySelector('.trend-pick')!.textContent).toMatch(/^T6 09\/10: ■ Đỏ PL\/GL: Đỏ · PMO: Đỏ · 1 mục quá hạn/);
    await user.click(trend.querySelector('[data-date="2026-09-20"]')!);
    expect(trend.querySelector('.trend-pick')!.textContent).toBe('CN 20/09: ▲ Vàng PL/GL: Vàng · PMO: —');
    expect(within(trend).getByText('Có dữ liệu từ 12/09.')).toBeInTheDocument();
    expect([...trend.querySelectorAll('.trend-runs li')].map((li) => li.textContent)).toEqual([
      '07/10 → 09/10■ Đỏ3 ngày',
      '12/09 → 06/10▲ Vàng25 ngày',
    ]);
    // Older days do not exist: no "show all".
    expect(within(trend).queryByRole('button', { name: 'Xem toàn bộ' })).toBeNull();
  });

  it('paused days are grey with their own symbol', async () => {
    await renderApp('/projects/P05', 'lan');
    await screen.findByRole('heading', { name: 'Xu hướng màu 12 tuần' });
    const trend = card('Xu hướng màu 12 tuần');
    await waitFor(() => expect(trend.querySelectorAll('.tc-paused[data-date]')).toHaveLength(7));
    expect([...trend.querySelectorAll('.trend-runs li')].map((li) => li.textContent)).toContain('17/09 → 23/09‖ Tạm dừng7 ngày');
  });

  it('"show all" when older days exist', async () => {
    const mark = { state: 'active' as const, health: 'green' as const, overdueItems: 0, lateHours: 0 };
    await store.putHealthDay({ date: '2026-07-18', at: vnToIso('2026-07-18 23:00'), projects: { P03: mark } });
    await store.putHealthDay({ date: '2026-06-01', at: vnToIso('2026-06-01 23:00'), projects: { P03: mark } });
    const { user } = await renderApp('/projects/P03', 'lan');
    await user.click(await screen.findByRole('button', { name: 'Xem toàn bộ' }));
    expect(await screen.findByRole('heading', { name: 'Xu hướng màu (toàn bộ)' })).toBeInTheDocument();
    expect(requests.map((r) => r.path)).toContain('/projects/P03/trend?all=1');
    await waitFor(() => expect(card('Xu hướng màu (toàn bộ)').querySelector('[data-date="2026-06-01"]')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: '12 tuần gần nhất' }));
    expect(await screen.findByRole('heading', { name: 'Xu hướng màu 12 tuần' })).toBeInTheDocument();
  });
});

describe('end date', () => {
  const setEnd = async (id: string, endDate: string) => store.putProject({ ...(await store.getProject(id))!, endDate });

  it('the dashboard lists the projects ending soon and counts those past their end', async () => {
    await setEnd('P07', '2026-10-19');
    await setEnd('P01', '2026-10-06');
    await renderApp('/?scope=all', 'lan');
    const soon = (await screen.findByRole('heading', { name: 'Sắp kết thúc (14 ngày tới)' })).closest('section')!;
    expect(within(soon).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['T2 19/10Còn 10 ngày🏁P07 · Web thương mại● Xanh']);
    expect(screen.getByText('🏁 Quá ngày kết thúc').closest('.kpi')!.textContent).toBe('🏁 Quá ngày kết thúc1');
  });

  it('the project page warns when running past the end; the calendar runs to a close end date', async () => {
    await setEnd('P01', '2026-10-06');
    await setEnd('P02', '2026-10-20');
    const past = await renderApp('/projects/P01', 'lan');
    expect(await screen.findByText('🏁 Quá ngày kết thúc 3 ngày (kết thúc dự kiến T3 06/10)')).toBeInTheDocument();
    expect(screen.getByText('🏁 Quá ngày kết thúc 3 ngày')).toHaveClass('warn');
    past.unmount();

    await renderApp('/projects/P02', 'lan');
    expect(await screen.findByText('🏁 Kết thúc dự kiến T3 20/10 · còn 11 ngày')).toBeInTheDocument();
    const trend = card('Xu hướng màu 12 tuần');
    await waitFor(() => expect(trend.querySelector('.tc-future[data-date="2026-10-20"]')?.textContent).toBe('🏁'));
    expect(trend.querySelectorAll('.tc-future[data-date]')).toHaveLength(11); // 10/10 to 20/10
  });
});
