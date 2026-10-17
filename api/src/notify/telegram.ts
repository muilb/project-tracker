// Telegram delivery through one system bot (created with @BotFather, token set by PMO in Settings).
import { l } from '../i18n.js';
import { PermanentDeliveryError } from './errors.js';
import type { Message } from './message.js';

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
   * Pending updates (Telegram keeps them ~24h); used to find the chat that sent a connect code.
   * `seen` lists the chats the bot received anything from, to explain a miss.
   */
  findChatByText(token: string, needle: string): Promise<{ chat?: TelegramChat; seen: string[] }>;
  sendMessage(token: string, chatId: string, html: string): Promise<void>;
}

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
  async sendMessage(token, chatId, html) {
    await call(token, 'sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  },
};

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
