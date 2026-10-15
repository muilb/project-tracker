import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { NotPendingError } from '../accounts.js';
import { looksLikeBotToken } from '../notify/telegram.js';
import { approveAccountSchema, createUserSchema, parseBody, patchUserSchema, settingsSchema, telegramBotSchema } from '../schemas.js';
import type { User } from '../types.js';

export const admin = new Hono<AppEnv>();

admin.get('/me', (c) => c.json({ user: c.get('user') }));

admin.get('/users', async (c) => {
  const users = (await c.get('store').listUsers()).sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ users });
});

// --- Sign-ups waiting for approval (confirmation email did not arrive) ---

admin.get('/users/pending', async (c) => {
  ensure(can.manageUsers(c.get('user')), 'Chỉ PMO / MNG mới duyệt tài khoản');
  return c.json({ pending: await c.get('accounts').listPending() });
});

admin.post('/users/pending/:email/approve', async (c) => {
  ensure(can.manageUsers(c.get('user')), 'Chỉ PMO / MNG mới duyệt tài khoản');
  const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
  const body = await parseBody(c.req, approveAccountSchema);
  let account;
  try {
    account = await c.get('accounts').approve(email);
  } catch (e) {
    if (e instanceof NotPendingError) throw new HTTPException(404, { message: `${email} không có trong danh sách chờ duyệt` });
    throw e;
  }
  // Keep a record PMO created beforehand; otherwise create it now with the chosen role,
  // falling back to the ADMIN_EMAILS role (as on a normal first login), then PL.
  const store = c.get('store');
  const existing = await store.getUser(email);
  const user: User = existing
    ? { ...existing, ...(body.role ? { role: body.role } : {}) }
    : {
        id: email,
        name: account.name || email.split('@')[0],
        role: body.role ?? c.get('initialRoles').get(email) ?? 'PL',
        createdAt: c.get('now').toISOString(),
      };
  await store.putUser(user);
  return c.json({ user });
});

admin.post('/users/pending/:email/reject', async (c) => {
  ensure(can.manageUsers(c.get('user')), 'Chỉ PMO / MNG mới duyệt tài khoản');
  const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
  try {
    await c.get('accounts').reject(email);
  } catch (e) {
    if (e instanceof NotPendingError) throw new HTTPException(404, { message: `${email} không có trong danh sách chờ duyệt` });
    throw e;
  }
  return c.json({ ok: true });
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

// --- Telegram bot (one per system; the token is write-only) ---

admin.get('/settings/telegram', async (c) => {
  const bot = await c.get('store').getTelegramBot();
  return c.json({ configured: !!bot, username: bot?.username });
});

admin.put('/settings/telegram', async (c) => {
  ensure(can.admin(c.get('user')), 'Chỉ PMO / quản lý mới cài bot Telegram');
  const { token } = await parseBody(c.req, telegramBotSchema);
  if (!looksLikeBotToken(token)) throw new HTTPException(400, { message: 'Token không đúng dạng 123456789:AA… (lấy từ @BotFather)' });
  let username: string;
  try {
    ({ username } = await c.get('telegram').getMe(token));
  } catch (e) {
    throw new HTTPException(400, { message: `Telegram không chấp nhận token: ${(e as Error).message}` });
  }
  await c.get('store').putTelegramBot({ token, username });
  return c.json({ configured: true, username });
});

admin.delete('/settings/telegram', async (c) => {
  ensure(can.admin(c.get('user')), 'Chỉ PMO / quản lý mới gỡ bot Telegram');
  await c.get('store').putTelegramBot(undefined);
  return c.json({ configured: false });
});
