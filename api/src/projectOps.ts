// Writes to projects, updates and items, shared by the REST routes and the Telegram bot
// (same validation, permission checks and alerts whichever way the change comes in).
import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { can, ensure } from './auth.js';
import { l } from './i18n.js';
import type { NotifyDeps } from './notify/deps.js';
import { emit } from './notify/pipeline.js';
import { buildProjectView } from './rules.js';
import type { createItemSchema, createProjectSchema, createUpdateSchema, patchItemSchema, patchProjectSchema } from './schemas.js';
import { ConflictError, type Store } from './store/store.js';
import type { Item, Project, Update, User } from './types.js';

/** Who makes the change, and when. */
export interface OpContext {
  store: Store;
  notify: NotifyDeps;
  now: Date;
  user: User;
}

/** A project `me` may not see answers 404 like a missing one, for reads and writes alike. */
export async function loadProject(store: Store, id: string, me: User): Promise<Project> {
  const p = await store.getProject(id.toUpperCase());
  const visible = p && !p.deletedAt && can.viewProject(me, p, me.role === 'OTHER' ? await store.listItems(p.id) : []);
  if (!visible) throw new HTTPException(404, { message: l(`Không tìm thấy dự án ${id}`, `プロジェクト ${id} が見つかりません`) });
  return p;
}

export async function loadItem(store: Store, project: Project, id: string): Promise<Item> {
  const item = await store.getItem(project.id, id.toUpperCase());
  if (!item || item.deletedAt)
    throw new HTTPException(404, { message: l('Không tìm thấy vấn đề / sự kiện', '課題 / イベントが見つかりません') });
  return item;
}

/** Referenced people must exist (PMO can pre-create them via POST /users). */
export async function checkUsers(store: Store, ids: (string | undefined)[]) {
  const known = new Set((await store.listUsers()).map((u) => u.id));
  const missing = ids.filter((id): id is string => !!id && !known.has(id));
  if (missing.length)
    throw new HTTPException(400, { message: l('Người dùng chưa tồn tại: ', '未登録のユーザーです: ') + missing.join(', ') });
}

export async function createProject(ctx: OpContext, body: z.infer<typeof createProjectSchema>): Promise<Project> {
  const { store, user: me } = ctx;
  ensure(can.createProject(me), l('Chỉ PL trở lên mới được tạo dự án', 'プロジェクトの作成は PL 以上のみ行えます'));
  const now = ctx.now.toISOString();
  const project: Project = {
    id: body.id ?? `P${String(await store.nextSeq('project')).padStart(2, '0')}`,
    name: body.name,
    customer: body.customer,
    gl: body.gl ?? (me.role === 'GL' ? me.id : undefined),
    pl: body.pl ?? (me.role === 'PL' ? me.id : undefined),
    supporters: body.supporters ?? [],
    pmo: body.pmo,
    startDate: body.startDate,
    endDate: body.endDate,
    state: 'active',
    updateFrequencyHours: body.updateFrequencyHours ?? null,
    publicVisible: body.publicVisible ?? true,
    publicName: body.publicName,
    createdBy: me.id,
    createdAt: now,
    updatedAt: now,
  };
  await checkUsers(store, [project.gl, project.pl, project.pmo, ...project.supporters]);
  try {
    await store.createProject(project);
  } catch (e) {
    if (e instanceof ConflictError)
      throw new HTTPException(409, {
        message: (await store.getProject(project.id))?.deletedAt
          ? l(
              `Mã dự án ${project.id} thuộc một dự án đã xoá — PMO khôi phục ở Thùng rác, hoặc dùng mã khác`,
              `プロジェクトコード ${project.id} は削除済みのプロジェクトで使われています。PMO がごみ箱から復元するか、別のコードを使ってください`,
            )
          : l(`Mã dự án ${project.id} đã tồn tại`, `プロジェクトコード ${project.id} は既に存在します`),
      });
    throw e;
  }
  return project;
}

export async function patchProject(ctx: OpContext, id: string, body: z.infer<typeof patchProjectSchema>): Promise<Project> {
  const { store, user: me } = ctx;
  const project = await loadProject(store, id, me);
  ensure(
    can.editProject(me, project),
    l('Chỉ PMO, quản lý, GL hoặc PL của dự án mới được sửa', 'プロジェクトの編集は PMO・管理者・そのプロジェクトの GL / PL のみ行えます'),
  );
  await checkUsers(store, [body.gl, body.pl, body.pmo, ...(body.supporters ?? [])]);
  const updated: Project = { ...project, ...body, updatedAt: ctx.now.toISOString() };
  await store.putProject(updated);
  return updated;
}

export async function addUpdate(ctx: OpContext, id: string, body: z.infer<typeof createUpdateSchema>): Promise<Update> {
  const { store, user: me, now } = ctx;
  const project = await loadProject(store, id, me);
  // The pinned updates give the same view as the whole history (see rules.pinUpdates).
  const [pinned, items, settings] = await Promise.all([
    store.listPinnedUpdates(project.id),
    store.listItems(project.id),
    store.getSettings(),
  ]);
  const before = buildProjectView(project, pinned, items, settings, now);
  const update: Update = {
    id: randomUUID().slice(0, 8),
    projectId: project.id,
    at: body.at ? new Date(body.at).toISOString() : now.toISOString(),
    author: me.id,
    authorRole: me.role,
    health: body.health,
    summary: body.summary,
    needHelp: body.needHelp || undefined,
    rawText: body.rawText,
  };
  await store.putUpdate(update);
  const after = buildProjectView(project, [...pinned, update], items, settings, now);
  await emit(ctx.notify, now, { type: 'update_posted', project, update, before, after, actor: me.id });
  return update;
}

export async function createItem(ctx: OpContext, id: string, body: z.infer<typeof createItemSchema>): Promise<Item> {
  const { store, user: me } = ctx;
  const project = await loadProject(store, id, me);
  await checkUsers(store, [body.owner]);
  const now = ctx.now.toISOString();
  const item: Item = {
    id: `I${String(await store.nextSeq('item')).padStart(4, '0')}`,
    projectId: project.id,
    ...body,
    createdBy: me.id,
    createdAt: now,
    updatedAt: now,
  };
  await store.putItem(item);
  await emit(ctx.notify, ctx.now, { type: 'item_saved', project, item, actor: me.id });
  return item;
}

export async function patchItem(ctx: OpContext, id: string, itemId: string, body: z.infer<typeof patchItemSchema>): Promise<Item> {
  const { store } = ctx;
  const project = await loadProject(store, id, ctx.user);
  const item = await loadItem(store, project, itemId);
  await checkUsers(store, [body.owner]);
  const updated: Item = { ...item, ...body, updatedAt: ctx.now.toISOString() };
  await store.putItem(updated);
  await emit(ctx.notify, ctx.now, { type: 'item_saved', project, item: updated, previous: item, actor: ctx.user.id });
  return updated;
}
