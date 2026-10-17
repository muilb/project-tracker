// The signed-in person's own notification settings and web inbox.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env.js';
import { l, lang } from '../i18n.js';
import { prefsOf } from '../notify/personal.js';
import { inboxReadSchema, notifyPrefsSchema, parseBody } from '../schemas.js';
import { inboxCursor } from '../store/store.js';
import type { NotifyPrefs } from '../types.js';

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
const notYet = () => {
  throw new HTTPException(501, { message: l('Chức năng này chưa khả dụng', 'この機能はまだ利用できません') });
};
me.post('/notify/telegram/link', notYet);
me.post('/notify/telegram/confirm', notYet);
me.post('/notify/test', notYet);

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
