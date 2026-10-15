// Local dev server: in-memory store pre-loaded with sample data, auth via `x-dev-user` header.
//   npm run dev        → http://localhost:3001
//   curl -H 'x-dev-user: lan@example.com' localhost:3001/dashboard
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { maskUrl, sendTeams } from './notify/teams.js';
import { loadSample } from './seed/sample.js';
import { MemoryStore } from './store/memory.js';

const store = new MemoryStore();
await loadSample(store, new Date());

const port = Number(process.env.PORT ?? 3001);
// Teams messages are printed instead of sent unless LOCAL_SEND_TEAMS=1.
const send = process.env.LOCAL_SEND_TEAMS
  ? sendTeams
  : async (url: string, payload: unknown) => console.log(`[teams → ${maskUrl(url)}]`, JSON.stringify(payload).slice(0, 300));
const app = createApp({ store, auth: { mode: 'dev', adminEmails: [] }, publicCacheSeconds: 0, send, webUrl: 'http://localhost:5173' });
serve({ fetch: app.fetch, port });
console.log(`API dev server: http://localhost:${port}  (header x-dev-user: lan@example.com)`);
