// Labels and types shared by the channels page components.
import type { AlertEvent, Channel, ChannelKind, ChannelScope } from '../../../../api/src/types';
import type { TestSample } from '../../../../api/src/notify/samples';
import { l } from '../../i18n';

export type PublicChannel = Omit<Channel, 'webhookUrl'> & { webhookUrlMasked?: string };
export type BotStatus = { configured: boolean; username?: string };

export const EVENT_LABEL: Record<AlertEvent, string> = {
  became_red: l('Dự án chuyển sang Đỏ (ngay lập tức)', 'プロジェクトが「赤」に（即時）'),
  high_issue: l('Vấn đề ưu tiên Cao mới (ngay lập tức)', '優先度「高」の新しい課題（即時）'),
  overdue: l('Mục quá hạn (mỗi ngày một lần)', '期限超過の項目（1 日 1 回）'),
  late_update: l('Trễ cập nhật (nhắc mỗi 24 giờ)', '報告遅れ（24 時間ごとにリマインド）'),
  milestone_soon: l('Mốc / sự kiện vào ngày mai', '明日のマイルストーン / イベント'),
  daily_digest: l('Tóm tắt lúc 8h sáng', '朝 8 時のサマリー'),
};
export const KIND_LABEL: Record<ChannelKind, string> = { telegram: 'Telegram', teams: 'Teams', slack: 'Slack' };

export const SAMPLE_LABEL: Record<TestSample, string> = {
  connect: l('Tin kết nối', '接続メッセージ'),
  became_red: l('Mẫu: dự án chuyển Đỏ', 'サンプル: プロジェクトが「赤」に'),
  high_issue: l('Mẫu: vấn đề ưu tiên Cao', 'サンプル: 優先度「高」の課題'),
  hourly: l('Mẫu: nhắc mỗi giờ', 'サンプル: 毎時リマインド'),
  daily_digest: l('Mẫu: tóm tắt 8h sáng', 'サンプル: 朝 8 時のサマリー'),
};

export function scopeLabel(scope: ChannelScope, name: (id?: string) => string) {
  if (scope.type === 'gl') return l(`Nhóm GL ${name(scope.gl)}`, `GL ${name(scope.gl)} のチーム`);
  if (scope.type === 'projects') return `${l('Dự án', 'プロジェクト')}: ${(scope.projects ?? []).join(', ')}`;
  return l('Tất cả dự án', 'すべてのプロジェクト');
}
