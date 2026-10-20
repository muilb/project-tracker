// Comments under updates and items, @mentions and the personal messages they send.
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { mentionIds, mentionText } from '../src/mentions.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Comment, Update } from '../src/types.js';

let now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
let channelSends: number;
const mail = (u: string) => `${u}@example.com`;
const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({
    store,
    auth: { mode: 'dev', adminEmails: [] },
    clock: () => now,
    send: async () => void channelSends++,
    webUrl: 'https://web.example',
  }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': mail(as) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const inbox = async (u: string) => store.listInbox(mail(u), 50);

/** P03's first update: Cường (PL) at 2026-10-07 18:00. */
let update: Update;
const onUpdate = (text: string) => ({ target: 'update', targetId: update.id, updateAt: update.at, text });
async function post(as: string, body: unknown) {
  const res = await call('POST', '/projects/P03/comments', as, body);
  return { status: res.status, body: (await res.json()) as { comment: Comment; notVisible: string[]; error?: string } };
}

beforeEach(async () => {
  now = new Date(vnToIso(SAMPLE_NOW_VN));
  store = new MemoryStore();
  await loadSample(store, now);
  update = (await store.listUpdates('P03')).find((u) => u.author === mail('cuong'))!;
  channelSends = 0;
});

describe('mentions', () => {
  it('are @{id} in the text, shown as @Name', () => {
    const text = 'Hỏi @{son@example.com} và @{minh@example.com}, cc @{son@example.com}. Email a@b không tính.';
    expect(mentionIds(text)).toEqual(['son@example.com', 'minh@example.com']);
    expect(mentionText(text, (id) => id.split('@')[0])).toBe('Hỏi @son và @minh, cc @son. Email a@b không tính.');
  });
});

describe('writing', () => {
  it('anyone who sees the project comments under an update; the list has it, the colour does not change', async () => {
    const before = await (await call('GET', '/projects/P03', 'lan')).json();
    const { status, body } = await post('minh', onUpdate('@{son@example.com} có mượn được dev Java không?'));
    expect(status).toBe(201);
    expect(body.comment).toMatchObject({
      projectId: 'P03',
      target: 'update',
      targetId: update.id,
      updateAt: update.at,
      author: mail('minh'),
      authorRole: 'SUBMNG',
      mentions: [mail('son')],
    });
    expect(body.notVisible).toEqual([]);
    const { comments } = await (await call('GET', '/projects/P03/comments', 'quang')).json(); // OTHER supporter of P03
    expect(comments.map((c: Comment) => c.text)).toEqual(['@{son@example.com} có mượn được dev Java không?']);
    const after = await (await call('GET', '/projects/P03', 'lan')).json();
    expect(after.project).toMatchObject({ health: before.project.health, lateHours: before.project.lateHours, dueAt: before.project.dueAt });
    expect(channelSends).toBe(0);
  });

  it('under an item (id in any case), oldest first', async () => {
    const item = (await store.listItems('P03')).find((i) => i.type === 'issue')!;
    expect((await post('son', { target: 'item', targetId: item.id.toLowerCase(), text: 'Một' })).status).toBe(201);
    now = new Date(now.getTime() + 60_000);
    expect((await post('cuong', { target: 'item', targetId: item.id, text: 'Hai' })).body.comment.targetId).toBe(item.id);
    const { comments } = await (await call('GET', '/projects/P03/comments', 'lan')).json();
    expect(comments.map((c: Comment) => c.text)).toEqual(['Một', 'Hai']);
  });

  it('refuses an empty or too long text, an unknown person, a missing target, a project one may not see', async () => {
    expect((await post('minh', onUpdate('   '))).body.error).toMatch(/Nội dung bình luận không được trống/);
    expect((await post('minh', onUpdate('x'.repeat(2001)))).body.error).toMatch(/Bình luận tối đa 2000 ký tự/);
    expect((await post('minh', onUpdate('Hỏi @{ai@example.com}'))).body.error).toBe('Không tìm thấy người được nhắc: ai@example.com');
    expect((await post('minh', { ...onUpdate('x'), updateAt: '2026-01-01T00:00:00.000Z' })).status).toBe(404);
    expect((await post('minh', { target: 'item', targetId: 'I9999', text: 'x' })).status).toBe(404);
    expect((await post('phuc', onUpdate('x'))).status).toBe(404); // OTHER, not in P03
    expect((await call('GET', '/projects/P03/comments', 'phuc')).status).toBe(404);
    expect(store.comments.size).toBe(0);
  });

  it('not under a deleted update', async () => {
    await store.putUpdate({ ...update, deletedAt: now.toISOString(), deletedBy: mail('lan') });
    expect((await post('minh', onUpdate('x'))).status).toBe(404);
  });
});

describe('editing and deleting', () => {
  it('the author edits within 24 hours ("edited"), nobody else', async () => {
    const { comment } = (await post('minh', onUpdate('Bản đầu'))).body;
    expect((await call('PATCH', `/projects/P03/comments/${comment.id}`, 'son', { text: 'Sửa hộ' })).status).toBe(403);
    now = new Date(now.getTime() + 3_600_000);
    const res = await call('PATCH', `/projects/P03/comments/${comment.id}`, 'minh', { text: 'Bản sửa' });
    expect(res.status).toBe(200);
    expect((await res.json()).comment).toMatchObject({ text: 'Bản sửa', editedAt: now.toISOString(), at: comment.at });
    now = new Date(Date.parse(comment.at) + 24 * 3_600_000);
    expect((await call('PATCH', `/projects/P03/comments/${comment.id}`, 'minh', { text: 'Quá muộn' })).status).toBe(403);
  });

  it('the author deletes within 24 hours, PMO / managers any time; the trash restores it', async () => {
    const a = (await post('minh', onUpdate('A'))).body.comment;
    const b = (await post('cuong', onUpdate('B'))).body.comment;
    expect((await call('DELETE', `/projects/P03/comments/${a.id}`, 'cuong')).status).toBe(403);
    expect((await call('DELETE', `/projects/P03/comments/${a.id}`, 'minh')).status).toBe(200);
    now = new Date(now.getTime() + 48 * 3_600_000);
    expect((await call('DELETE', `/projects/P03/comments/${b.id}`, 'cuong')).status).toBe(403);
    expect((await call('DELETE', `/projects/P03/comments/${b.id}`, 'lan')).status).toBe(200);
    expect((await call('DELETE', `/projects/P03/comments/${b.id}`, 'lan')).status).toBe(404);
    expect((await (await call('GET', '/projects/P03/comments', 'lan')).json()).comments).toEqual([]);

    const trash = await (await call('GET', '/trash', 'lan')).json();
    expect(trash.comments.map((c: Comment) => [c.text, c.deletedBy])).toEqual([
      ['B', mail('lan')],
      ['A', mail('minh')],
    ]);
    expect((await call('POST', '/trash/restore', 'lan', { kind: 'comment', projectId: 'P03', id: a.id })).status).toBe(200);
    expect((await (await call('GET', '/projects/P03/comments', 'an')).json()).comments.map((c: Comment) => c.text)).toEqual(['A']);
  });
});

describe('personal messages', () => {
  it('the mentioned person and the update author are told, never the writer; one message each', async () => {
    await post('minh', onUpdate('@{son@example.com} @{cuong@example.com} cần quyết định trước 12/10'));
    const [son] = await inbox('son');
    expect(son).toMatchObject({
      event: 'mentioned',
      title: '💬 Minh nhắc đến bạn – P03 · Nâng cấp ERP',
      projectId: 'P03',
      link: { url: `https://web.example/projects/P03#update-${update.id}`, title: 'Mở bình luận' },
    });
    expect(son.lines.map((l) => l.text)).toEqual([
      '@Sơn @Cường cần quyết định trước 12/10',
      `Về cập nhật của Cường (2026-10-07 18:00): "${update.summary}"`,
    ]);
    // Cường wrote the update and is mentioned: the mention wins.
    expect((await inbox('cuong')).map((e) => e.event)).toEqual(['mentioned']);
    expect(await inbox('minh')).toEqual([]);
  });

  it('a reply goes to the update author and to everyone earlier in the thread', async () => {
    await post('minh', onUpdate('Câu hỏi'));
    expect((await inbox('cuong')).map((e) => [e.event, e.title])).toEqual([['comment_reply', '💬 Minh bình luận – P03 · Nâng cấp ERP']]);
    now = new Date(now.getTime() + 60_000);
    await post('son', onUpdate('Trả lời'));
    expect((await inbox('minh')).map((e) => e.event)).toEqual(['comment_reply']);
    expect((await inbox('cuong')).map((e) => e.lines[0].text)).toEqual(['Trả lời', 'Câu hỏi']);
    expect(await inbox('mai')).toEqual([]); // PMO of the project, not in the thread
  });

  it('under an item: its creator and owner follow the thread', async () => {
    const item = (await store.listItems('P03')).find((i) => i.createdBy === mail('mai'))!; // owner son
    await post('cuong', { target: 'item', targetId: item.id, text: 'Lùi sang chiều?' });
    for (const u of ['mai', 'son']) {
      const [e] = await inbox(u);
      expect(e.event).toBe('comment_reply');
      expect(e.lines[1].text).toBe(`Về ● Sự kiện "${item.title}"`);
      expect(e.link?.url).toBe(`https://web.example/projects/P03#item-${item.id}`);
    }
  });

  it('someone who may not see the project gets nothing, and the writer is told so', async () => {
    const { body } = await post('minh', onUpdate('Nhờ @{phuc@example.com} xem giúp'));
    expect(body.notVisible).toEqual([mail('phuc')]);
    expect(await inbox('phuc')).toEqual([]);
    // Owning an item of the project makes it visible to OTHER.
    const item = (await store.listItems('P03'))[0];
    await store.putItem({ ...item, owner: mail('phuc') });
    expect((await post('minh', onUpdate('Nhờ @{phuc@example.com} lần nữa'))).body.notVisible).toEqual([]);
    expect((await inbox('phuc')).map((e) => e.event)).toEqual(['mentioned']);
  });

  it('an edit tells only the people it newly mentions', async () => {
    const { comment } = (await post('minh', onUpdate('@{son@example.com} xem nhé'))).body;
    await call('PATCH', `/projects/P03/comments/${comment.id}`, 'minh', { text: '@{son@example.com} @{tuan@example.com} xem nhé' });
    expect((await inbox('son')).length).toBe(1);
    expect((await inbox('tuan')).map((e) => e.lines[0].text)).toEqual(['@Sơn @Tuấn xem nhé']);
    expect((await inbox('cuong')).length).toBe(1); // the reply message of the first version only
  });

  it('switched off in "My notifications" → nothing; settings saved before comments existed get them on', async () => {
    await store.putNotifyPrefs({ userId: mail('son'), events: ['need_help'], telegram: false, watch: [], updatedAt: now.toISOString() });
    const prefs = await (await call('GET', '/me/notify', 'son')).json();
    expect(prefs.prefs.events).toEqual(['need_help', 'mentioned', 'comment_reply']);
    await call('PUT', '/me/notify', 'son', { events: ['need_help'] });
    await post('minh', onUpdate('@{son@example.com} ơi'));
    expect(await inbox('son')).toEqual([]);
    expect((await store.getNotifyPrefs(mail('son')))?.eventsVersion).toBe(2);
  });
});
