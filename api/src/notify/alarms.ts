// CloudWatch alarms (SNS → AlarmFn in src/cron.ts): system administrators get them in their inbox,
// and on their personal Telegram / Web Push when switched on. Quiet hours do not apply.
// If the API itself is down (DynamoDB, a broken release), the SNS email subscription still reaches
// ALARM_EMAILS (see infra/lib/stack.ts).
import { l, withLang } from '../i18n.js';
import { vnDateTime } from '../time.js';
import type { NotifyDeps } from './deps.js';
import { send, type Outgoing } from './deliver.js';
import type { Message } from './message.js';

/** The fields of a CloudWatch alarm notification that the message uses. */
export interface CloudWatchAlarm {
  AlarmName: string;
  /** One of the keys of `ALARMS` (set as the alarm description in the CDK stack). */
  AlarmDescription?: string | null;
  NewStateValue: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
  NewStateReason?: string;
  StateChangeTime?: string;
}

/** What each alarm of the stack watches, in the reader's language. */
const ALARMS: Record<string, () => string> = {
  'api-5xx': () => l('API trả lỗi máy chủ (5xx)', 'API がサーバーエラー（5xx）を返しています'),
  'api-errors': () => l('Lambda API bị lỗi hoặc quá thời gian', 'API の Lambda がエラーまたはタイムアウトしています'),
  'api-throttles': () => l('Lambda API bị giới hạn (quá nhiều request cùng lúc)', 'API の Lambda がスロットリングされています'),
  'cron-errors': () => l('Lượt quét thông báo hàng giờ bị lỗi', '毎時の通知チェックが失敗しました'),
  'flush-errors': () => l('Gửi thông báo trong hàng đợi (mỗi phút) bị lỗi', 'キュー内の通知送信（毎分）が失敗しています'),
  'table-throttles': () => l('DynamoDB bị giới hạn đọc / ghi', 'DynamoDB の読み書きがスロットリングされています'),
  'table-errors': () => l('DynamoDB báo lỗi hệ thống', 'DynamoDB でシステムエラーが発生しています'),
};

/** Reads the SNS message body; undefined when it is not a CloudWatch alarm state change. */
export function parseAlarm(body: string): CloudWatchAlarm | undefined {
  try {
    const a = JSON.parse(body) as CloudWatchAlarm;
    return typeof a.AlarmName === 'string' && typeof a.NewStateValue === 'string' ? a : undefined;
  } catch {
    return undefined;
  }
}

export function alarmMessage(alarm: CloudWatchAlarm, webUrl?: string): Message {
  const what = ALARMS[alarm.AlarmDescription ?? '']?.() ?? alarm.AlarmName;
  const ok = alarm.NewStateValue === 'OK';
  const at = alarm.StateChangeTime ? Date.parse(alarm.StateChangeTime) : NaN;
  return {
    title: ok ? `✓ ${l('Đã hết', '復旧')}: ${what}` : `▲ ${l('Cảnh báo hệ thống', 'システムアラート')}: ${what}`,
    lines: [
      ...(Number.isNaN(at) ? [] : [{ text: `${l('Lúc', '時刻')}: ${vnDateTime(new Date(at).toISOString())}` }]),
      ...(alarm.NewStateReason ? [{ text: alarm.NewStateReason.slice(0, 300), subtle: true }] : []),
      ...(ok
        ? []
        : [
            {
              text: l(
                'Xem log trong CloudWatch (nhóm log của Lambda tương ứng) để tìm nguyên nhân.',
                'CloudWatch で該当 Lambda のロググループを確認して原因を調べてください。',
              ),
              subtle: true,
            },
          ]),
    ],
    tone: ok ? 'good' : 'attention',
    link: webUrl ? { title: l('Mở ứng dụng', 'アプリを開く'), url: webUrl } : undefined,
  };
}

/** Sends one alarm state change to every system administrator; returns how many were told. */
export async function notifyAlarm(deps: NotifyDeps, alarm: CloudWatchAlarm, now: Date): Promise<number> {
  if (alarm.NewStateValue === 'INSUFFICIENT_DATA') return 0;
  const admins = (await deps.store.listUsers()).filter((u) => u.role === 'ADMIN');
  if (!admins.length) console.warn(`alarm ${alarm.AlarmName}: no ADMIN user to tell`);
  for (const admin of admins) {
    const prefs = await deps.store.getNotifyPrefs(admin.id);
    const message = withLang(prefs?.lang, () => alarmMessage(alarm, deps.webUrl));
    const out: Outgoing[] = [{ target: { userId: admin.id, via: 'inbox' }, event: 'system_alarm', message }];
    if (prefs?.telegram && prefs.telegramChatId) out.push({ ...out[0], target: { userId: admin.id, via: 'telegram' } });
    if (prefs?.push) out.push({ ...out[0], target: { userId: admin.id, via: 'push' } });
    for (const o of out) await send(deps, o, now);
  }
  return admins.length;
}
