// Local dev server: in-memory store pre-loaded with sample data, auth via `x-dev-user` header.
//   npm run dev        → http://localhost:3001
//   curl -H 'x-dev-user: lan@example.com' localhost:3001/dashboard
import { serve } from '@hono/node-server';
import { MemoryAccounts } from './accounts.js';
import { blankAction, claudeClient, type AiClient } from './ai/assistant.js';
import { createApp } from './app.js';
import type { Message } from './notify/message.js';
import type { PushSender } from './notify/push.js';
import { flushDue } from './notify/pipeline.js';
import { createSender } from './notify/sender.js';
import { telegramClient, type TelegramClient } from './notify/telegram.js';
import { loadSample } from './seed/sample.js';
import { MemoryStore } from './store/memory.js';

const store = new MemoryStore();
await loadSample(store, new Date());

const port = Number(process.env.PORT ?? 3001);
// Alerts are printed instead of sent unless LOCAL_SEND=1 (then a real Teams URL / Telegram bot is needed).
const send = process.env.LOCAL_SEND
  ? createSender(store)
  : async (ch: { kind: string; name: string }, msg: Message) =>
      console.log(`[${ch.kind} → ${ch.name}] ${msg.title}\n  ${msg.lines.map((l) => l.text).join('\n  ')}`);
// Two sample sign-ups waiting for PMO approval; the sample users have login accounts,
// users added later (Users page or a new x-dev-user) show as "no login account".
const accounts = new MemoryAccounts(
  [
    { email: 'thao@example.com', name: 'Thảo', createdAt: new Date().toISOString() },
    { email: 'vinh@example.com', name: 'Vinh', createdAt: new Date().toISOString() },
  ],
  new Set((await store.listUsers()).map((u) => u.id)),
);
// Fake Telegram (any token accepted, every connect code "found") unless LOCAL_SEND=1.
const telegram: TelegramClient = process.env.LOCAL_SEND
  ? telegramClient
  : {
      getMe: async () => ({ username: 'local_dev_bot' }),
      findChatByText: async () => ({ chat: { id: '-100123', title: 'Nhóm thử (local)' }, seen: [] }),
      sendMessage: async (_t, chatId, html, buttons) =>
        console.log(`[telegram → ${chatId}]`, html, buttons?.length ? buttons.map((b) => `[${b.label}]`).join(' ') : ''),
      // No public HTTPS URL locally: the bot stays one-way (connect codes through findChatByText above).
      setWebhook: async () => {
        throw new Error('local dev: no webhook (set LOCAL_SEND=1 and use a public HTTPS URL)');
      },
      deleteWebhook: async () => {},
      getWebhookInfo: async () => ({ url: '', pendingUpdates: 0 }),
      answerCallbackQuery: async () => {},
      clearButtons: async () => {},
    };
// Real Claude when ANTHROPIC_API_KEY is set (the key is pre-installed as if PMO saved it);
// otherwise a fake that turns each "P01 …" sentence into an update and answers questions with the red projects.
const ai: AiClient = process.env.ANTHROPIC_API_KEY
  ? claudeClient
  : {
      verifyKey: async () => {},
      extract: async (_key, _ctx, text) => {
        // One update per "P01 …" sentence; a note without a code becomes one update with no project.
        const found = [...text.matchAll(/\b(P\d{2})\b[^.\n]*/gi)].map((m) => ({ id: m[1], text: m[0] }));
        const parts = found.length ? found : [{ id: '', text }];
        return {
          actions: parts.map((part) =>
            blankAction({
              kind: 'update',
              projectId: part.id,
              health: /đỏ|red/i.test(part.text) ? 'red' : /vàng|yellow/i.test(part.text) ? 'yellow' : null,
              summary: part.text,
            }),
          ),
          questions: [],
        };
      },
      ask: async (_key, context, messages) => {
        // Echo the question and list the red projects found in the context.
        const red = context
          .split('\n### ')
          .slice(1)
          .filter((block) => block.includes('Trạng thái: Đỏ'))
          .map((block) => `- **${block.split('\n')[0]}**`);
        const q = messages.at(-1)!.content;
        return { answer: `(AI giả lập) Bạn hỏi: "${q}".\nDự án đang Đỏ:\n${red.join('\n') || '- không có'}`, truncated: false };
      },
    };
// Web Push payloads are printed unless LOCAL_SEND=1 (then they go to the browser's push service).
const push: PushSender | undefined = process.env.LOCAL_SEND
  ? undefined
  : async (req) => console.log(`[push → ${new URL(req.subscription.endpoint).hostname}] ${req.payload}`);
if (process.env.ANTHROPIC_API_KEY) await store.putAiConfig({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = createApp({
  store,
  auth: { mode: 'dev', adminEmails: [] },
  publicCacheSeconds: 0,
  send,
  telegram,
  webUrl: 'http://localhost:5173',
  accounts,
  ai,
  push,
});
// Like the FlushFn Lambda: messages held in the outbox (grouped high-priority issues, retries) go out every minute.
setInterval(() => void flushDue({ store, send, webUrl: 'http://localhost:5173', push }, new Date()).catch((e) => console.error('outbox', e)), 60_000);
serve({ fetch: app.fetch, port });
console.log(`API dev server: http://localhost:${port}  (header x-dev-user: lan@example.com)`);
