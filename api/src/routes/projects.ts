import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { notifyBecameRed, notifyHighIssue } from '../notify/alerts.js';
import { buildProjectView, compareItems, toItemView } from '../rules.js';
import { createItemSchema, createProjectSchema, createUpdateSchema, parseBody, patchItemSchema, patchProjectSchema } from '../schemas.js';
import { ConflictError, type Store } from '../store/store.js';
import type { Item, Project, Update } from '../types.js';
import { activeProjectViews, isInvolved } from '../views.js';

export const projects = new Hono<AppEnv>();

async function loadProject(store: Store, id: string): Promise<Project> {
  const p = await store.getProject(id.toUpperCase());
  if (!p) throw new HTTPException(404, { message: `Không tìm thấy dự án ${id}` });
  return p;
}

/** Alerts must never make the user's change fail. */
async function alert(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error('alert failed', e);
  }
}

/** Referenced people must exist (PMO can pre-create them via POST /users). */
async function checkUsers(store: Store, ids: (string | undefined)[]) {
  const known = new Set((await store.listUsers()).map((u) => u.id));
  const missing = ids.filter((id): id is string => !!id && !known.has(id));
  if (missing.length) throw new HTTPException(400, { message: `Người dùng chưa tồn tại: ${missing.join(', ')}` });
}

projects.get('/', async (c) => {
  const store = c.get('store');
  const now = c.get('now');
  const me = c.get('user');
  const { scope, gl, state } = c.req.query();
  const snap = await store.snapshot();
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
  const store = c.get('store');
  const me = c.get('user');
  ensure(can.createProject(me), 'Chỉ PL trở lên mới được tạo dự án');
  const body = await parseBody(c.req, createProjectSchema);
  const now = c.get('now').toISOString();

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
    if (e instanceof ConflictError) throw new HTTPException(409, { message: `Mã dự án ${project.id} đã tồn tại` });
    throw e;
  }
  return c.json({ project }, 201);
});

projects.get('/:id', async (c) => {
  const store = c.get('store');
  const now = c.get('now');
  const project = await loadProject(store, c.req.param('id'));
  const [updates, items, settings] = await Promise.all([
    store.listUpdates(project.id),
    store.listItems(project.id),
    store.getSettings(),
  ]);
  return c.json({
    project: buildProjectView(project, updates, items, settings, now),
    updates: updates.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50),
    items: items.map((i) => toItemView(i, now, settings)).sort(compareItems),
  });
});

projects.patch('/:id', async (c) => {
  const store = c.get('store');
  const me = c.get('user');
  const project = await loadProject(store, c.req.param('id'));
  ensure(can.editProject(me, project), 'Chỉ PMO, quản lý, GL hoặc PL của dự án mới được sửa');
  const body = await parseBody(c.req, patchProjectSchema);
  await checkUsers(store, [body.gl, body.pl, body.pmo, ...(body.supporters ?? [])]);
  const updated: Project = { ...project, ...body, updatedAt: c.get('now').toISOString() };
  await store.putProject(updated);
  return c.json({ project: updated });
});

projects.get('/:id/updates', async (c) => {
  const store = c.get('store');
  const project = await loadProject(store, c.req.param('id'));
  const updates = (await store.listUpdates(project.id)).sort((a, b) => b.at.localeCompare(a.at));
  return c.json({ updates });
});

projects.post('/:id/updates', async (c) => {
  const store = c.get('store');
  const me = c.get('user');
  const project = await loadProject(store, c.req.param('id'));
  const body = await parseBody(c.req, createUpdateSchema);
  const now = c.get('now');
  const [updates, items, settings] = await Promise.all([
    store.listUpdates(project.id),
    store.listItems(project.id),
    store.getSettings(),
  ]);
  const before = buildProjectView(project, updates, items, settings, now);
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
  await store.addUpdate(update);
  const after = buildProjectView(project, [...updates, update], items, settings, now);
  if (project.state === 'active' && after.health === 'red' && before.health !== 'red') {
    await alert(() => notifyBecameRed(c.get('notify'), now, after, update));
  }
  return c.json({ update }, 201);
});

projects.get('/:id/items', async (c) => {
  const store = c.get('store');
  const project = await loadProject(store, c.req.param('id'));
  const [items, settings] = await Promise.all([store.listItems(project.id), store.getSettings()]);
  return c.json({ items: items.map((i) => toItemView(i, c.get('now'), settings)).sort(compareItems) });
});

projects.post('/:id/items', async (c) => {
  const store = c.get('store');
  const me = c.get('user');
  const project = await loadProject(store, c.req.param('id'));
  const body = await parseBody(c.req, createItemSchema);
  await checkUsers(store, [body.owner]);
  const now = c.get('now').toISOString();
  const item: Item = {
    id: `I${String(await store.nextSeq('item')).padStart(4, '0')}`,
    projectId: project.id,
    ...body,
    createdBy: me.id,
    createdAt: now,
    updatedAt: now,
  };
  await store.putItem(item);
  if (item.type === 'issue' && item.priority === 'high' && item.status !== 'done' && project.state === 'active') {
    await alert(() => notifyHighIssue(c.get('notify'), c.get('now'), project, item));
  }
  return c.json({ item }, 201);
});

projects.patch('/:id/items/:itemId', async (c) => {
  const store = c.get('store');
  const project = await loadProject(store, c.req.param('id'));
  const item = await store.getItem(project.id, c.req.param('itemId').toUpperCase());
  if (!item) throw new HTTPException(404, { message: 'Không tìm thấy vấn đề / sự kiện' });
  const body = await parseBody(c.req, patchItemSchema);
  await checkUsers(store, [body.owner]);
  const updated: Item = { ...item, ...body, updatedAt: c.get('now').toISOString() };
  await store.putItem(updated);
  return c.json({ item: updated });
});
