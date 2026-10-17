// The signed-in person's own notification settings and web inbox.
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../env.js';
import { l, lang, withLang } from '../i18n.js';
import { send } from '../notify/deliver.js';
import { personalTestMessage, prefsOf } from '../notify/personal.js';
import { personalKey } from '../notify/routePersonal.js';
import { testPush } from './push.js';
import { renderTelegram } from '../notify/telegram.js';
import { inboxReadSchema, notifyPrefsSchema, parseBody } from '../schemas.js';
import { inboxCursor } from '../store/store.js';
import type { Channel, NotifyPrefs } from '../types.js';

export const me = new Hono<AppEnv>();

const INBOX_PAGE = 30;

/** The chat id is not a secret, but other people never see it; the owner only needs its title. */
const publicPrefs = ({ telegramChatId, ...rest }: NotifyPrefs) => ({ ...rest, telegramLinked: !!telegramChatId });

me.get('/notify', async (c) => {
  const store = c.get('store');
  const [prefs, bot] = await Promise.all([prefsOf(store, c.get('user'), c.get('now')), store.getTelegramBot()]);
  return c.json({ prefs: publicPrefs(prefs), telegramBot: bot?.username });
});

me.put('/notify', async (c) => {
  const store = c.get('store');
  const user = c.get('user');
  const body = await parseBody(c.req, notifyPrefsSchema);
  const current = await prefsOf(store, user, c.get('now'));
  const prefs: NotifyPrefs = {
    ...current,
    ...body,
    pausedUntil: body.pausedUntil ?? undefined,
    lang: body.lang ?? current.lang ?? lang(),
    // Telegram can only be switched on once a chat is linked.
    telegram: body.telegram && !!current.telegramChatId,
    watch: [...new Set(body.watch)],
    push: body.push ?? current.push ?? false, // track H
    userId: user.id,
    updatedAt: c.get('now').toISOString(),
  };
  await store.putNotifyPrefs(prefs);
  return c.json({ prefs: publicPrefs(prefs) });
});

me.delete('/notify/telegram', async (c) => {
  const store = c.get('store');
  const current = await prefsOf(store, c.get('user'), c.get('now'));
  const prefs: NotifyPrefs = {
    ...current,
    telegram: false,
    telegramChatId: undefined,
    telegramChatTitle: undefined,
    updatedAt: c.get('now').toISOString(),
  };
  await store.putNotifyPrefs(prefs);
  return c.json({ prefs: publicPrefs(prefs) });
});

// track A: link a personal Telegram chat (t.me/<bot>?start=CODE) and send a personal test message.

/** Connect codes stay valid for a day (Telegram keeps the bot's pending messages ~24h). */
const CODE_DAYS = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => `PT-${Array.from(randomBytes(5), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')}`;
const codeKey = (userId: string, code: string) => personalKey(userId, `tglink#${code}`);

const confirmSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^PT-[A-Z0-9]{5}$/, { error: () => l('Mã kết nối không hợp lệ', '接続コードが正しくありません') }),
});

async function systemBot(c: Context<AppEnv>) {
  const bot = await c.get('store').getTelegramBot();
  if (!bot)
    throw new HTTPException(400, {
      message: l(
        'Quản trị hệ thống chưa cài bot Telegram (Cài đặt → Telegram)',
        'システム管理者が Telegram ボットを未設定です（設定 → Telegram）',
      ),
    });
  return bot;
}

me.post('/notify/telegram/link', async (c) => {
  const bot = await systemBot(c);
  const code = newCode();
  await c.get('store').markSent(codeKey(c.get('user').id, code), CODE_DAYS);
  return c.json({ code, url: `https://t.me/${bot.username}?start=${code}`, bot: bot.username });
});

