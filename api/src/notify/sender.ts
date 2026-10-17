import { l } from '../i18n.js';
import type { Store } from '../store/store.js';
import type { Channel, ChannelKind } from '../types.js';
import type { Message } from './message.js';
import { adaptiveCard, postTeams } from './teams.js';
import { renderTelegram, telegramClient, type TelegramClient } from './telegram.js';

/** Delivers one message to one channel (tests pass a fake). */
export type Sender = (channel: Channel, message: Message) => Promise<void>;

type Driver = (ch: Channel, msg: Message) => Promise<void>;

export function createSender(store: Store, telegram: TelegramClient = telegramClient): Sender {
  const drivers: Record<ChannelKind, Driver> = {
    // track C: Teams / Telegram error handling.
    teams: (ch, msg) => postTeams(ch.webhookUrl!, adaptiveCard(msg)),
    telegram: async (ch, msg) => {
      const bot = await store.getTelegramBot();
      if (!bot) throw new Error(l('Chưa cài bot Telegram (Cài đặt → Telegram)', 'Telegram ボットが未設定です（設定 → Telegram）'));
      await telegram.sendMessage(bot.token, ch.telegramChatId!, renderTelegram(msg));
    },
    // track E: Slack Incoming Webhook with Block Kit.
    slack: async () => {
      throw new Error(l('Chưa hỗ trợ kênh Slack', 'Slack チャネルはまだ利用できません'));
    },
  };
  return (ch, msg) => drivers[ch.kind](ch, msg);
}
