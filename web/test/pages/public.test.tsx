import { screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import type { MemoryStore } from '../../../api/src/store/memory';
import { URGENCY_LABEL } from '../../src/labels';
import { renderApp, startApi } from '../harness';

let store: MemoryStore;
let requests: { path: string; headers: Record<string, string> }[];
beforeEach(async () => {
  ({ store, requests } = await startApi());
});

it('the public page shows the status without login, and nothing private', async () => {
  await renderApp('/public');
  expect(await screen.findByRole('heading', { name: 'Tình hình dự án' })).toBeInTheDocument();
  expect(await screen.findByText('Dự án khẩn cấp / cần chú ý')).toBeInTheDocument();
  expect(requests.map((r) => r.path)).toEqual(['/public']);
  expect(requests[0].headers).not.toHaveProperty('x-dev-user');

  // CLAUDE.md: never customers, people, needHelp or issue text.
  const snap = await store.snapshot();
  // "Bình thường" (normal) is a label, not the PL Bình.
  const text = document.body.textContent!.replaceAll(URGENCY_LABEL.normal, '');
  const secrets = [
    ...snap.projects.map((p) => p.customer),
    ...snap.users.flatMap((u) => [u.id, u.name]).filter((s) => s.length > 3),
    ...snap.updates.flatMap((u) => [u.summary, u.needHelp]),
    ...snap.items.filter((i) => i.type === 'issue').flatMap((i) => [i.title, i.note]),
  ].filter((s): s is string => !!s);
  expect(secrets.length).toBeGreaterThan(30);
  expect(secrets.filter((s) => text.includes(s))).toEqual([]);
  // Events and milestones are public.
  expect(text).toContain('Release batch mới');
});

it('signed-out visitors of internal pages land on the login page', async () => {
  await renderApp('/projects');
  expect(await screen.findByRole('button', { name: /Lan · PMO/ })).toBeInTheDocument();
  expect(requests).toEqual([]);
});
