// Connect codes (PT-XXXXX): which chat sent them. With a webhook the bot remembers them for a
// day (getUpdates no longer works then); bots without one still read their pending updates.
import type { Store } from '../store/store.js';
import type { TelegramBot } from '../types.js';
import type { TelegramChat, TelegramClient } from '../notify/telegram.js';

/** Telegram kept a bot's pending updates ~24h, so codes are remembered as long. */
export const CODE_TTL_SECONDS = 24 * 3600;
const CODE = /\bPT-[A-Z0-9]{5}\b/gi;
const SEEN_KEY = 'tgseen';
const MAX_SEEN = 20;

const codeKey = (code: string) => `tgcode#${code.toUpperCase()}`;

interface Seen {
  title: string;
  at: number; // ms
}

/** Remembers the chat a message with connect codes came from, and the group titles seen (to explain a miss). */
export async function captureCodes(store: Store, text: string, chat: TelegramChat): Promise<boolean> {
  const codes = [...new Set((text.match(CODE) ?? []).map((c) => c.toUpperCase()))];
  for (const code of codes) await store.putTemp(codeKey(code), chat, CODE_TTL_SECONDS);
  // Only groups are listed in the "bot only received messages from…" hint: never people's private chats.
  if (chat.type !== 'private') {
    const since = Date.now() - CODE_TTL_SECONDS * 1000;
    const seen = ((await store.getTemp<Seen[]>(SEEN_KEY)) ?? []).filter((s) => s.at > since && s.title !== chat.title);
    await store.putTemp(SEEN_KEY, [{ title: chat.title, at: Date.now() }, ...seen].slice(0, MAX_SEEN), CODE_TTL_SECONDS);
  }
  return codes.length > 0;
}

/** The chat that sent `code`; `seen` lists other chats the bot heard from, newest first. */
export async function findChatByCode(
  store: Store,
  telegram: TelegramClient,
  bot: TelegramBot,
  code: string,
): Promise<{ chat?: TelegramChat; seen: string[] }> {
  if (!bot.webhookSecret) return telegram.findChatByText(bot.token, code);
  const chat = await store.getTemp<TelegramChat>(codeKey(code.trim()));
  if (chat) return { chat, seen: [] };
  const since = Date.now() - CODE_TTL_SECONDS * 1000;
  const seen = ((await store.getTemp<Seen[]>(SEEN_KEY)) ?? []).filter((s) => s.at > since).map((s) => s.title);
  return { seen };
}
