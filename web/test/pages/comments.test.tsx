import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryStore } from '../../../api/src/store/memory';
import type { Update } from '../../../api/src/types';
import { renderApp, startApi } from '../harness';

let store: MemoryStore;
let requests: { method: string; path: string }[];
/** P03's update by Cường (PL). */
let update: Update;
beforeEach(async () => {
  ({ store, requests } = await startApi());
  update = (await store.listUpdates('P03')).find((u) => u.author === 'cuong@example.com')!;
});

/** The element with this id, once the page has drawn it. */
const byId = (id: string) =>
  waitFor(() => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not there yet`);
    return el;
  });
const historyItem = (u: Update) => byId(`update-${u.id}`);
const comments = () => [...document.querySelectorAll('.comment-list > li .comment-text')].map((p) => p.textContent);

describe('comments under an update', () => {
  it('"@" lists people; the picked one is saved as a mention and told', async () => {
    const { user } = await renderApp('/projects/P03', 'minh');
    await screen.findByRole('heading', { name: 'P03 · Nâng cấp ERP' });
    const li = await historyItem(update);
    await user.click(within(li).getByRole('button', { name: 'Bình luận' }));
    const box = within(li).getByRole('combobox', { name: 'Bình luận' });
    await user.type(box, 'Hỏi @so');
    const options = within(li).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Sơn GL']);
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('Hỏi @Sơn ');
    await user.type(box, 'mượn dev Java được không?');
    await user.click(within(li).getByRole('button', { name: 'Gửi' }));

    await waitFor(() => expect(comments()).toEqual(['Hỏi @Sơn mượn dev Java được không?']));
    expect(li.querySelector('.mention')?.textContent).toBe('@Sơn');
    expect(box).toHaveValue('');
    expect(within(li).getByRole('button', { name: 'Bình luận (1)' })).toHaveAttribute('aria-expanded', 'true');
    const [saved] = await store.listComments('P03');
    expect(saved).toMatchObject({ text: 'Hỏi @{son@example.com} mượn dev Java được không?', mentions: ['son@example.com'] });
    expect((await store.listInbox('son@example.com', 5)).map((e) => e.event)).toEqual(['mentioned']);
  });

  it('diacritics do not matter when looking for a name; a click picks', async () => {
    const { user } = await renderApp('/projects/P03', 'minh');
    const li = await historyItem(update);
    await user.click(within(li).getByRole('button', { name: 'Bình luận' }));
    await user.type(within(li).getByRole('combobox'), '@cuo');
    await user.click(within(li).getByRole('option', { name: /Cường/ }));
    expect(within(li).getByRole('combobox')).toHaveValue('@Cường ');
  });

  it('warns when the mentioned person cannot see the project', async () => {
    const { user } = await renderApp('/projects/P03', 'minh');
    const li = await historyItem(update);
    await user.click(within(li).getByRole('button', { name: 'Bình luận' }));
    await user.type(within(li).getByRole('combobox'), '@phu');
    await user.keyboard('{Enter}');
    await user.click(within(li).getByRole('button', { name: 'Gửi' }));
    expect(await within(li).findByText('Phúc không xem được dự án này nên không nhận được thông báo.')).toBeInTheDocument();
  });

  it('the author edits ("edited") and deletes their own; links in the text open', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = await renderApp('/projects/P03', 'minh');
    const li = await historyItem(update);
    await user.click(within(li).getByRole('button', { name: 'Bình luận' }));
    await user.type(within(li).getByRole('combobox'), 'Xem https://example.com/spec.');
    await user.click(within(li).getByRole('button', { name: 'Gửi' }));
    const link = await within(li).findByRole('link', { name: 'https://example.com/spec' });
    expect(link).toHaveAttribute('href', 'https://example.com/spec');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    await user.click(within(li).getByRole('button', { name: 'Sửa bình luận' }));
    const edit = within(li).getAllByRole('combobox')[0];
    await user.clear(edit);
    await user.type(edit, 'Đã chốt spec');
    await user.click(within(li).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(comments()).toEqual(['Đã chốt spec']));
    expect(within(li).getByText('(đã sửa)')).toBeInTheDocument();

    await user.click(within(li).getByRole('button', { name: 'Xoá bình luận' }));
    await waitFor(() => expect(comments()).toEqual([]));
    expect(requests.some((r) => r.method === 'DELETE' && r.path.startsWith('/projects/P03/comments/'))).toBe(true);
  });

  it("others' comments have no edit; PMO may delete them", async () => {
    await store.putComment({
      id: 'c1',
      projectId: 'P03',
      target: 'update',
      targetId: update.id,
      updateAt: update.at,
      at: update.at,
      author: 'son@example.com',
      authorRole: 'GL',
      text: 'Của Sơn',
      mentions: [],
    });
    const view = await renderApp('/projects/P03', 'cuong');
    let li = await historyItem(update);
    await view.user.click(await within(li).findByRole('button', { name: 'Bình luận (1)' }));
    expect(within(li).queryByRole('button', { name: 'Sửa bình luận' })).toBeNull();
    expect(within(li).queryByRole('button', { name: 'Xoá bình luận' })).toBeNull();
    view.unmount();

    const pmo = await renderApp('/projects/P03', 'mai');
    li = await historyItem(update);
    await pmo.user.click(await within(li).findByRole('button', { name: 'Bình luận (1)' }));
    expect(within(li).queryByRole('button', { name: 'Sửa bình luận' })).toBeNull();
    expect(within(li).getByRole('button', { name: 'Xoá bình luận' })).toBeInTheDocument();
  });

  it("a notification's link opens the thread", async () => {
    await store.putComment({
      id: 'c1',
      projectId: 'P03',
      target: 'update',
      targetId: update.id,
      updateAt: update.at,
      at: update.at,
      author: 'son@example.com',
      authorRole: 'GL',
      text: '@{cuong@example.com} xem lại kế hoạch',
      mentions: ['cuong@example.com'],
    });
    await renderApp(`/projects/P03#update-${update.id}`, 'cuong');
    await waitFor(() => expect(comments()).toEqual(['@Cường xem lại kế hoạch']));
  });
});

