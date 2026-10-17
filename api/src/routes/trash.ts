import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { audit } from '../audit.js';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { l } from '../i18n.js';
import { parseBody, restoreSchema } from '../schemas.js';

/** Soft-deleted projects, items and updates; PMO / managers look and restore. */
export const trash = new Hono<AppEnv>();

const onlyAdmins = (c: { get: (k: 'user') => AppEnv['Variables']['user'] }) =>
  ensure(can.admin(c.get('user')), l('Chỉ PMO / quản lý mới xem được thùng rác', 'ごみ箱は PMO / 管理者のみ利用できます'));

trash.get('/', async (c) => {
  onlyAdmins(c);
  const store = c.get('store');
  // Deleted updates are read on their own: the snapshot keeps only recent updates.
  const [snap, deletedUpdates] = await Promise.all([
    store.snapshot({ includeDeleted: true, now: c.get('now') }),
    store.listDeletedUpdates(),
  ]);
  const name = new Map(snap.projects.map((p) => [p.id, p.name]));
  const liveProject = new Set(snap.projects.filter((p) => !p.deletedAt).map((p) => p.id));
  const newestFirst = (a: { deletedAt?: string }, b: { deletedAt?: string }) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '');
  // Rows of a deleted project come back with it, so only rows of live projects are listed on their own.
  return c.json({
    projects: snap.projects
      .filter((p) => p.deletedAt)
      .sort(newestFirst)
      .map(({ id, name, customer, deletedAt, deletedBy }) => ({ id, name, customer, deletedAt, deletedBy })),
    items: snap.items
      .filter((i) => i.deletedAt && liveProject.has(i.projectId))
      .sort(newestFirst)
      .map(({ id, projectId, type, title, date, deletedAt, deletedBy }) => ({
        id,
        projectId,
        projectName: name.get(projectId),
        type,
        title,
        date,
        deletedAt,
        deletedBy,
      })),
    updates: deletedUpdates
      .filter((u) => liveProject.has(u.projectId))
      .sort(newestFirst)
      .map(({ id, projectId, at, author, summary, deletedAt, deletedBy }) => ({
        id,
        projectId,
        projectName: name.get(projectId),
        at,
        author,
        summary,
        deletedAt,
        deletedBy,
      })),
  });
});

trash.post('/restore', async (c) => {
  onlyAdmins(c);
  const { kind, projectId, id } = await parseBody(c.req, restoreSchema);
  const store = c.get('store');
  const notFound = () => new HTTPException(404, { message: l('Không tìm thấy mục đã xoá', '削除済みの項目が見つかりません') });
  const project = await store.getProject(projectId);
  if (!project) throw notFound();
  const restore = <T extends { deletedAt?: string; deletedBy?: string }>({ deletedAt: _a, deletedBy: _b, ...rest }: T) => rest as T;

  if (kind === 'project') {
    if (!project.deletedAt) throw notFound();
    await store.putProject(restore(project));
    await audit(store, c.get('now'), c.get('user').id, 'restore', projectId, 'project');
    return c.json({ ok: true });
  }
  if (project.deletedAt)
    throw new HTTPException(400, {
      message: l(
        'Dự án của mục này đang bị xoá — khôi phục dự án trước',
        'この項目のプロジェクトは削除されています。先にプロジェクトを復元してください',
      ),
    });
  if (kind === 'item') {
    const item = await store.getItem(projectId, id);
    if (!item?.deletedAt) throw notFound();
    await store.putItem(restore(item));
  } else {
    const update = (await store.listUpdates(projectId, { includeDeleted: true })).find((u) => u.id === id);
    if (!update?.deletedAt) throw notFound();
    await store.putUpdate(restore(update));
  }
  await audit(store, c.get('now'), c.get('user').id, 'restore', `${projectId}/${id}`, kind);
  return c.json({ ok: true });
});
