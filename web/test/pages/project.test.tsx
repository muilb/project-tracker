import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryStore } from '../../../api/src/store/memory';
import { NOW, renderApp, startApi } from '../harness';

let store: MemoryStore;
beforeEach(async () => {
  ({ store } = await startApi());
});

const fact = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!.textContent;
const historyCard = () => screen.getByRole('heading', { name: 'Lịch sử cập nhật' }).closest('section')!;
const historyTexts = () => [...historyCard().querySelectorAll('.history > li > p:first-of-type')].map((p) => p.textContent);
const itemsCard = () => screen.getByRole('heading', { name: 'Vấn đề · Sự kiện · Mốc' }).closest('section')!;
const itemTitles = () => [...itemsCard().querySelectorAll('tbody tr td:nth-child(2)')].map((td) => td.firstChild?.textContent);

describe('project page', () => {
  it('PL posts an update: it heads the history and sets the declared colour', async () => {
    const { user } = await renderApp('/projects/P01', 'an');
    expect(await screen.findByRole('heading', { name: 'P01 · Hệ thống quản lý kho' })).toBeInTheDocument();
    expect(fact('Trạng thái PL/GL khai')).toBe('Xanh');
    expect(screen.getByRole('link', { name: 'Sửa dự án' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Đỏ' }));
    await user.type(screen.getByRole('textbox', { name: 'Tình hình (1–3 dòng)' }), 'Khách đổi yêu cầu, trễ 1 tuần');
    await user.type(screen.getByRole('textbox', { name: 'Cần hỗ trợ / chỉ đạo (nếu có)' }), 'Cần GL họp với khách');
    await user.click(screen.getByRole('button', { name: 'Lưu cập nhật' }));

    await waitFor(() => expect(historyTexts()[0]).toBe('Khách đổi yêu cầu, trễ 1 tuần'));
    expect(fact('Trạng thái PL/GL khai')).toBe('Đỏ');
    expect(screen.getAllByText(/Cần GL họp với khách/).length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox', { name: 'Tình hình (1–3 dòng)' })).toHaveValue('');
    const saved = (await store.listUpdates('P01')).find((u) => u.summary.startsWith('Khách đổi'));
    expect(saved).toMatchObject({ author: 'an@example.com', authorRole: 'PL', health: 'red', needHelp: 'Cần GL họp với khách' });
  });

  it('the API message is shown when an update is refused', async () => {
    const { user } = await renderApp('/projects/P01', 'an');
    await user.type(await screen.findByRole('textbox', { name: 'Tình hình (1–3 dòng)' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Lưu cập nhật' }));
    expect(await screen.findByText(/Nội dung tình hình không được trống/)).toBeInTheDocument();
  });

  it('deleting my own update brings the colour back', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = await renderApp('/projects/P01', 'an');
    await user.click(await screen.findByRole('radio', { name: 'Vàng' }));
    await user.type(screen.getByRole('textbox', { name: 'Tình hình (1–3 dòng)' }), 'Tạm thời vàng');
    await user.click(screen.getByRole('button', { name: 'Lưu cập nhật' }));
    await waitFor(() => expect(fact('Trạng thái PL/GL khai')).toBe('Vàng'));

    // Only my update of today can be deleted by me.
    const rows = within(historyCard()).getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: 'Xoá' })).toBeInTheDocument();
    expect(rows.slice(1).every((li) => !within(li).queryByRole('button', { name: 'Xoá' }))).toBe(true);

    await user.click(within(rows[0]).getByRole('button', { name: 'Xoá' }));
    expect(await screen.findByText(/Đã xoá\. PMO \/ quản lý có thể khôi phục/)).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledWith('Xoá cập nhật này?');
    await waitFor(() => expect(fact('Trạng thái PL/GL khai')).toBe('Xanh'));
    expect(historyTexts()).not.toContain('Tạm thời vàng');
  });

  it('long histories load older updates page by page', async () => {
    for (let i = 0; i < 45; i++) {
      const at = new Date(NOW.getTime() - (i + 3) * 86_400_000).toISOString();
      await store.putUpdate({ id: `old${i}`, projectId: 'P01', at, author: 'an@example.com', authorRole: 'PL', summary: `Cũ ${i}` });
    }
    const { user } = await renderApp('/projects/P01', 'an');
    await screen.findByRole('heading', { name: /P01/ });
    const first = historyTexts();
    expect(first).toHaveLength(10);
    await user.click(within(historyCard()).getByRole('button', { name: 'Xem thêm' }));
    await waitFor(() => expect(historyTexts()).toHaveLength(30));
    await user.click(within(historyCard()).getByRole('button', { name: 'Xem thêm' }));
    await waitFor(() => expect(historyTexts()).toHaveLength(46)); // 45 + the sample's own
    expect(within(historyCard()).queryByRole('button', { name: 'Xem thêm' })).toBeNull();
    expect(new Set(historyTexts()).size).toBe(46);
    await user.click(within(historyCard()).getByRole('button', { name: 'Thu gọn' }));
    expect(historyTexts()).toEqual(first);
  });

  it('items: add one, close it, show closed ones', async () => {
    const { user } = await renderApp('/projects/P01', 'an');
    await screen.findByRole('heading', { name: /P01/ });
    expect(itemTitles()).toEqual(['Báo cáo tháng cho khách', 'Giao hàng phase 1']);

    await user.click(within(itemsCard()).getByRole('button', { name: '＋ Thêm' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Loại' }), 'Sự kiện');
    await user.type(screen.getByRole('textbox', { name: 'Nội dung' }), 'Demo cho khách');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ưu tiên' }), 'Cao');
    const date = screen.getByLabelText('Ngày diễn ra');
    expect(date).toHaveValue('2026-10-09'); // today in Vietnam
    await user.clear(date);
    await user.type(date, '2026-10-11');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Phụ trách' }), 'Hùng');
    await user.click(within(itemsCard()).getByRole('button', { name: 'Thêm' }));

    await waitFor(() => expect(itemTitles()).toEqual(['Demo cho khách', 'Báo cáo tháng cho khách', 'Giao hàng phase 1']));
    const row = screen.getByText('Demo cho khách').closest('tr')!;
    expect(row).toHaveTextContent('Sự kiện');
    expect(row).toHaveTextContent('Cao');
    expect(row).toHaveTextContent('CN 11/10');
    expect(row).toHaveTextContent('Còn 2 ngày');
    expect(row).toHaveTextContent('Hùng');

    await user.selectOptions(within(row).getByRole('combobox', { name: 'Trạng thái' }), 'Xong');
    await waitFor(() => expect(itemTitles()).not.toContain('Demo cho khách'));
    await user.click(screen.getByRole('checkbox', { name: /Hiện mục đã xong \/ hoãn/ }));
    expect(itemTitles()).toContain('Demo cho khách');
    expect(itemTitles()).toContain('Thiếu dữ liệu mẫu từ khách'); // done in the sample
    const items = await store.listItems('P01');
    expect(items.find((i) => i.title === 'Demo cho khách')).toMatchObject({
      type: 'event',
      priority: 'high',
      date: '2026-10-11',
      owner: 'hung@example.com',
      status: 'done',
    });
  });
});

describe('who sees what', () => {
  it('a supporter (OTHER) can report but not edit the project', async () => {
    await renderApp('/projects/P01', 'phuc');
    await screen.findByRole('heading', { name: /P01/ });
    expect(screen.queryByRole('link', { name: 'Sửa dự án' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu cập nhật' })).toBeInTheDocument();
  });

  it('OTHER cannot open a project they do not take part in', async () => {
    await renderApp('/projects/P03', 'phuc');
    expect(await screen.findByText(/^⚠/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /P03/ })).toBeNull();
    expect(document.body).not.toHaveTextContent('Nâng cấp ERP');
  });

  it('PMO can delete any update', async () => {
    await renderApp('/projects/P03', 'mai');
    await screen.findByRole('heading', { name: /P03/ });
    const rows = within(historyCard()).getAllByRole('listitem');
    expect(rows.length).toBe(4);
    expect(rows.every((li) => within(li).queryByRole('button', { name: 'Xoá' }))).toBe(true);
  });
});
