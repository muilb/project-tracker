import type { Store } from '../store/store.js';
import type { Channel } from '../types.js';
import type { Message } from './message.js';
import { adaptiveCard, postTeams } from './teams.js';
import { renderTelegram, telegramClient, type TelegramClient } from './telegram.js';

/** Delivers one message to one channel (tests pass a fake). */
export type Sender = (channel: Channel, message: Message) => Promise<void>;

export function createSender(store: Store, telegram: TelegramClient = telegramClient): Sender {
  return async (ch, msg) => {
    if (ch.kind === 'telegram') {
      const bot = await store.getTelegramBot();
      if (!bot) throw new Error('Chưa cài bot Telegram (Cài đặt → Telegram)');
      await telegram.sendMessage(bot.token, ch.telegramChatId!, renderTelegram(msg));
    } else {
      await postTeams(ch.webhookUrl!, adaptiveCard(msg));
    }
  };
}
