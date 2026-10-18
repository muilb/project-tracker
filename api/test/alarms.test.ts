// CloudWatch alarms → system administrators (inbox, personal Telegram).
import { beforeEach, describe, expect, it } from 'vitest';
import { alarm } from '../src/cron.js';
import { alarmMessage, notifyAlarm, parseAlarm, type CloudWatchAlarm } from '../src/notify/alarms.js';
import type { Message } from '../src/notify/message.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
let sent: { channel: string; msg: Message }[];
const send = async (ch: Channel, msg: Message) => void sent.push({ channel: ch.id, msg });
const deps = () => ({ store, send, webUrl: 'https://web.example' });

const state = (over: Partial<CloudWatchAlarm> = {}): CloudWatchAlarm => ({
  AlarmName: 'ProjectTracker-prod-Alarmflusherrors-ABC',
  AlarmDescription: 'flush-errors',
  NewStateValue: 'ALARM',
  NewStateReason: 'Threshold Crossed: 1 datapoint [4.0] was greater than or equal to the threshold (3.0).',
  StateChangeTime: '2026-10-09T02:45:00.000+0000',
  ...over,
});

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
});

describe('system alarms', () => {
  it('reads CloudWatch notifications and ignores anything else', () => {
    expect(parseAlarm(JSON.stringify(state()))).toMatchObject({ AlarmDescription: 'flush-errors', NewStateValue: 'ALARM' });
    expect(parseAlarm('not json')).toBeUndefined();
    expect(parseAlarm(JSON.stringify({ hello: 1 }))).toBeUndefined();
  });

  it('tells every ADMIN in their inbox, and on Telegram when switched on, in their language', async () => {
    await store.putNotifyPrefs({
      userId: 'admin@example.com',
      events: [],
      telegram: true,
      telegramChatId: '99',
      watch: [],
      lang: 'ja',
      updatedAt: now.toISOString(),
    });
    expect(await notifyAlarm(deps(), state(), now)).toBe(1);
    const [entry] = await store.listInbox('admin@example.com', 10);
    expect(entry).toMatchObject({ event: 'system_alarm', title: expect.stringContaining('キュー内の通知送信') });
    expect(entry.lines[0].text).toContain('2026-10-09 09:45'); // Vietnam time
    expect(sent).toMatchObject([{ channel: 'U:admin@example.com', msg: { title: entry.title } }]);
    // Nobody else hears about it.
    expect(await store.listInbox('lan@example.com', 10)).toEqual([]);
  });

  it('says when it is over, and skips "insufficient data"', async () => {
    await notifyAlarm(deps(), state({ NewStateValue: 'OK' }), now);
    expect((await store.listInbox('admin@example.com', 10))[0].title).toMatch(/^✓ Đã hết: Gửi thông báo/);
    expect(await notifyAlarm(deps(), state({ NewStateValue: 'INSUFFICIENT_DATA' }), now)).toBe(0);
    expect(await store.listInbox('admin@example.com', 10)).toHaveLength(1);
  });

  it('falls back to the alarm name for alarms it does not know', () => {
    const { title } = alarmMessage(state({ AlarmDescription: 'new-thing' }));
    expect(title).toBe('▲ Cảnh báo hệ thống: ProjectTracker-prod-Alarmflusherrors-ABC');
  });

  it('the Lambda handler skips records that are not alarms', async () => {
    // The handler uses the DynamoDB store; a record it cannot parse never reaches it.
    await expect(alarm({ Records: [{ Sns: { Message: 'subscription confirmed' } }] } as never)).resolves.toBeUndefined();
  });
});
