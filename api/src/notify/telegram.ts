// Telegram delivery through one system bot (created with @BotFather, token set by PMO in Settings).
import { l } from '../i18n.js';
import { PermanentDeliveryError } from './errors.js';
import type { TelegramBot } from '../types.js';
import type { Message, MessageAction } from './message.js';

export interface TelegramChat {
  id: string;
  title: string;
  /** 'private' | 'group' | 'supergroup' | 'channel' (personal links accept only private chats). */
  type?: string;
}

export interface TelegramClient {
  /** Validates a bot token; returns the bot's @username (without @). */
  getMe(token: string): Promise<{ username: string }>;
  /**
   * Pending updates (Telegram keeps them ~24h); used to find the chat that sent a connect code
   * while the bot has no webhook (see bot/codes.ts). `seen` lists the chats the bot received anything from, to explain a miss.
   */
  findChatByText(token: string, needle: string): Promise<{ chat?: TelegramChat; seen: string[] }>;
  /** `buttons`: an inline keyboard, one button per row. */
  sendMessage(token: string, chatId: string, html: string, buttons?: MessageAction[]): Promise<void>;
  // track G: two-way bot (updates arrive at POST /telegram/webhook).
  setWebhook(token: string, url: string, secret: string): Promise<void>;
  deleteWebhook(token: string): Promise<void>;
  getWebhookInfo(token: string): Promise<TelegramWebhookInfo>;
  /** Ends the button's loading state, with a short toast. */
  answerCallbackQuery(token: string, callbackId: string, text?: string): Promise<void>;
  /** Removes the buttons under a message (once acted on). */
  clearButtons(token: string, chatId: string, messageId: number): Promise<void>;
}

export interface TelegramWebhookInfo {
  url: string;
  pendingUpdates: number;
  /** Telegram's last delivery error to the webhook, with its time (ISO). */
  lastError?: string;
  lastErrorAt?: string;
}

/** Updates the webhook asks Telegram for. */
export const WEBHOOK_UPDATES = ['message', 'channel_post', 'my_chat_member', 'callback_query'];

/** The group became a supergroup: Telegram gives its new chat id, the message must be sent there. */
export class TelegramMigratedError extends Error {
  constructor(public newChatId: string) {
    super(`Telegram: group migrated to a supergroup (${newChatId})`);
  }
}

/** A clear, bilingual reason for the Telegram errors people can fix themselves; permanent ones are not retried. */
export function telegramError(status: number, description = ''): Error {
  const d = description.toLowerCase();
  if (d.includes('bot was kicked') || d.includes('not a member') || d.includes('group chat was deleted'))
    return new PermanentDeliveryError(
      l(
        'Telegram: bot đã bị xoá khỏi nhóm (hoặc nhóm đã bị xoá). Thêm lại bot rồi kết nối lại kênh (Sửa → Đổi sang nhóm khác).',
        'Telegram: ボットがグループから削除されました（またはグループが削除されました）。ボットを追加し直してチャネルを再接続してください（編集 → 別のグループに変更）。',
      ),
    );
  if (d.includes('chat not found'))
    return new PermanentDeliveryError(
      l(
        'Telegram: không tìm thấy nhóm (nhóm đã bị xoá hoặc bot không còn trong nhóm). Kết nối lại kênh (Sửa → Đổi sang nhóm khác).',
        'Telegram: グループが見つかりません（削除されたか、ボットがもういません）。チャネルを再接続してください（編集 → 別のグループに変更）。',
      ),
    );
  if (d.includes('bot was blocked'))
    return new PermanentDeliveryError(l('Telegram: người nhận đã chặn bot.', 'Telegram: 受信者がボットをブロックしました。'));
  const text = `Telegram: ${description || `HTTP ${status}`}`;
  // Other 4xx (bad token, bad request) do not get better by retrying; 429 and 5xx do.
  return status >= 400 && status < 500 && status !== 429 ? new PermanentDeliveryError(text) : new Error(text);
}

async function call<T>(token: string, method: string, body: object): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: { migrate_to_chat_id?: number };
  };
  if (!json.ok) {
    if (json.parameters?.migrate_to_chat_id) throw new TelegramMigratedError(String(json.parameters.migrate_to_chat_id));
    throw telegramError(json.error_code ?? res.status, json.description);
  }
  return json.result as T;
}

interface TgUpdate {
  message?: TgMessage;
  channel_post?: TgMessage;
}
interface TgMessage {
  text?: string;
  chat: { id: number; type?: string; title?: string; first_name?: string; last_name?: string; username?: string };
}

export const telegramClient: TelegramClient = {
  async getMe(token) {
    const me = await call<{ username: string }>(token, 'getMe', {});
    return { username: me.username };
  },
  async findChatByText(token, needle) {
    const updates = await call<TgUpdate[]>(token, 'getUpdates', { allowed_updates: ['message', 'channel_post'] });
    const want = needle.toLowerCase();
    const seen = new Set<string>();
    // Newest first, so a re-sent code wins.
    for (const u of [...updates].reverse()) {
      const m = u.message ?? u.channel_post;
      if (!m) continue;
      const c = m.chat;
      const title = c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id));
      if (m.text?.toLowerCase().includes(want)) return { chat: { id: String(c.id), title, type: c.type }, seen: [...seen] };
      seen.add(title);
    }
    return { seen: [...seen] };
  },
  async sendMessage(token, chatId, html, buttons) {
    await call(token, 'sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.label, callback_data: b.data }]) } } : {}),
    });
  },
  async setWebhook(token, url, secret) {
    await call(token, 'setWebhook', { url, secret_token: secret, allowed_updates: WEBHOOK_UPDATES, max_connections: 10 });
  },
  async deleteWebhook(token) {
    await call(token, 'deleteWebhook', {});
  },
  async getWebhookInfo(token) {
    const info = await call<{ url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string }>(
      token,
      'getWebhookInfo',
      {},
    );
    return {
      url: info.url,
      pendingUpdates: info.pending_update_count,
      lastError: info.last_error_message,
      lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : undefined,
    };
  },
  async answerCallbackQuery(token, callbackId, text) {
    await call(token, 'answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 190) } : {}) });
  },
  async clearButtons(token, chatId, messageId) {
    await call(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  },
};

export const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => escape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** Telegram HTML (max 4096 chars). */
export function renderTelegram({ title, lines, link }: Message): string {
  const parts = [`<b>${inline(title)}</b>`, ...lines.map((l) => (l.subtle ? `<i>${inline(l.text)}</i>` : inline(l.text)))];
  if (link) parts.push(`<a href="${escape(link.url)}">${escape(link.title)} →</a>`);
  let html = parts.join('\n');
  if (html.length > 4000) html = `${html.slice(0, 3990)}\n…`;
  return html;
}

/** "Bot token" format: <digits>:<35 chars>. */
export function looksLikeBotToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}

/** What the Settings card shows about the webhook (never the secret). */
export function webhookStatus(bot: TelegramBot, info?: TelegramWebhookInfo) {
  return {
    active: !!bot.webhookSecret,
    url: bot.webhookUrl,
    error: bot.webhookError,
    ...(info
      ? {
          pendingUpdates: info.pendingUpdates,
          lastError: info.lastError,
          lastErrorAt: info.lastErrorAt,
          // Someone pointed the bot elsewhere (another deployment, a script calling getUpdates…).
          elsewhere: !!bot.webhookUrl && info.url !== bot.webhookUrl,
        }
      : {}),
  };
}
