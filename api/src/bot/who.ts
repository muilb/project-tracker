// Who wrote to the bot: a linked person (private chat), a group linked as a channel, or nobody we know.
import type { Lang } from '../i18n.js';
import type { NotifyDeps } from '../notify/deps.js';
import type { AiClient } from '../ai/assistant.js';
import type { TelegramClient } from '../notify/telegram.js';
import type { Store } from '../store/store.js';
import type { Channel, NotifyPrefs, TelegramBot, User } from '../types.js';

export interface BotDeps {
  store: Store;
  notify: NotifyDeps;
  telegram: TelegramClient;
  ai: AiClient;
  now: Date;
  bot: TelegramBot;
}

// Only the fields of Telegram updates the bot reads.
export interface TgChat {
  id: number;
  type?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}
export interface TgUser {
  id: number;
  language_code?: string;
}
export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  migrate_to_chat_id?: number;
}
export interface TgCallback {
  id: string;
  from: TgUser;
  data?: string;
  message?: { message_id: number; chat: TgChat };
}
export interface TgMemberUpdate {
  chat: TgChat;
  from?: TgUser;
  new_chat_member?: { status?: string };
}
export interface TgUpdate {
  update_id?: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  my_chat_member?: TgMemberUpdate;
  callback_query?: TgCallback;
}

export type Asker =
  | { kind: 'person'; user: User; prefs: NotifyPrefs; lang: Lang }
  | { kind: 'group'; channel: Channel; owner: User; lang: Lang }
  | { kind: 'unknown'; private: boolean; lang: Lang };

export const chatTitle = (c: TgChat) => c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id));

/** Language of someone the system does not know yet: their Telegram app language. */
export const guessLang = (from?: TgUser): Lang => (from?.language_code?.toLowerCase().startsWith('ja') ? 'ja' : 'vi');

/** The person whose personal Telegram is this private chat. */
export async function personByChat(store: Store, chatId: string) {
  const prefs = (await store.listNotifyPrefs()).find((p) => p.telegramChatId === chatId);
  const user = prefs && (await store.getUser(prefs.userId));
  return prefs && user ? { prefs, user } : undefined;
}

/** Telegram channels sending to this group, enabled ones first. */
export async function channelsByChat(store: Store, chatId: string) {
  return (await store.listChannels())
    .filter((ch) => ch.kind === 'telegram' && ch.telegramChatId === chatId)
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id));
}

export async function whoIs(store: Store, chat: TgChat, from?: TgUser): Promise<Asker> {
  const id = String(chat.id);
  if (chat.type === 'private') {
    const found = await personByChat(store, id);
    if (found) return { kind: 'person', ...found, lang: found.prefs.lang ?? guessLang(from) };
    return { kind: 'unknown', private: true, lang: guessLang(from) };
  }
  // A group answers with the first channel's scope and what its creator may see.
  for (const channel of await channelsByChat(store, id)) {
    const owner = await store.getUser(channel.createdBy);
    if (owner) return { kind: 'group', channel, owner, lang: channel.lang ?? 'vi' };
  }
  return { kind: 'unknown', private: false, lang: guessLang(from) };
}
