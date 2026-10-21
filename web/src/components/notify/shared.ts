// Personal notifications: response types of /me/notify and /me/inbox, event labels, saving prefs.
import type { InboxEntry, NotifyPrefs, PersonalEvent } from '../../../../api/src/types';
import { api, ApiError } from '../../api';
import { l } from '../../i18n';

export type { InboxEntry, PersonalEvent };

/** GET /me/notify: the chat id never leaves the API, only whether one is linked. */
export type MyPrefs = Omit<NotifyPrefs, 'telegramChatId'> & { telegramLinked: boolean };
export interface MyNotify {
  prefs: MyPrefs;
  /** Username of the system bot; undefined = no bot configured. */
  telegramBot?: string;
}
export interface InboxPage {
  entries: InboxEntry[];
  unread: number;
  nextBefore?: string;
}
/** POST /me/notify/telegram/link (track A). */
export interface TelegramLink {
  code: string;
  url: string;
}

/** Event checkboxes in the order of the plan's table, each with a short "when is it sent" line. */
export const PERSONAL_EVENT_INFO: { event: PersonalEvent; label: string; when: string }[] = [
  {
    event: 'update_due_soon',
    label: l('Sắp đến hạn cập nhật', '報告期限が近い'),
    when: l(
      'Dự án bạn là PL (không có PL thì GL) còn 4 giờ nữa đến hạn cập nhật.',
      '自分が PL（PL 不在なら GL）のプロジェクトの報告期限まで 4 時間以内。',
    ),
  },
  {
    event: 'late_update_mine',
    label: l('Dự án của tôi trễ cập nhật', '自分のプロジェクトの報告遅れ'),
    when: l('Dự án bạn là PL đã trễ hạn cập nhật; nhắc lại mỗi 24 giờ.', '自分が PL のプロジェクトが報告期限を過ぎたとき。24 時間ごとに再通知。'),
  },
  {
    event: 'escalation',
    label: l('Trễ kéo dài (báo cấp trên)', '長期の報告遅れ（エスカレーション）'),
    when: l(
      'Dự án trễ từ 2 lần chu kỳ cập nhật (báo GL), từ 4 lần (báo PMO của dự án).',
      '報告周期の 2 倍以上遅れたとき GL に、4 倍以上でプロジェクトの PMO に通知。',
    ),
  },
  {
    event: 'assigned_to_me',
    label: l('Tôi được giao mục', '項目の担当に設定された'),
    when: l('Ai đó đặt bạn làm người phụ trách một vấn đề / sự kiện / mốc.', '誰かがあなたを課題・イベント・マイルストーンの担当者に設定したとき。'),
  },
  {
    event: 'my_item_due',
    label: l('Mục của tôi đến hạn', '担当項目の期限'),
    when: l('Mục bạn phụ trách đến hạn ngày mai hoặc đã quá hạn (một lần mỗi ngày).', '担当項目の期限が明日、または期限超過（1 日 1 回）。'),
  },
  {
    event: 'need_help',
    label: l('Cần hỗ trợ', '支援依頼'),
    when: l('Cập nhật của dự án bạn là GL / PMO có ghi "cần hỗ trợ".', '自分が GL / PMO のプロジェクトの報告に「支援依頼」があるとき。'),
  },
  {
    event: 'health_changed',
    label: l('Đổi trạng thái', '状態の変化'),
    when: l(
      'Trạng thái tổng hợp của dự án bạn là GL / PL hoặc đang theo dõi đổi màu (cả tốt lên lẫn xấu đi).',
      '自分が GL / PL、またはウォッチ中のプロジェクトの総合状態が変わったとき（改善・悪化とも）。',
    ),
  },
  {
    event: 'watched_red',
    label: l('Dự án theo dõi chuyển Đỏ', 'ウォッチ中のプロジェクトが赤に'),
    when: l('Dự án bạn ⭐ theo dõi chuyển sang Đỏ.', '⭐ ウォッチ中のプロジェクトが「赤」になったとき。'),
  },
  {
    event: 'watched_high_issue',
    label: l('Vấn đề Cao ở dự án theo dõi', 'ウォッチ中のプロジェクトの「高」課題'),
    when: l('Dự án bạn ⭐ theo dõi có vấn đề ưu tiên Cao mới.', '⭐ ウォッチ中のプロジェクトに優先度「高」の課題が追加されたとき。'),
  },
  {
    event: 'mentioned',
    label: l('Có người gọi tên tôi (@)', 'メンションされた（@）'),
    when: l('Ai đó viết @tên bạn trong một bình luận (ở dự án bạn xem được).', '閲覧できるプロジェクトのコメントで、誰かがあなたを @ で呼んだとき。'),
  },
  {
    event: 'comment_reply',
    label: l('Bình luận mới cho tôi', '自分宛ての新しいコメント'),
    when: l(
      'Có bình luận mới dưới cập nhật bạn viết, mục bạn tạo / phụ trách, hoặc trong chuỗi bình luận bạn đã tham gia.',
      '自分の報告、自分が作成 / 担当する項目、または自分がコメントしたスレッドに新しいコメントが付いたとき。',
    ),
  },
];

/** PUT /me/notify replaces the whole settings, so every change starts from the current ones. */
export async function savePrefs(current: MyPrefs, change: Partial<MyPrefs>): Promise<MyPrefs> {
  const next = { ...current, ...change };
  const r = await api.put<{ prefs: MyPrefs }>('/me/notify', {
    events: next.events,
    telegram: next.telegram,
    watch: next.watch,
    schedule: next.schedule,
    pausedUntil: next.pausedUntil ?? null,
    lang: next.lang,
    push: next.push ?? false, // track H
  });
  window.dispatchEvent(new Event('notify-prefs-changed'));
  return r.prefs;
}

/** 501 = the endpoint ships with track A; shown as "not available yet" instead of an error. */
export const notAvailable = (e: unknown) => e instanceof ApiError && e.status === 501;

export function markRead(body: { ids: string[] } | { all: true }) {
  return api.post<{ unread: number }>('/me/inbox/read', body).then((r) => {
    window.dispatchEvent(new Event('inbox-changed'));
    return r;
  });
}