me.post('/notify/telegram/confirm', async (c) => {
  const store = c.get('store');
  const user = c.get('user');
  const { code } = await parseBody(c.req, confirmSchema);
  if (!(await store.hasSent(codeKey(user.id, code))) || (await store.hasSent(codeKey(user.id, `${code}#used`))))
    throw new HTTPException(400, {
      message: l(
        'Mã kết nối đã hết hạn hoặc không phải của bạn — hãy tạo mã mới',
        '接続コードの期限切れか、あなたのコードではありません。新しいコードを作成してください',
      ),
    });
  const bot = await systemBot(c);
  let chat;
  try {
    ({ chat } = await c.get('telegram').findChatByText(bot.token, code));
  } catch (e) {
    throw new HTTPException(502, {
      message: l('Không đọc được tin nhắn của bot: ', 'ボットのメッセージを読み込めません: ') + (e as Error).message,
    });
  }
  // Other people's chats are never listed here (they are private chats with the same bot).
  if (!chat)
    throw new HTTPException(400, {
      message: l(
        `Bot chưa nhận được mã ${code}. Mở link, bấm Start (Bắt đầu) trong chat với @${bot.username}, rồi thử lại.`,
        `ボットはコード ${code} を受信していません。リンクを開き、@${bot.username} とのチャットで「開始」(Start) を押してから、もう一度お試しください。`,
      ),
    });
  if (chat.type !== 'private')
    throw new HTTPException(400, {
      message: l(
        `Mã ${code} được gửi trong một nhóm. Thông báo cá nhân chỉ gửi vào chat riêng: mở link và bấm Start trong chat với @${bot.username}.`,
        `コード ${code} はグループで送信されました。個人通知は個人チャットにのみ届きます。リンクを開き、@${bot.username} とのチャットで「開始」を押してください。`,
      ),
    });

  const current = await prefsOf(store, user, c.get('now'));
  const language = current.lang ?? lang();
  try {
    await c.get('telegram').sendMessage(
      bot.token,
      chat.id,
      withLang(language, () => renderTelegram(personalTestMessage(c.get('notify')))),
    );
  } catch (e) {
    throw new HTTPException(502, {
      message: l('Không gửi được tin thử tới Telegram: ', 'Telegram にテストを送信できません: ') + (e as Error).message,
    });
  }
  const prefs: NotifyPrefs = {
    ...current,
    telegram: true,
    telegramChatId: chat.id,
    telegramChatTitle: chat.title,
    lang: language,
    updatedAt: c.get('now').toISOString(),
  };
  await store.putNotifyPrefs(prefs);
  await store.markSent(codeKey(user.id, `${code}#used`), CODE_DAYS);
  return c.json({ prefs: publicPrefs(prefs) });
});

/**
 * A test message to the inbox, to the linked Telegram chat (whether or not it is switched on),
 * and to every browser / phone when Web Push is on.
 */
me.post('/notify/test', async (c) => {
  const deps = c.get('notify');
  const now = c.get('now');
  const prefs = await prefsOf(deps.store, c.get('user'), now);
  const message = withLang(prefs.lang ?? lang(), () => personalTestMessage(deps));
  const inbox = await send(deps, { target: { userId: prefs.userId, via: 'inbox' }, event: 'test', message }, now);
  const push = prefs.push ? await testPush(deps, prefs.userId, message, now) : undefined; // track H
  if (!prefs.telegramChatId) return c.json({ inbox, push });
  try {
    await deps.send({ id: `U:${prefs.userId}`, kind: 'telegram', telegramChatId: prefs.telegramChatId } as Channel, message);
    return c.json({ inbox, telegram: { ok: true }, push });
  } catch (e) {
    return c.json({ inbox, telegram: { ok: false, error: (e as Error).message.slice(0, 300) }, push });
  }
});

me.get('/inbox', async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const before = c.req.query('before') || undefined;
  const [page, unread] = await Promise.all([store.listInbox(userId, INBOX_PAGE + 1, before), store.countUnread(userId)]);
  const entries = page.slice(0, INBOX_PAGE);
  return c.json({ entries, unread, nextBefore: page.length > INBOX_PAGE ? inboxCursor(entries.at(-1)!) : undefined });
});

me.post('/inbox/read', async (c) => {
  const store = c.get('store');
  const userId = c.get('user').id;
  const body = await parseBody(c.req, inboxReadSchema);
  await store.markInboxRead(userId, body.all ? 'all' : body.ids!, c.get('now').toISOString());
  return c.json({ unread: await store.countUnread(userId) });
});
