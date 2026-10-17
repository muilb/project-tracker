// Updates from Telegram (POST /telegram/webhook): connect codes, commands, buttons, notes,
// the bot being removed from a chat, and groups that became supergroups.
import { createHash, randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { audit } from '../audit.js';
import { l, withLang } from '../i18n.js';
import type { Message } from '../notify/message.js';
import { renderTelegram } from '../notify/telegram.js';
import { onCallback } from './actions.js';
import { captureCodes } from './codes.js';
import { COMMANDS, helpMessage, runCommand, type Command } from './commands.js';
import { proposeFromNote } from './notes.js';
import { channelsByChat, chatTitle, personByChat, whoIs, type BotDeps, type TgMemberUpdate, type TgMessage, type TgUpdate } from './who.js';

/** Messages and button presses per chat and minute; more are ignored. */
export const RATE_PER_MINUTE = 20;
/** AI notes per chat and hour (each one is a paid Claude call). */
export const AI_PER_HOUR = 10;

/** Chat ids are not shown in logs or used in clear as keys. */
export const chatRef = (chatId: number | string) => createHash('sha256').update(String(chatId)).digest('hex').slice(0, 16);

/** Handles one update; never throws for bad input (the webhook always answers 200). */
export async function handleUpdate(deps: BotDeps, update: TgUpdate): Promise<void> {
  // Telegram re-sends an update it thinks failed: handle each one once.
  if (typeof update.update_id === 'number' && (await deps.store.bumpCounter(`tgupd#${update.update_id}`, 86_400)) > 1) return;
  if (update.callback_query) {
    const chat = update.callback_query.message?.chat;
    if (chat && !(await allowed(deps, chat.id))) return;
    return onCallback(deps, update.callback_query);
  }
  if (update.my_chat_member) return onMembership(deps, update.my_chat_member);
  const msg = update.message ?? update.channel_post;
  if (!msg?.chat) return;
  if (msg.migrate_to_chat_id) return onMigrate(deps, String(msg.chat.id), String(msg.migrate_to_chat_id));
  if (typeof msg.text === 'string' && msg.text.trim()) return onText(deps, msg);
}

async function allowed(deps: BotDeps, chatId: number): Promise<boolean> {
  const minute = Math.floor(deps.now.getTime() / 60_000);
  return (await deps.store.bumpCounter(`tgrate#${chatRef(chatId)}#${minute}`, 120)) <= RATE_PER_MINUTE;
}

const send = (deps: BotDeps, chatId: number, msg: Message) =>
  deps.telegram.sendMessage(deps.bot.token, String(chatId), renderTelegram(msg), msg.actions);

/** `/cmd@bot args` → command and args; null for text that is not a command to this bot. */
export function parseCommand(text: string, botUsername: string): { name: string; args: string } | null {
  const m = /^\/([a-z_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  if (m[2] && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: m[1].toLowerCase(), args: m[3] ?? '' };
}

async function onText(deps: BotDeps, msg: TgMessage) {
  const { chat } = msg;
  const text = msg.text!.trim();
  const isPrivate = chat.type === 'private';
  const command = parseCommand(text, deps.bot.username);
  if (!(await allowed(deps, chat.id))) return;
  // In groups the bot only reads commands addressed to it (and connect codes).
  const hasCode = await captureCodes(deps.store, text, { id: String(chat.id), title: chatTitle(chat), type: chat.type });
  if (!command && !isPrivate && !hasCode) return;

  if (hasCode)
    return withLang((await whoIs(deps.store, chat, msg.from)).lang, () =>
      send(deps, chat.id, {
        title: l('✓ Bot đã nhận mã kết nối', '✓ 接続コードを受信しました'),
        lines: [
          {
            text: isPrivate
              ? l(
                  'Quay lại trang Thông báo của tôi và bấm "Tôi đã bấm Start".',
                  '「自分の通知」画面に戻り「Start を押しました」を押してください。',
                )
              : l('Quay lại trang Kênh thông báo trên web để lưu kênh.', 'Web の「通知チャネル」画面に戻ってチャネルを保存してください。'),
            subtle: true,
          },
        ],
      }),
    );

  const asker = await whoIs(deps.store, chat, msg.from);
  await withLang(asker.lang, async () => {
    if (asker.kind === 'unknown') {
      if (!command && !isPrivate) return;
      await send(deps, chat.id, {
        title: isPrivate
          ? l('Bạn chưa liên kết tài khoản', 'アカウントが連携されていません')
          : l('Nhóm này chưa được kết nối làm kênh thông báo', 'このグループは通知チャネルとして接続されていません'),
        lines: [
          {
            text: isPrivate
              ? l(
                  'Đăng nhập web → Thông báo của tôi → Kết nối Telegram, rồi dùng các lệnh /mine, /status, /late.',
                  'Web にログイン → 自分の通知 → Telegram に接続 の後、/mine・/status・/late が使えます。',
                )
              : l(
                  'Tạo kênh Telegram ở trang Kênh thông báo trên web.',
                  'Web の「通知チャネル」画面で Telegram チャネルを作成してください。',
                ),
          },
        ],
      });
      return;
    }
    try {
      if (command) {
        const name = (command.name === 'start' ? 'help' : command.name) as Command;
        if (!COMMANDS.includes(name)) return void (await send(deps, chat.id, helpMessage(asker)));
        return void (await send(deps, chat.id, await runCommand(deps, asker, name, command.args)));
      }
      if (asker.kind !== 'person') return;
      const hour = Math.floor(deps.now.getTime() / 3_600_000);
      if ((await deps.store.bumpCounter(`tgairate#${chatRef(chat.id)}#${hour}`, 7200)) > AI_PER_HOUR)
        return void (await send(deps, chat.id, {
          title: l(
            'Bạn đã gửi nhiều ghi chú trong giờ này — thử lại sau ít phút.',
            'この 1 時間のメモが多すぎます。しばらくしてからお試しください。',
          ),
          lines: [],
        }));
      await send(deps, chat.id, await proposeFromNote(deps, asker.user, String(chat.id), text));
    } catch (e) {
      if (!(e instanceof HTTPException)) throw e;
      await send(deps, chat.id, { title: e.message, lines: [] });
    }
  });
}

/** The bot was removed from a group, or a person blocked it: stop sending there and say why. */
async function onMembership(deps: BotDeps, m: TgMemberUpdate) {
  const status = m.new_chat_member?.status;
  if (status !== 'left' && status !== 'kicked') return;
  const chatId = String(m.chat.id);
  const at = deps.now.toISOString();
  if (m.chat.type === 'private') {
    const found = await personByChat(deps.store, chatId);
    if (!found) return;
    await deps.store.putNotifyPrefs({
      ...found.prefs,
      telegram: false,
      telegramChatId: undefined,
      telegramBroken: withLang(found.prefs.lang, () =>
        l(
          'Bạn đã chặn hoặc xoá bot trong Telegram, nên tin cá nhân không gửi tới Telegram nữa. Kết nối lại để nhận tiếp.',
          'Telegram でボットをブロックまたは削除したため、個人通知は Telegram に届かなくなりました。受け取るには再接続してください。',
        ),
      ),
      updatedAt: at,
    });
    return;
  }
  for (const ch of await channelsByChat(deps.store, chatId)) {
    const owner = await deps.store.getNotifyPrefs(ch.createdBy).catch(() => undefined);
    await withLang(owner?.lang ?? ch.lang, async () => {
      const reason = l(
        'Telegram: bot đã bị xoá khỏi nhóm. Kênh đã tắt — thêm lại bot rồi kết nối lại kênh (Sửa → Đổi sang nhóm khác).',
        'Telegram: ボットがグループから削除されました。チャネルは無効になりました — ボットを追加し直してチャネルを再接続してください（編集 → 別のグループに変更）。',
      );
      await deps.store.putChannel({ ...ch, enabled: false, lastError: reason, updatedAt: at });
      await audit(deps.store, deps.now, 'system', 'channel_update', ch.id, `${ch.name}: telegram bot removed`);
      await deps.store.addInbox({
        userId: ch.createdBy,
        id: randomUUID().slice(0, 8),
        at,
        event: 'channel_broken',
        title: l(`▲ Kênh "${ch.name}" đã tắt`, `▲ チャネル「${ch.name}」は無効になりました`),
        lines: [{ text: reason }],
        link: deps.notify.webUrl ? { title: l('Mở trang kênh', 'チャネル画面を開く'), url: `${deps.notify.webUrl}/channels` } : undefined,
      });
    });
  }
}

/** A group became a supergroup: Telegram gives the new chat id. */
async function onMigrate(deps: BotDeps, from: string, to: string) {
  for (const ch of await channelsByChat(deps.store, from))
    await deps.store.putChannel({ ...ch, telegramChatId: to, updatedAt: deps.now.toISOString() });
}
