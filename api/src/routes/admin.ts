import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { createUserSchema, parseBody, patchUserSchema, settingsSchema } from '../schemas.js';
import type { User } from '../types.js';

export const admin = new Hono<AppEnv>();

admin.get('/me', (c) => c.json({ user: c.get('user') }));

admin.get('/users', async (c) => {
  const users = (await c.get('store').listUsers()).sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ users });
});

/** Pre-create a user (e.g. a GL) before they log in for the first time. */
admin.post('/users', async (c) => {
  const store = c.get('store');
  ensure(can.manageUsers(c.get('user')), 'Chỉ PMO / MNG mới được thêm người dùng');
  const body = await parseBody(c.req, createUserSchema);
  if (await store.getUser(body.id)) throw new HTTPException(409, { message: `${body.id} đã tồn tại` });
  const user: User = { ...body, createdAt: c.get('now').toISOString() };
  await store.putUser(user);
  return c.json({ user }, 201);
});

admin.patch('/users/:id', async (c) => {
  const store = c.get('store');
  ensure(can.manageUsers(c.get('user')), 'Chỉ PMO / MNG mới được sửa người dùng');
  const user = await store.getUser(c.req.param('id').toLowerCase());
  if (!user) throw new HTTPException(404, { message: 'Không tìm thấy người dùng' });
  const updated = { ...user, ...(await parseBody(c.req, patchUserSchema)) };
  await store.putUser(updated);
  return c.json({ user: updated });
});

admin.get('/settings', async (c) => c.json({ settings: await c.get('store').getSettings() }));

admin.put('/settings', async (c) => {
  ensure(can.admin(c.get('user')), 'Chỉ PMO / quản lý mới được sửa cài đặt');
  const settings = await parseBody(c.req, settingsSchema);
  await c.get('store').putSettings(settings);
  return c.json({ settings });
});
