import { l } from '../i18n.js';
import type { Store } from '../store/store.js';
import type { Channel, ChannelKind } from '../types.js';
import type { Message } from './message.js';
import { compact, effectiveDetail } from './render.js';
import { postSlack, slackPayload } from './slack.js';
import { adaptiveCard, postTeams } from './teams.js';
import { renderTelegram, telegramClient, TelegramMigratedError, type TelegramClient } from './telegram.js';

/** Delivers one message to one channel (tests pass a fake). */
export type Sender = (channel: Channel, message: Message) => Promise<void>;

type Driver = (ch: Channel, msg: Message) => Promise<void>;

export function createSender(store: Store, telegram: TelegramClient = telegramClient): Sender {
  const drivers: Record<ChannelKind, Driver> = {
    // track C: Teams / Telegram error handling.
    // Permanent failures throw PermanentDeliveryError (teams.ts / telegram.ts) so they are not retried.
    teams: (ch, msg) => postTeams(ch.webhookUrl!, adaptiveCard(msg)),
    telegram: async (ch, msg) => {
      const bot = await store.getTelegramBot();
      if (!bot) throw new Error(l('Chưa cài bot Telegram (Cài đặt → Telegram)', 'Telegram ボットが未設定です（設定 → Telegram）'));
      const html = renderTelegram(msg);
      // track G: buttons only in personal chats, where the webhook knows who pressed them.
      const buttons = ch.id.startsWith('U:') && bot.webhookSecret ? msg.actions : undefined;
      try {
        await telegram.sendMessage(bot.token, ch.telegramChatId!, html, buttons);
      } catch (e) {
        if (!(e instanceof TelegramMigratedError)) throw e;
        // The group became a supergroup: send to the new chat id and keep it on the channel
        // (the caller saves the channel object after delivery).
        await telegram.sendMessage(bot.token, e.newChatId, html, buttons);
        ch.telegramChatId = e.newChatId;
      }
    },
    // track E: Slack Incoming Webhook with Block Kit.
    slack: (ch, msg) => postSlack(ch.webhookUrl!, slackPayload(msg)),
  };
  return async (ch, msg) => {
    // Group channels may be compact (own setting or PMO's maximum); personal chats ("U:<user>", see deliver.ts) never are.
    const group = !ch.id.startsWith('U:');
    const detail = group ? effectiveDetail(ch, await store.getSettings()) : 'full';
    return drivers[ch.kind](ch, detail === 'compact' ? compact(msg) : msg);
  };
}
