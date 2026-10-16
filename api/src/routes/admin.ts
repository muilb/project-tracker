import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { l } from '../i18n.js';
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
  ensure(can.manageUsers(c.get('user')), l('Chỉ PMO / MNG mới duyệt tài khoản', 'アカウントの承認は PMO / MNG のみ行えます'));
  return c.json({ pending: await c.get('accounts').listPending() });
});

admin.post('/users/pending/:email/approve', async (c) => {
  ensure(can.manageUsers(c.get('user')), l('Chỉ PMO / MNG mới duyệt tài khoản', 'アカウントの承認は PMO / MNG のみ行えます'));
  const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
  const body = await parseBody(c.req, approveAccountSchema);
  let account;
  try {
    account = await c.get('accounts').approve(email);
  } catch (e) {
    if (e instanceof NotPendingError)
      throw new HTTPException(404, { message: l(`${email} không có trong danh sách chờ duyệt`, `${email} は承認待ちリストにありません`) });
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
  ensure(can.manageUsers(c.get('user')), l('Chỉ PMO / MNG mới duyệt tài khoản', 'アカウントの承認は PMO / MNG のみ行えます'));
  const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
  try {
    await c.get('accounts').reject(email);
  } catch (e) {
    if (e instanceof NotPendingError)
      throw new HTTPException(404, { message: l(`${email} không có trong danh sách chờ duyệt`, `${email} は承認待ちリストにありません`) });
    throw e;
  }
  return c.json({ ok: true });
});

/** Pre-create a user (e.g. a GL) before they log in for the first time. */
admin.post('/users', async (c) => {
  const store = c.get('store');
  ensure(can.manageUsers(c.get('user')), l('Chỉ PMO / MNG mới được thêm người dùng', 'ユーザーの追加は PMO / MNG のみ行えます'));
  const body = await parseBody(c.req, createUserSchema);
  if (await store.getUser(body.id)) throw new HTTPException(409, { message: l(`${body.id} đã tồn tại`, `${body.id} は既に存在します`) });
  const user: User = { ...body, createdAt: c.get('now').toISOString() };
  await store.putUser(user);
  return c.json({ user }, 201);
});

admin.patch('/users/:id', async (c) => {
  const store = c.get('store');
  ensure(can.manageUsers(c.get('user')), l('Chỉ PMO / MNG mới được sửa người dùng', 'ユーザーの編集は PMO / MNG のみ行えます'));
  const user = await store.getUser(c.req.param('id').toLowerCase());
  if (!user) throw new HTTPException(404, { message: l('Không tìm thấy người dùng', 'ユーザーが見つかりません') });
  const updated = { ...user, ...(await parseBody(c.req, patchUserSchema)) };
  await store.putUser(updated);
  return c.json({ user: updated });
});

admin.get('/settings', async (c) => c.json({ settings: await c.get('store').getSettings() }));

admin.put('/settings', async (c) => {
  ensure(can.admin(c.get('user')), l('Chỉ PMO / quản lý mới được sửa cài đặt', '設定の変更は PMO / 管理者のみ行えます'));
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
  ensure(can.admin(c.get('user')), l('Chỉ PMO / quản lý mới cài bot Telegram', 'Telegram ボットの設定は PMO / 管理者のみ行えます'));
  const { token } = await parseBody(c.req, telegramBotSchema);
  if (!looksLikeBotToken(token))
    throw new HTTPException(400, {
      message: l(
        'Token không đúng dạng 123456789:AA… (lấy từ @BotFather)',
        'トークンの形式が 123456789:AA… ではありません（@BotFather で取得）',
      ),
    });
  let username: string;
  try {
    ({ username } = await c.get('telegram').getMe(token));
  } catch (e) {
    throw new HTTPException(400, {
      message: l('Telegram không chấp nhận token: ', 'Telegram がトークンを受け付けません: ') + (e as Error).message,
    });
  }
  await c.get('store').putTelegramBot({ token, username });
  return c.json({ configured: true, username });
});

admin.delete('/settings/telegram', async (c) => {
  ensure(can.admin(c.get('user')), l('Chỉ PMO / quản lý mới gỡ bot Telegram', 'Telegram ボットの削除は PMO / 管理者のみ行えます'));
  await c.get('store').putTelegramBot(undefined);
  return c.json({ configured: false });
});
