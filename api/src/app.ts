import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { MemoryAccounts, type Accounts } from './accounts.js';
import { claudeClient, type AiClient } from './ai/assistant.js';
import { parseInitialRoles, requireUser, type AuthConfig } from './auth.js';
import type { AppEnv } from './env.js';
import { langFromHeader, withLang } from './i18n.js';
import type { Sender } from './notify/sender.js';
import { telegramClient, type TelegramClient } from './notify/telegram.js';
import { admin } from './routes/admin.js';
import { ai as aiRoutes } from './routes/ai.js';
import { channels } from './routes/channels.js';
import { me } from './routes/me.js';
import { projects } from './routes/projects.js';
import { telegramWebhook } from './routes/telegram.js';
import { trash } from './routes/trash.js';
import type { Store } from './store/store.js';
import { buildDashboard, buildPublic } from './views.js';

export interface AppDeps {
  store: Store;
  auth: AuthConfig;
  clock?: () => Date;
  /** Seconds the public dashboard response is cached in memory. */
  publicCacheSeconds?: number;
  /** Delivers alerts to Teams / Telegram (tests pass a fake). */
  send: Sender;
  /** Telegram API for bot setup and chat discovery (tests pass a fake). */
  telegram?: TelegramClient;
  /** Web app base URL for links in Teams messages. */
  webUrl?: string;
  /** Pending sign-ups (Cognito in Lambda, in-memory elsewhere). */
  accounts?: Accounts;
  /** Claude API for natural-language entry (tests pass a fake). */
  ai?: AiClient;
}

export function createApp({
  store,
  auth,
  clock = () => new Date(),
  publicCacheSeconds = 30,
  send,
  webUrl,
  accounts = new MemoryAccounts(),
  telegram = telegramClient,
  ai = claudeClient,
}: AppDeps) {
  const notify = { store, send, webUrl };
  const initialRoles = parseInitialRoles(auth.adminEmails);
  const app = new Hono<AppEnv>();

  app.use('*', cors());
  app.use('*', (c, next) => withLang(langFromHeader(c.req.header('accept-language')), next));
  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('now', clock());
    c.set('notify', notify);
    c.set('accounts', accounts);
    c.set('initialRoles', initialRoles);
    c.set('telegram', telegram);
    c.set('ai', ai);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: langFromHeader(c.req.header('accept-language')) === 'ja' ? 'システムエラー' : 'Lỗi hệ thống' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  // --- No login required ---
  app.get('/health', (c) => c.json({ ok: true }));

  let publicCache: { at: number; body: unknown } | undefined;
  app.get('/public', async (c) => {
    const nowMs = c.get('now').getTime();
    if (!publicCache || nowMs - publicCache.at > publicCacheSeconds * 1000) {
      publicCache = { at: nowMs, body: buildPublic(await store.snapshot(), c.get('now')) };
    }
    c.header('Cache-Control', `public, max-age=${publicCacheSeconds}`);
    return c.json(publicCache.body);
  });

  // track G: Telegram updates, checked by the webhook's secret token instead of a login.
  app.route('/telegram', telegramWebhook);

  // --- Login required ---
  app.use('*', requireUser(auth));

  app.get('/dashboard', async (c) => {
    const { scope, gl } = c.req.query();
    const snap = await store.snapshot();
    return c.json(buildDashboard(snap, c.get('now'), c.get('user'), { scope: scope === 'mine' ? 'mine' : 'all', gl: gl || undefined }));
  });
  app.route('/', admin);
  app.route('/', aiRoutes);
  app.route('/projects', projects);
  app.route('/channels', channels);
  app.route('/me', me);
  app.route('/trash', trash);

  return app;
}
