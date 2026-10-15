import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requireUser, type AuthConfig } from './auth.js';
import type { AppEnv } from './env.js';
import { admin } from './routes/admin.js';
import { projects } from './routes/projects.js';
import type { Store } from './store/store.js';
import { buildDashboard, buildPublic } from './views.js';

export interface AppDeps {
  store: Store;
  auth: AuthConfig;
  clock?: () => Date;
  /** Seconds the public dashboard response is cached in memory. */
  publicCacheSeconds?: number;
}

export function createApp({ store, auth, clock = () => new Date(), publicCacheSeconds = 30 }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', cors());
  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('now', clock());
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Lỗi hệ thống' }, 500);
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

  // --- Login required ---
  app.use('*', requireUser(auth));

  app.get('/dashboard', async (c) => {
    const { scope, gl } = c.req.query();
    const snap = await store.snapshot();
    return c.json(
      buildDashboard(snap, c.get('now'), c.get('user'), { scope: scope === 'mine' ? 'mine' : 'all', gl: gl || undefined }),
    );
  });
  app.route('/', admin);
  app.route('/projects', projects);

  return app;
}
