// Local dev server: in-memory store pre-loaded with sample data, auth via `x-dev-user` header.
//   npm run dev        → http://localhost:3001
//   curl -H 'x-dev-user: lan@example.com' localhost:3001/dashboard
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadSample } from './seed/sample.js';
import { MemoryStore } from './store/memory.js';

const store = new MemoryStore();
await loadSample(store, new Date());

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: createApp({ store, auth: { mode: 'dev', adminEmails: [] }, publicCacheSeconds: 0 }).fetch, port });
console.log(`API dev server: http://localhost:${port}  (header x-dev-user: lan@example.com)`);
