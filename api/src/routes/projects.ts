import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { audit } from '../audit.js';
import { can, DELETE_UPDATE_HOURS, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { l } from '../i18n.js';
import { addUpdate, createItem, createProject, loadItem, loadProject, patchItem, patchProject, type OpContext } from '../projectOps.js';
import { buildProjectView, compareItems, toItemView } from '../rules.js';
import { createItemSchema, createProjectSchema, createUpdateSchema, parseBody, patchItemSchema, patchProjectSchema } from '../schemas.js';
import { updateCursor, type Store } from '../store/store.js';
import { projectTrend } from '../trend.js';
import { activeProjectViews, isInvolved, visibleSnapshot } from '../views.js';

export const projects = new Hono<AppEnv>();

/** The caller of the request, for the shared write paths in projectOps.ts. */
const op = (c: Context<AppEnv>): OpContext => ({ store: c.get('store'), notify: c.get('notify'), now: c.get('now'), user: c.get('user') });

/** The project page shows this many updates first; "more" loads UPDATES_PAGE older ones at a time. */
const FIRST_UPDATES = 10;
const UPDATES_PAGE = 20;
/** Newest first, older than the `before` cursor (`updateCursor` of the last update shown); reads one page only. */
async function updatesPage(store: Store, projectId: string, before: string | undefined, size: number) {
  const rows = await store.pageUpdates(projectId, size + 1, before);
  const updates = rows.slice(0, size);
  return { updates, nextBefore: rows.length > size ? updateCursor(updates[updates.length - 1]) : undefined };
}

projects.get('/', async (c) => {
  const store = c.get('store');
  const now = c.get('now');
  const me = c.get('user');
  const { scope, gl, state } = c.req.query();
  const snap = visibleSnapshot(me, await store.snapshot({ now }));
  let views =
    state === 'all' || state === 'paused' || state === 'closed'
      ? snap.projects
          .filter((p) => state === 'all' || p.state === state)
          .map((p) => buildProjectView(p, snap.updates, snap.items, snap.settings, now))
      : activeProjectViews(snap, now);
  if (scope === 'mine') views = views.filter((v) => isInvolved(v, me.id));
  if (gl) views = views.filter((v) => v.gl === gl);
  return c.json({ projects: views });
});

projects.post('/', async (c) => {
  ensure(can.createProject(c.get('user')), l('Chỉ PL trở lên mới được tạo dự án', 'プロジェクトの作成は PL 以上のみ行えます'));
  const body = await parseBody(c.req, createProjectSchema);
  return c.json({ project: await createProject(op(c), body) }, 201);
});

projects.get('/:id', async (c) => {
  const store = c.get('store');
  const now = c.get('now');
  const project = await loadProject(store, c.req.param('id'), c.get('user'), c.get('now'));
  const [pinned, page, items, settings] = await Promise.all([
    store.listPinnedUpdates(project.id),
    updatesPage(store, project.id, undefined, FIRST_UPDATES),
    store.listItems(project.id),
    store.getSettings(),
  ]);
  return c.json({
    project: buildProjectView(project, pinned, items, settings, now),
    ...page,
    items: items.map((i) => toItemView(i, now, settings)).sort(compareItems),
  });
});

// Colour per recorded day (trend.ts): 12 weeks, or the whole project with ?all=1.
projects.get('/:id/trend', async (c) => {
  const store = c.get('store');
  const now = c.get('now');
  const project = await loadProject(store, c.req.param('id'), c.get('user'), now);
  return c.json(await projectTrend(store, project, now, c.req.query('all') === '1'));
});

projects.patch('/:id', async (c) => {
  const store = c.get('store');
  const me = c.get('user');
  const project = await loadProject(store, c.req.param('id'), me, c.get('now'));
  ensure(
    can.editProject(me, project),
    l('Chỉ PMO, quản lý, GL hoặc PL của dự án mới được sửa', 'プロジェクトの編集は PMO・管理者・そのプロジェクトの GL / PL のみ行えます'),
  );
  const body = await parseBody(c.req, patchProjectSchema);
  return c.json({ project: await patchProject(op(c), project.id, body) });
});

projects.get('/:id/updates', async (c) => {
  const store = c.get('store');
  const project = await loadProject(store, c.req.param('id'), c.get('user'), c.get('now'));
  const { before, limit } = c.req.query();
  const size = Math.min(Math.max(Number(limit) || UPDATES_PAGE, 1), 100);
  return c.json(await updatesPage(store, project.id, before, size));
});

projects.post('/:id/updates', async (c) => {
  const project = await loadProject(c.get('store'), c.req.param('id'), c.get('user'), c.get('now'));
  const body = await parseBody(c.req, createUpdateSchema);
  return c.json({ update: await addUpdate(op(c), project.id, body) }, 201);
});

projects.get('/:id/items', async (c) => {
  const store = c.get('store');
  const project = await loadProject(store, c.req.param('id'), c.get('user'), c.get('now'));
  const [items, settings] = await Promise.all([store.listItems(project.id), store.getSettings()]);
  return c.json({ items: items.map((i) => toItemView(i, c.get('now'), settings)).sort(compareItems) });
});

projects.post('/:id/items', async (c) => {
  const project = await loadProject(c.get('store'), c.req.param('id'), c.get('user'), c.get('now'));
  const body = await parseBody(c.req, createItemSchema);
  return c.json({ item: await createItem(op(c), project.id, body) }, 201);
});

projects.patch('/:id/items/:itemId', async (c) => {
  const project = await loadProject(c.get('store'), c.req.param('id'), c.get('user'), c.get('now'));
  const item = await loadItem(c.get('store'), project, c.req.param('itemId'));
  const body = await parseBody(c.req, patchItemSchema);
  return c.json({ item: await patchItem(op(c), project.id, item.id, body) });
});

// --- Soft deletes (restored from the trash by PMO / managers) ---

projects.delete('/:id', async (c) => {
  const store = c.get('store');
  const me = c.get('user');
  const project = await loadProject(store, c.req.param('id'), c.get('user'), c.get('now'));
  ensure(can.deleteProject(me), l('Chỉ PMO / quản lý mới được xoá dự án', 'プロジェクトの削除は PMO / 管理者のみ行えます'));
  const now = c.get('now').toISOString();
  await store.putProject({ ...project, deletedAt: now, deletedBy: me.id });
  await audit(store, c.get('now'), me.id, 'project_delete', project.id, project.name);
  return c.json({ ok: true });
});

projects.delete('/:id/items/:itemId', async (c) => {
  const store = c.get('store');
  const me = c.get('user');
  const project = await loadProject(store, c.req.param('id'), c.get('user'), c.get('now'));
  const item = await loadItem(store, project, c.req.param('itemId'));
  ensure(
    can.deleteItem(me, project, item),
    l(
      'Chỉ người tạo mục, PL / GL của dự án hoặc PMO / quản lý mới được xoá',
      '項目の削除は作成者・プロジェクトの PL / GL・PMO / 管理者のみ行えます',
    ),
  );
  await store.putItem({ ...item, deletedAt: c.get('now').toISOString(), deletedBy: me.id });
  return c.json({ ok: true });
});

projects.delete('/:id/updates/:updateId', async (c) => {
  const store = c.get('store');
  const me = c.get('user');
  const project = await loadProject(store, c.req.param('id'), c.get('user'), c.get('now'));
  const update = (await store.listUpdates(project.id)).find((u) => u.id === c.req.param('updateId'));
  if (!update) throw new HTTPException(404, { message: l('Không tìm thấy cập nhật', '報告が見つかりません') });
  ensure(
    can.deleteUpdate(me, update, c.get('now')),
    l(
      `Chỉ người viết (trong ${DELETE_UPDATE_HOURS} giờ) hoặc PMO / quản lý mới được xoá cập nhật`,
      `報告の削除は作成者（${DELETE_UPDATE_HOURS} 時間以内）または PMO / 管理者のみ行えます`,
    ),
  );
  await store.putUpdate({ ...update, deletedAt: c.get('now').toISOString(), deletedBy: me.id });
  return c.json({ ok: true });
});
