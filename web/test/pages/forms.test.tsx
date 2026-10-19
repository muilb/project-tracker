import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryStore } from '../../../api/src/store/memory';
import { renderApp, startApi } from '../harness';

let store: MemoryStore;
beforeEach(async () => {
  ({ store } = await startApi());
});

describe('project form', () => {
  it('GL creates a project: they are its GL, the code is generated, the page opens', async () => {
    const { user } = await renderApp('/projects/new', 'hung');
    expect(await screen.findByRole('heading', { name: 'Tạo dự án mới' })).toBeInTheDocument();
    // The people lists arrive after the form.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'GL' })).toHaveDisplayValue('Hùng (hung@example.com)'));
    await user.type(screen.getByRole('textbox', { name: 'Tên dự án *' }), 'Cổng thanh toán');
    await user.type(screen.getByRole('textbox', { name: 'Khách hàng' }), 'KH G');
    await user.selectOptions(screen.getByRole('combobox', { name: 'PL' }), 'binh@example.com');
    await user.click(screen.getByRole('checkbox', { name: /^Quang/ }));
    await user.click(screen.getByRole('button', { name: 'Tạo dự án' }));

    expect(await screen.findByRole('heading', { name: 'P08 · Cổng thanh toán' })).toBeInTheDocument();
    expect(await store.getProject('P08')).toMatchObject({
      name: 'Cổng thanh toán',
      customer: 'KH G',
      gl: 'hung@example.com',
      pl: 'binh@example.com',
      supporters: ['quang@example.com'],
      publicVisible: true,
    });
  });

  it('a code already in use is refused with the API message', async () => {
    const { user } = await renderApp('/projects/new', 'hung');
    await user.type(await screen.findByRole('textbox', { name: 'Mã dự án' }), 'P01');
    await user.type(screen.getByRole('textbox', { name: 'Tên dự án *' }), 'Trùng mã');
    await user.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    expect(await screen.findByText(/P01/, { selector: '.error-box' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tạo dự án mới' })).toBeInTheDocument();
    expect((await store.getProject('P01'))?.name).toBe('Hệ thống quản lý kho');
  });

  it('PL edits their project', async () => {
    const { user } = await renderApp('/projects/P01/edit', 'an');
    const name = await screen.findByRole('textbox', { name: 'Tên dự án *' });
    await waitFor(() => expect(name).toHaveValue('Hệ thống quản lý kho'));
    expect(screen.queryByRole('textbox', { name: 'Mã dự án' })).toBeNull();
    await user.clear(name);
    await user.type(name, 'Hệ thống kho v2');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByRole('heading', { name: 'P01 · Hệ thống kho v2' })).toBeInTheDocument();
  });

  it('OTHER cannot create projects: the API says why', async () => {
    const { user } = await renderApp('/projects/new', 'phuc');
    await user.type(await screen.findByRole('textbox', { name: 'Tên dự án *' }), 'Dự án lạ');
    await user.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    expect(await screen.findByText(/^⚠/, { selector: '.error-box' })).toBeInTheDocument();
    expect((await store.snapshot()).projects.some((p) => p.name === 'Dự án lạ')).toBe(false);
  });
});

describe('sign-in (local dev accounts)', () => {
  it('a page opened while signed out comes back after signing in', async () => {
    const { user } = await renderApp('/projects/P03');
    await user.click(await screen.findByRole('button', { name: /Lan · PMO/ }));
    expect(await screen.findByRole('heading', { name: 'P03 · Nâng cấp ERP' })).toBeInTheDocument();
    expect(screen.getByText('Lan · PMO')).toBeInTheDocument();
  });
});
