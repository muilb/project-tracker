import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { audit } from '../audit.js';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { l } from '../i18n.js';
import { randomInt } from 'node:crypto';
import { NoAccountError, NotPendingError, UnconfirmedError } from '../accounts.js';
import { looksLikeBotToken } from '../notify/telegram.js';
import { approveAccountSchema, createUserSchema, parseBody, patchUserSchema, settingsSchema, telegramBotSchema } from '../schemas.js';
import type { User } from '../types.js';

export const admin = new Hono<AppEnv>();

const ONLY_ADMIN_ROLE = () => l('Chỉ Quản trị hệ thống mới cấp được vai trò ADMIN', 'ADMIN ロールを付与できるのはシステム管理者のみです');

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
  ensure(body.role !== 'ADMIN' || can.system(c.get('user')), ONLY_ADMIN_ROLE());
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
  await audit(store, c.get('now'), c.get('user').id, 'account_approve', email, user.role);
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
  await audit(c.get('store'), c.get('now'), c.get('user').id, 'account_reject', email);
  return c.json({ ok: true });
});

/** Pre-create a user (e.g. a GL) before they log in for the first time. */
admin.post('/users', async (c) => {
  const store = c.get('store');
  ensure(can.manageUsers(c.get('user')), l('Chỉ PMO / MNG mới được thêm người dùng', 'ユーザーの追加は PMO / MNG のみ行えます'));
  const body = await parseBody(c.req, createUserSchema);
  ensure(body.role !== 'ADMIN' || can.system(c.get('user')), ONLY_ADMIN_ROLE());
  if (await store.getUser(body.id)) throw new HTTPException(409, { message: l(`${body.id} đã tồn tại`, `${body.id} は既に存在します`) });
  const user: User = { ...body, createdAt: c.get('now').toISOString() };
  await store.putUser(user);
  await audit(store, c.get('now'), c.get('user').id, 'user_create', user.id, user.role);
  return c.json({ user }, 201);
});

admin.patch('/users/:id', async (c) => {
  const store = c.get('store');
  ensure(can.manageUsers(c.get('user')), l('Chỉ PMO / MNG mới được sửa người dùng', 'ユーザーの編集は PMO / MNG のみ行えます'));
  const me = c.get('user');
  const user = await store.getUser(c.req.param('id').toLowerCase());
  if (!user) throw new HTTPException(404, { message: l('Không tìm thấy người dùng', 'ユーザーが見つかりません') });
  const body = await parseBody(c.req, patchUserSchema);
  const roleChange = body.role && body.role !== user.role;
  if (roleChange) {
    ensure(
      can.manageAccount(me, user),
      l('Chỉ Quản trị hệ thống mới đổi được vai trò của tài khoản ADMIN', 'ADMIN アカウントのロールを変更できるのはシステム管理者のみです'),
    );
    ensure(body.role !== 'ADMIN' || can.system(me), ONLY_ADMIN_ROLE());
    if (user.id === me.id)
      throw new HTTPException(400, { message: l('Không tự đổi vai trò của chính mình', '自分自身のロールは変更できません') });
  }
  const updated = { ...user, ...body };
  await store.putUser(updated);
  if (roleChange) await audit(store, c.get('now'), me.id, 'role_change', user.id, `${user.role} → ${updated.role}`);
  return c.json({ user: updated });
});

/** 10 characters, lowercase letters and digits (the pool policy), no look-alikes (l / 1, o / 0). */
function temporaryPassword(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < 10) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Forgotten password when the reset email does not arrive: PMO / MNG hand out a one-time password. */
admin.post('/users/:id/reset-password', async (c) => {
  const me = c.get('user');
  ensure(can.manageUsers(me), l('Chỉ PMO / MNG mới đặt lại mật khẩu', 'パスワードの再設定は PMO / MNG のみ行えます'));
  const email = decodeURIComponent(c.req.param('id')).trim().toLowerCase();
  if (email === me.id)
    throw new HTTPException(400, {
      message: l(
        'Không tự đặt lại mật khẩu của mình ở đây — dùng "Quên mật khẩu" ở trang đăng nhập',
        '自分のパスワードはここでは再設定できません。ログイン画面の「パスワードを忘れた場合」を使ってください',
      ),
    });
  ensure(
    can.manageAccount(me, await c.get('store').getUser(email)),
    l(
      'Chỉ Quản trị hệ thống mới đặt lại mật khẩu của tài khoản ADMIN',
      'ADMIN アカウントのパスワードを再設定できるのはシステム管理者のみです',
    ),
  );
  const password = temporaryPassword();
  try {
    await c.get('accounts').setTemporaryPassword(email, password);
  } catch (e) {
    if (e instanceof NoAccountError)
      throw new HTTPException(404, {
        message: l(`${email} chưa đăng ký tài khoản đăng nhập`, `${email} はログインアカウントを登録していません`),
      });
    if (e instanceof UnconfirmedError)
      throw new HTTPException(400, {
        message: l(
          `${email} đang chờ duyệt — duyệt ở mục "Chờ duyệt" trước`,
          `${email} は承認待ちです。先に「承認待ち」で承認してください`,
        ),
      });
    throw e;
  }
  await audit(c.get('store'), c.get('now'), me.id, 'password_reset', email);
  return c.json({ password });
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
  ensure(can.system(c.get('user')), l('Chỉ Quản trị hệ thống mới cài bot Telegram', 'Telegram ボットの設定はシステム管理者のみ行えます'));
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
  const before = await c.get('store').getTelegramBot();
  await c.get('store').putTelegramBot({ token, username });
  await audit(
    c.get('store'),
    c.get('now'),
    c.get('user').id,
    'telegram_set',
    `@${username}`,
    before ? `@${before.username} → @${username}` : undefined,
  );
  return c.json({ configured: true, username });
});

admin.delete('/settings/telegram', async (c) => {
  ensure(can.system(c.get('user')), l('Chỉ Quản trị hệ thống mới gỡ bot Telegram', 'Telegram ボットの削除はシステム管理者のみ行えます'));
  await c.get('store').putTelegramBot(undefined);
  await audit(c.get('store'), c.get('now'), c.get('user').id, 'telegram_remove');
  return c.json({ configured: false });
});

/** Administrative log (ADMIN): accounts, roles, passwords, secrets, deletes and restores. */
admin.get('/audit', async (c) => {
  ensure(can.system(c.get('user')), l('Chỉ Quản trị hệ thống mới xem được nhật ký', '操作ログはシステム管理者のみ閲覧できます'));
  return c.json({ entries: await c.get('store').listAudit(200) });
});
