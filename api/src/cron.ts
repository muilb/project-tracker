// Hourly Lambda (EventBridge rule): Teams / Telegram alerts for late updates, overdue items,
// tomorrow's events/milestones, and the 08:00 daily digest; plus the per-minute outbox flush and
// the CloudWatch alarms (SNS) sent to the system administrators.
import type { SNSEvent } from 'aws-lambda';
import { notifyAlarm, parseAlarm } from './notify/alarms.js';
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

/** SNS: a CloudWatch alarm changed state (see infra/lib/stack.ts). */
export const alarm = async (event: SNSEvent) => {
  for (const record of event.Records) {
    const parsed = parseAlarm(record.Sns.Message);
    if (!parsed) continue;
    const told = await notifyAlarm(deps, parsed, new Date());
    console.log('alarm', parsed.AlarmName, parsed.NewStateValue, 'admins told:', told);
  }
};