describe('comments under an item', () => {
  it('the 💬 of a row opens its thread below it', async () => {
    const item = (await store.listItems('P03')).find((i) => i.type === 'milestone')!;
    const { user } = await renderApp('/projects/P03', 'son');
    const row = await byId(`item-${item.id}`);
    await user.click(within(row).getByRole('button', { name: 'Bình luận' }));
    const thread = row.nextElementSibling as HTMLElement;
    expect(thread).toHaveClass('thread-row');
    await user.type(within(thread).getByRole('combobox'), 'Dời sang 14/10?');
    await user.click(within(thread).getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Bình luận (1)' })).toHaveTextContent('💬 1'));
    expect((await store.listComments('P03'))[0]).toMatchObject({ target: 'item', targetId: item.id, text: 'Dời sang 14/10?' });
    // Cường created the milestone and owns it.
    expect((await store.listInbox('cuong@example.com', 5)).map((e) => e.event)).toEqual(['comment_reply']);
  });
});

describe('elsewhere', () => {
  it('"My notifications" has the two comment events, switched on', async () => {
    await renderApp('/me/notify', 'son');
    expect(await screen.findByRole('checkbox', { name: /Có người gọi tên tôi \(@\)/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Bình luận mới cho tôi/ })).toBeChecked();
  });

  it('the trash lists deleted comments and restores them', async () => {
    await store.putComment({
      id: 'c1',
      projectId: 'P03',
      target: 'update',
      targetId: update.id,
      updateAt: update.at,
      at: update.at,
      author: 'son@example.com',
      authorRole: 'GL',
      text: 'Bị xoá nhầm',
      mentions: [],
      deletedAt: update.at,
      deletedBy: 'lan@example.com',
    });
    const { user } = await renderApp('/trash', 'lan');
    const section = (await screen.findByRole('heading', { name: 'Bình luận (1)' })).closest('section')!;
    expect(within(section).getByText('Bị xoá nhầm')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Khôi phục' }));
    await waitFor(async () => expect((await store.listComments('P03')).map((c) => c.text)).toEqual(['Bị xoá nhầm']));
  });
});
