import type { Health, ItemStatus, ItemType, Priority, ProjectState, Role, Urgency } from '../../api/src/types';
import { l, type Lang } from './i18n';

export const HEALTH_LABEL: Record<Health, string> = { green: l('Xanh', '緑'), yellow: l('Vàng', '黄'), red: l('Đỏ', '赤') };
export const URGENCY_LABEL: Record<Urgency, string> = {
  critical: l('Khẩn cấp', '緊急'),
  attention: l('Cần chú ý', '要注意'),
  normal: l('Bình thường', '通常'),
};
export const ROLE_LABEL: Record<Role, string> = {
  PL: 'PL',
  GL: 'GL',
  PMO: 'PMO',
  SUBMNG: 'Sub MNG',
  MNG: 'MNG',
  OTHER: l('Hỗ trợ / Khác', 'サポート / その他'),
  ADMIN: l('Quản trị hệ thống', 'システム管理者'),
};
export const TYPE_LABEL: Record<ItemType, string> = {
  issue: l('Vấn đề', '課題'),
  event: l('Sự kiện', 'イベント'),
  milestone: l('Mốc', 'マイルストーン'),
};
export const TYPE_ICON: Record<ItemType, string> = { issue: '▲', event: '●', milestone: '◆' };
export const PRIORITY_LABEL: Record<Priority, string> = { high: l('Cao', '高'), medium: l('Trung bình', '中'), low: l('Thấp', '低') };
export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  open: l('Mở', '未対応'),
  in_progress: l('Đang xử lý', '対応中'),
  done: l('Xong', '完了'),
  postponed: l('Hoãn', '保留'),
};
export const STATE_LABEL: Record<ProjectState, string> = {
  active: l('Đang chạy', '進行中'),
  paused: l('Tạm dừng', '一時停止'),
  closed: l('Đã đóng', '終了'),
};
export const LANGS: Lang[] = ['vi', 'ja'];
/** Language names are shown in their own language. */
export const LANG_LABEL: Record<Lang, string> = { vi: 'Tiếng Việt', ja: '日本語' };
