// The web in Japanese: labels from l(), and the API answers in the same language.
import { screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => localStorage.setItem('lang', 'ja'));

import { renderApp, startApi } from '../harness';

let requests: { path: string; headers: Record<string, string> }[];
beforeEach(async () => {
  ({ requests } = await startApi());
  localStorage.setItem('lang', 'ja');
});

it('dashboard in Japanese', async () => {
  await renderApp('/', 'lan');
  expect(await screen.findByRole('heading', { name: 'ダッシュボード' })).toBeInTheDocument();
  expect(await screen.findByText('要注意')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '日本語' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('赤').length).toBeGreaterThan(0);
  // User-entered data is never translated.
  expect(screen.getAllByRole('link', { name: 'P03 · Nâng cấp ERP' }).length).toBeGreaterThan(0);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((r) => r.headers['accept-language'] === 'ja')).toBe(true);
});

it('API errors come back in Japanese', async () => {
  const { user } = await renderApp('/projects/P01', 'an');
  await user.type(await screen.findByRole('textbox', { name: '状況（1〜3 行）' }), '   ');
  await user.click(screen.getByRole('button', { name: '報告を保存' }));
  expect(await screen.findByText(/状況の内容を入力してください/)).toBeInTheDocument();
});

it('a project the person may not see: the refusal is in Japanese too', async () => {
  await renderApp('/projects/P03', 'phuc');
  const box = await screen.findByText(/^⚠/);
  expect(box.textContent).toMatch(/[぀-ヿ一-鿿]/);
  expect(box.textContent).not.toMatch(/[ăâđêôơư]/i);
});
