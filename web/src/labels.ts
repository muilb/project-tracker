import type { Health, ItemStatus, ItemType, Priority, ProjectState, Role, Urgency } from '../../api/src/types';

export const HEALTH_LABEL: Record<Health, string> = { green: 'Xanh', yellow: 'Vàng', red: 'Đỏ' };
export const URGENCY_LABEL: Record<Urgency, string> = { critical: 'Khẩn cấp', attention: 'Cần chú ý', normal: 'Bình thường' };
export const ROLE_LABEL: Record<Role, string> = {
  PL: 'PL',
  GL: 'GL',
  PMO: 'PMO',
  SUBMNG: 'Sub MNG',
  MNG: 'MNG',
  OTHER: 'Hỗ trợ / Khác',
};
export const TYPE_LABEL: Record<ItemType, string> = { issue: 'Vấn đề', event: 'Sự kiện', milestone: 'Mốc' };
export const TYPE_ICON: Record<ItemType, string> = { issue: '▲', event: '●', milestone: '◆' };
export const PRIORITY_LABEL: Record<Priority, string> = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' };
export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  open: 'Mở',
  in_progress: 'Đang xử lý',
  done: 'Xong',
  postponed: 'Hoãn',
};
export const STATE_LABEL: Record<ProjectState, string> = { active: 'Đang chạy', paused: 'Tạm dừng', closed: 'Đã đóng' };
