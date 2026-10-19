import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XLSX_TYPE } from '../../../api/src/export/xlsx';
import type { Dashboard } from '../../src/types';
import { renderApp, startApi } from '../harness';

let requests: { path: string }[];
beforeEach(async () => {
  ({ requests } = await startApi());
});

/** The number on the KPI tile whose label is `label`. */
function kpi(label: string) {
  const tile = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.kpi-label')?.textContent?.trim() === label);
  if (!tile) throw new Error(`no KPI "${label}"`);
  return Number(tile.querySelector('.kpi-value')!.textContent);
}
const projectLinks = () =>
  screen
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'))
    .filter((h) => /^\/projects\/P\d+$/.test(h ?? ''));
const asApi = async (path: string, user: string) =>
  (await fetch(`/api${path}`, { headers: { 'x-dev-user': `${user}@example.com` } })).json() as Promise<Dashboard>;

describe('dashboard', () => {
  it('PMO: every project, the same numbers as the API', async () => {
    const { user } = await renderApp('/', 'lan');
    await screen.findByText('Cần chú ý');
    const data = await asApi('/dashboard?scope=all', 'lan');
    expect(requests.some((r) => r.path === '/dashboard?scope=all')).toBe(true);
    expect({
      active: kpi('Đang chạy'),
      red: kpi('Đỏ'),
      yellow: kpi('Vàng'),
      green: kpi('Xanh'),
      late: kpi('⏰ Trễ cập nhật'),
      high: kpi('▲ Vấn đề ưu tiên cao'),
      overdue: kpi('⚠ Mục quá hạn'),
    }).toEqual({
      active: data.kpis.active,
      red: data.kpis.red,
      yellow: data.kpis.yellow,
      green: data.kpis.green,
      late: data.kpis.lateUpdates,
      high: data.kpis.highIssues,
      overdue: data.kpis.overdueItems,
    });
    expect(data.kpis.active).toBe(7);

    // "Cần chú ý" lists the API's order, 5 at a time.
    const attention = screen.getByRole('heading', { name: 'Cần chú ý' }).closest('section')!;
    const ids = () => within(attention).getAllByRole('link').map((a) => a.getAttribute('href')!.split('/').pop());
    expect(ids()).toEqual(data.attention.slice(0, 5).map((p) => p.id));
    await user.click(within(attention).getByRole('button', { name: `Xem thêm (còn ${data.attention.length - 5})` }));
    await waitFor(() => expect(ids()).toEqual(data.attention.map((p) => p.id)));
  });

  it('PL: starts on their own projects; "Tất cả" and the GL filter go to the API', async () => {
    const { user } = await renderApp('/', 'an');
    await screen.findByText('Cần chú ý');
    expect(requests.map((r) => r.path)).toContain('/dashboard?scope=mine');
    expect(kpi('Đang chạy')).toBe(1); // An is PL of P01 only

    await user.click(screen.getByRole('button', { name: 'Tất cả' }));
    await waitFor(() => expect(kpi('Đang chạy')).toBe(7));
    expect(requests.map((r) => r.path)).toContain('/dashboard?scope=all');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc theo GL' }), 'GL Sơn');
    await waitFor(() => expect(kpi('Đang chạy')).toBe(2)); // P03, P04
    expect(requests.map((r) => r.path)).toContain('/dashboard?scope=all&gl=son%40example.com');
    expect(new Set(projectLinks())).toEqual(new Set(['/projects/P03', '/projects/P04']));
  });

  it('OTHER: only the projects they take part in, no scope choice, cannot create projects', async () => {
    await renderApp('/', 'phuc'); // supporter of P01 and P04
    await screen.findByText('Cần chú ý');
    expect(screen.getByText(/Chỉ hiện dự án bạn tham gia/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tất cả' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Tạo dự án/ })).toBeNull();
    expect(kpi('Đang chạy')).toBe(2);
    expect(projectLinks().every((h) => h === '/projects/P01' || h === '/projects/P04')).toBe(true);
  });

  it('"Xuất Excel" downloads the workbook with the login', async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:export'));
    URL.revokeObjectURL = vi.fn();
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    const { user } = await renderApp('/', 'lan');
    await user.click(await screen.findByRole('button', { name: /Xuất Excel/ }));
    await waitFor(() => expect(saved).toEqual([expect.stringMatching(/^project-tracker-\d{4}-\d{2}-\d{2}\.xlsx$/)]));
    expect(blobs[0].type).toBe(XLSX_TYPE);
    expect(new TextDecoder().decode((await blobs[0].arrayBuffer()).slice(0, 2))).toBe('PK');
    expect(screen.getByRole('button', { name: /Xuất Excel/ })).toBeEnabled();
  });
});

describe('menu', () => {
  const menu = async () => {
    const nav = await screen.findByRole('navigation');
    return within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent!.replace(/\d+$/, '').trim());
  };

  it('PL: no user management or settings', async () => {
    await renderApp('/', 'an');
    expect(await menu()).toEqual(['Tổng quan', 'Dự án', '✦ AI', 'Kênh thông báo', 'Thông báo của tôi', 'Trang public ↗', 'Hướng dẫn']);
    expect(screen.getByText('An · PL')).toBeInTheDocument();
  });

  it('PMO: users (with the sign-ups waiting) and settings', async () => {
    await renderApp('/', 'lan');
    const items = await menu();
    expect(items).toContain('Người dùng');
    expect(items).toContain('Cài đặt');
  });

  it('signing out goes back to the login page', async () => {
    const { user } = await renderApp('/', 'an');
    await user.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('button', { name: /Lan · PMO/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
