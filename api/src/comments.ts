// Comments under updates and items: whoever may see the project writes them, the author edits or
// deletes them within DELETE_UPDATE_HOURS (PMO / managers delete any). `@{<user id>}` in the text
// mentions someone: they get a personal message, and so do the thread's followers (the update's
// author, the item's creator and owner, earlier commenters). A comment never changes the colour and
// does not count as an update; it is never on the public page or in group channels.
import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { can, DELETE_UPDATE_HOURS, ensure } from './auth.js';
import { l } from './i18n.js';
import type { CommentAbout } from './notify/events.js';
import { emit } from './notify/pipeline.js';
import { mentionIds } from './mentions.js';
import { loadProject, type OpContext } from './projectOps.js';
import type { createCommentSchema } from './schemas.js';
import { keepItem, snapshotSince } from './store/store.js';
import type { Comment, Project } from './types.js';

/** Sorts like the time it was written: the milliseconds in base 36 (fixed width), then a random suffix. */
export const commentId = (now: Date) => `c${now.getTime().toString(36).padStart(9, '0')}${randomUUID().slice(0, 4)}`;

const notFound = () => new HTTPException(404, { message: l('Không tìm thấy bình luận', 'コメントが見つかりません') });

/** Who of the users may see `project` (OTHER through an item they own, as loadProject decides), and its items for the alerts. */
async function viewers(ctx: OpContext, project: Project) {
  const [users, items] = await Promise.all([ctx.store.listUsers(), ctx.store.listItems(project.id)]);
  const since = snapshotSince(ctx.now);
  const owned = items.filter((i) => keepItem(i, since));
  const byId = new Map(users.map((u) => [u.id, u]));
  const sees = (id: string) => {
    const u = byId.get(id);
    return !!u && can.viewProject(u, project, owned);
  };
  return { sees, items: owned, known: (id: string) => byId.has(id) };
}

function checkMentions(ids: string[], known: (id: string) => boolean) {
  const missing = ids.filter((id) => !known(id));
  if (missing.length)
    throw new HTTPException(400, { message: l('Không tìm thấy người được nhắc: ', 'メンションされたユーザーが見つかりません: ') + missing.join(', ') });
}

/** The update or item a comment is about; undefined when it is gone (deleted). */
async function about(ctx: OpContext, project: Project, c: Pick<Comment, 'target' | 'targetId' | 'updateAt'>): Promise<CommentAbout | undefined> {
  if (c.target === 'item') {
    const item = await ctx.store.getItem(project.id, c.targetId);
    return item && !item.deletedAt ? { kind: 'item', item } : undefined;
  }
  const update = c.updateAt ? await ctx.store.getUpdate(project.id, c.updateAt, c.targetId) : undefined;
  return update && !update.deletedAt ? { kind: 'update', update } : undefined;
}

export async function addComment(ctx: OpContext, projectId: string, body: z.infer<typeof createCommentSchema>) {
  const { store, user: me, now } = ctx;
  const project = await loadProject(store, projectId, me, now);
  // Item ids are upper case (as loadItem reads them), update ids are not.
  const target = {
    target: body.target,
    targetId: body.target === 'item' ? body.targetId.toUpperCase() : body.targetId,
    updateAt: body.target === 'update' ? body.updateAt : undefined,
  };
  const on = await about(ctx, project, target);
  if (!on)
    throw new HTTPException(404, {
      message: body.target === 'update' ? l('Không tìm thấy cập nhật', '報告が見つかりません') : l('Không tìm thấy vấn đề / sự kiện', '課題 / イベントが見つかりません'),
    });
  const v = await viewers(ctx, project);
  const mentions = mentionIds(body.text);
  checkMentions(mentions, v.known);

  const comment: Comment = {
    id: commentId(now),
    projectId: project.id,
    ...target,
    at: now.toISOString(),
    author: me.id,
    authorRole: me.role,
    text: body.text,
    mentions,
  };
  await store.putComment(comment);
  const thread = (await store.listComments(project.id)).filter(
    (c) => c.target === comment.target && c.targetId === comment.targetId && c.id !== comment.id,
  );
  const owners = on.kind === 'update' ? [on.update.author] : [on.item.createdBy, on.item.owner];
  const followers = [...new Set([...owners, ...thread.map((c) => c.author)])].filter((id): id is string => !!id);
  await emit(ctx.notify, now, { type: 'comment_posted', project, comment, about: on, mentions, followers, items: v.items, actor: me.id });
  return { comment, notVisible: mentions.filter((id) => !v.sees(id)) };
}

/** Only people newly mentioned by the edit are told; the thread's followers were told when it was written. */
export async function editComment(ctx: OpContext, projectId: string, id: string, text: string) {
  const { store, user: me, now } = ctx;
  const project = await loadProject(store, projectId, me, now);
  const old = await store.getComment(project.id, id);
  if (!old || old.deletedAt) throw notFound();
  ensure(
    can.editComment(me, old, now),
    l(`Chỉ người viết mới sửa được bình luận, trong ${DELETE_UPDATE_HOURS} giờ`, `コメントの編集は作成者のみ（${DELETE_UPDATE_HOURS} 時間以内）行えます`),
  );
  const v = await viewers(ctx, project);
  const mentions = mentionIds(text);
  checkMentions(mentions, v.known);
  const comment: Comment = { ...old, text, mentions, editedAt: now.toISOString() };
  await store.putComment(comment);
  const added = mentions.filter((m) => !old.mentions.includes(m));
  const on = added.length ? await about(ctx, project, comment) : undefined;
  if (on) await emit(ctx.notify, now, { type: 'comment_posted', project, comment, about: on, mentions: added, followers: [], items: v.items, actor: me.id });
  return { comment, notVisible: mentions.filter((m) => !v.sees(m)) };
}

/** Soft delete; PMO / managers restore it from the trash. */
export async function deleteComment(ctx: OpContext, projectId: string, id: string) {
  const { store, user: me, now } = ctx;
  const project = await loadProject(store, projectId, me, now);
  const comment = await store.getComment(project.id, id);
  if (!comment || comment.deletedAt) throw notFound();
  ensure(
    can.deleteComment(me, comment, now),
    l(
      `Chỉ người viết (trong ${DELETE_UPDATE_HOURS} giờ) hoặc PMO / quản lý mới được xoá bình luận`,
      `コメントの削除は作成者（${DELETE_UPDATE_HOURS} 時間以内）または PMO / 管理者のみ行えます`,
    ),
  );
  await store.putComment({ ...comment, deletedAt: now.toISOString(), deletedBy: me.id });
}
