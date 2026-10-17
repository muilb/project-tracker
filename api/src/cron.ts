// Hourly Lambda (EventBridge rule): Teams / Telegram alerts for late updates, overdue items,
// tomorrow's events/milestones, and the 08:00 daily digest; plus the per-minute outbox flush.
import { flushDue, runHourly } from './notify/pipeline.js';
import { createSender } from './notify/sender.js';
import { DynamoStore } from './store/dynamo.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const deps = { store, send: createSender(store), webUrl: process.env.WEB_URL };

export const handler = async () => {
  const result = await runHourly(deps, new Date());
  console.log('hourly alerts', result);
  return result;
};

/** Every minute: messages waiting in the outbox (delayed, grouped or retried). */
export const flush = async () => {
  const result = await flushDue(deps, new Date());
  if (result.sent || result.failed) console.log('outbox', result);
  return result;
};
