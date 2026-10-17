import type { TelegramClient } from '../../src/notify/telegram.js';

/** The two-way methods (track G) for fakes of tests that only use the one-way bot. */
export const webhookStubs: Pick<
  TelegramClient,
  'setWebhook' | 'deleteWebhook' | 'getWebhookInfo' | 'answerCallbackQuery' | 'clearButtons'
> = {
  setWebhook: async () => {},
  deleteWebhook: async () => {},
  getWebhookInfo: async () => ({ url: '', pendingUpdates: 0 }),
  answerCallbackQuery: async () => {},
  clearButtons: async () => {},
};
