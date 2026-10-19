// Buttons under personal Telegram messages ("Close item", "Snooze 1 day", AI Confirm / Cancel).
// They act as the person linked to the chat, through the same checks and code paths as the web.
import { randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { l, withLang } from '../i18n.js';
import type { NotifyDeps } from '../notify/deps.js';
import type { MessageAction } from '../notify/message.js';
import { renderTelegram } from '../notify/telegram.js';
import { loadItem, loadProject, patchItem } from '../projectOps.js';
import { checkBody, patchItemSchema } from '../schemas.js';
import { snoozeKey } from '../notify/routePersonal.js';
import { applyPending, pendingKey, type PendingNote } from './notes.js';
import { whoIs, type BotDeps, type TgCallback } from './who.js';

/** Snooze buttons stay usable while the reminder is recent. */
const SNOOZE_STATE_SECONDS = 3 * 86_400;
const snoozeStateKey = (id: string) => `tgsnz#${id}`;

interface SnoozeState {
  userId: string;
  subjects: string[];
}

export const closeAction = (projectId: string, itemId: string): MessageAction => ({
  label: l(`✓ Đóng mục ${itemId}`, `✓ ${itemId} を完了にする`),
  data: `c:${projectId}:${itemId}`,
});

/** Buttons of an hourly reminder: close the items due, snooze everything in it for a day. */
export async function reminderActions(
  deps: NotifyDeps,
  userId: string,
  items: { project: { id: string }; itemId?: string }[],
  subjects: string[],
): Promise<MessageAction[]> {
  const id = randomBytes(6).toString('hex');
  const state: SnoozeState = { userId, subjects: [...new Set(subjects)] };
  await deps.store.putTemp(snoozeStateKey(id), state, SNOOZE_STATE_SECONDS);
  return [
    ...items.map((x) => closeAction(x.project.id, x.itemId!)),
    { label: l('⏰ Hoãn nhắc 1 ngày', '⏰ 1 日後に再通知'), data: `z:${id}` },
  ];
}

/** A button was pressed: act, then always answer the callback (Telegram shows a spinner until then). */
export async function onCallback(deps: BotDeps, cb: TgCallback): Promise<void> {
  const chat = cb.message?.chat;
  const answer = (text: string) => deps.telegram.answerCallbackQuery(deps.bot.token, cb.id, text).catch(() => {});
  if (!chat) return answer('');
  const asker = await whoIs(deps.store, chat, cb.from);
  if (asker.kind !== 'person')
    return withLang(asker.lang, () =>
      answer(l('Chat này chưa liên kết với tài khoản nào.', 'このチャットはアカウントと連携していません。')),
    );
  const chatId = String(chat.id);
  const reply = (html: string) => deps.telegram.sendMessage(deps.bot.token, chatId, html);
  const clear = () =>
    cb.message ? deps.telegram.clearButtons(deps.bot.token, chatId, cb.message.message_id).catch(() => {}) : Promise.resolve();
  const [kind, ...rest] = (cb.data ?? '').split(':');

  await withLang(asker.lang, async () => {
    try {
      if (kind === 'c') {
        const [projectId, itemId] = rest;
        const ctx = { store: deps.store, notify: deps.notify, now: deps.now, user: asker.user };
        const project = await loadProject(deps.store, projectId ?? '', asker.user, deps.now);
        const item = await loadItem(deps.store, project, itemId ?? '');
        // Pressed twice, or closed on the web meanwhile: nothing to save again.
        if (item.status === 'done' || item.status === 'postponed')
          return answer(l(`${item.id} đã đóng trước đó`, `${item.id} は既に完了しています`));
        await patchItem(ctx, project.id, item.id, checkBody(patchItemSchema, { status: 'done' }));
        await answer(l(`✓ Đã đóng ${item.id}`, `✓ ${item.id} を完了にしました`));
        await reply(
          renderTelegram({
            title: l(`✓ Đã đóng ${item.id} – ${project.id}`, `✓ ${item.id} を完了にしました – ${project.id}`),
            lines: [{ text: `"${item.title}"` }],
          }),
        );
        return;
      }
      if (kind === 'z') {
        const state = await deps.store.getTemp<SnoozeState>(snoozeStateKey(rest[0] ?? ''));
        if (!state || state.userId !== asker.user.id) return answer(l('Nút này đã hết hạn', 'このボタンは期限切れです'));
        await Promise.all(state.subjects.map((s) => deps.store.markSent(snoozeKey(asker.user.id, s), 1)));
        return answer(l('⏰ Đã hoãn — nhắc lại sau 1 ngày', '⏰ 1 日後に再通知します'));
      }
      if (kind === 'a' || kind === 'x') {
        const key = pendingKey(rest[0] ?? '');
        const peek = await deps.store.getTemp<PendingNote>(key);
        // Only the person and chat that asked; takeTemp lets a double press write once.
        const pending =
          peek && peek.userId === asker.user.id && peek.chatId === chatId ? await deps.store.takeTemp<PendingNote>(key) : undefined;
        await clear();
        if (!pending) return answer(l('Đề xuất đã hết hạn hoặc đã xử lý', 'この提案は期限切れか処理済みです'));
        if (kind === 'x') {
          await answer(l('Đã huỷ', '取り消しました'));
          await reply(renderTelegram({ title: l('✗ Đã huỷ — không ghi gì', '✗ 取り消しました — 何も保存していません'), lines: [] }));
          return;
        }
        await answer(l('Đang ghi…', '保存中…'));
        await reply(renderTelegram(await applyPending(deps, asker.user, pending)));
        return;
      }
      await answer('');
    } catch (e) {
      if (e instanceof HTTPException) return answer(e.message);
      await answer(l('Lỗi hệ thống', 'システムエラー'));
      throw e;
    }
  });
}
