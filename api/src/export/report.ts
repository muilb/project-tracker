// "Export to Excel": the projects, items (open and recently closed), recent updates and the colours
// of the last weeks (trend.ts) the caller may see, as four sheets.
// Headers and labels are in the request language; user-entered text is never translated.
import { l } from '../i18n.js';
import { buildProjectView, compareProjects, toItemView } from '../rules.js';
import { snapshotSince, SNAPSHOT_UPDATE_DAYS, type Snapshot } from '../store/store.js';
import { vnDateTime } from '../time.js';
import { TREND_WEEKS } from '../trend.js';
import type { Health, HealthDay, ItemStatus, ItemType, Priority, ProjectState, Urgency, User } from '../types.js';
import { visibleSnapshot } from '../views.js';
import type { Sheet } from './xlsx.js';

const HEALTH = (h?: Health) => h && { green: l('Xanh', '緑'), yellow: l('Vàng', '黄'), red: l('Đỏ', '赤') }[h];
const URGENCY = (u: Urgency) => ({ critical: l('Khẩn cấp', '緊急'), attention: l('Cần chú ý', '要注意'), normal: l('Bình thường', '通常') })[u];
const STATE = (s: ProjectState) => ({ active: l('Đang chạy', '進行中'), paused: l('Tạm dừng', '一時停止'), closed: l('Đã đóng', '終了') })[s];
const TYPE = (t: ItemType) => ({ issue: l('Vấn đề', '課題'), event: l('Sự kiện', 'イベント'), milestone: l('Mốc', 'マイルストーン') })[t];
const PRIORITY = (p: Priority) => ({ high: l('Cao', '高'), medium: l('Trung bình', '中'), low: l('Thấp', '低') })[p];
const STATUS = (s: ItemStatus) =>
  ({ open: l('Mở', '未対応'), in_progress: l('Đang xử lý', '対応中'), done: l('Xong', '完了'), postponed: l('Hoãn', '保留') })[s];
const time = (iso?: string) => iso && vnDateTime(iso);

/**
 * `snap` must be taken with `now` (recent updates only); deleted rows are already left out.
 * `days`: the recorded colours of the last TREND_WEEKS weeks (`dashboardTrendRange`).
 */
export function exportSheets(snapshot: Snapshot, me: User, now: Date, days: HealthDay[]): Sheet[] {
  const snap = visibleSnapshot(me, snapshot);
  const names = new Map(snap.users.map((u) => [u.id, u.name]));
  const person = (id?: string) => id && (names.get(id) ?? id);
  const projectName = new Map(snap.projects.map((p) => [p.id, p.name]));
  const views = snap.projects.map((p) => buildProjectView(p, snap.updates, snap.items, snap.settings, now)).sort(compareProjects);
  const since = snapshotSince(now);

  const projects: Sheet = {
    name: l('Dự án', 'プロジェクト'),
    columns: [
      l('Mã', 'コード'),
      l('Tên dự án', 'プロジェクト名'),
      l('Khách hàng', '顧客'),
      l('Tình trạng', '状態'),
      l('Màu', '色'),
      l('Mức khẩn', '緊急度'),
      'GL',
      'PL',
      'PMO',
      l('Hỗ trợ', 'サポート'),
      l('Bắt đầu', '開始'),
      l('Kết thúc', '終了'),
      l('Cập nhật gần nhất (giờ VN)', '最終報告（ベトナム時間）'),
      l('Người cập nhật', '報告者'),
      l('Tóm tắt mới nhất', '最新の要約'),
      l('Cần hỗ trợ', '支援が必要'),
      l('Hạn cập nhật (giờ VN)', '報告期限（ベトナム時間）'),
      l('Trễ (giờ)', '遅れ（時間）'),
      l('Vấn đề mở', '未解決の課題'),
      l('Vấn đề ưu tiên cao', '優先度「高」の課題'),
      l('Mục quá hạn', '期限超過'),
      l('Quá ngày kết thúc (ngày)', '終了日超過（日）'),
      l('Sự kiện / mốc tiếp theo', '次のイベント / マイルストーン'),
      l('Ngày', '日付'),
    ],
    rows: views.map((v) => [
      v.id,
      v.name,
      v.customer,
      STATE(v.state),
      HEALTH(v.health),
      URGENCY(v.urgency),
      person(v.gl),
      person(v.pl),
      person(v.pmo),
      v.supporters.map(person).join(', '),
      v.startDate,
      v.endDate,
      time(v.lastOwnerUpdate?.at),
      person(v.lastOwnerUpdate?.author),
      v.latestUpdate?.summary,
      v.lastOwnerUpdate?.needHelp,
      v.state === 'active' ? time(v.dueAt) : undefined,
      v.state === 'active' ? v.lateHours : undefined,
      v.openIssues,
      v.highIssues,
      v.overdueItems,
      v.daysPastEnd || undefined,
      v.nextItem?.title,
      v.nextItem?.date,
    ]),
  };

  const items: Sheet = {
    name: l('Vấn đề, sự kiện, mốc', '課題・イベント・マイルストーン'),
    columns: [
      l('Mã dự án', 'プロジェクトコード'),
      l('Tên dự án', 'プロジェクト名'),
      l('Mã', 'コード'),
      l('Loại', '種類'),
      l('Tiêu đề', 'タイトル'),
      l('Ưu tiên', '優先度'),
      l('Ngày (hạn)', '日付（期限）'),
      l('Phụ trách', '担当'),
      l('Trạng thái', 'ステータス'),
      l('Quá hạn', '期限超過'),
      l('Ghi chú', 'メモ'),
      l('Tạo lúc (giờ VN)', '作成（ベトナム時間）'),
      l('Sửa lúc (giờ VN)', '更新（ベトナム時間）'),
    ],
    rows: snap.items
      .map((i) => toItemView(i, now, snap.settings))
      .sort((a, b) => a.projectId.localeCompare(b.projectId) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((i) => [
        i.projectId,
        projectName.get(i.projectId),
        i.id,
        TYPE(i.type),
        i.title,
        PRIORITY(i.priority),
        i.date,
        person(i.owner),
        STATUS(i.status),
        i.overdue ? l('Có', 'はい') : undefined,
        i.note,
        time(i.createdAt),
        time(i.updatedAt),
      ]),
  };

  const updates: Sheet = {
    name: l(`Cập nhật ${SNAPSHOT_UPDATE_DAYS} ngày`, `報告（${SNAPSHOT_UPDATE_DAYS}日間）`),
    columns: [
      l('Mã dự án', 'プロジェクトコード'),
      l('Tên dự án', 'プロジェクト名'),
      l('Lúc (giờ VN)', '日時（ベトナム時間）'),
      l('Người viết', '報告者'),
      l('Vai trò', 'ロール'),
      l('Màu', '色'),
      l('Tóm tắt', '要約'),
      l('Cần hỗ trợ', '支援が必要'),
    ],
    // The snapshot also carries older "pinned" updates; the sheet keeps to the period it names.
    rows: snap.updates
      .filter((u) => u.at >= since)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .map((u) => [
        u.projectId,
        projectName.get(u.projectId),
        time(u.at),
        person(u.author),
        u.authorRole,
        HEALTH(u.health),
        u.summary,
        u.needHelp,
      ]),
  };

  const colours: Sheet = {
    name: l(`Lịch sử màu ${TREND_WEEKS} tuần`, `色の履歴（${TREND_WEEKS}週間）`),
    columns: [
      l('Ngày', '日付'),
      l('Mã dự án', 'プロジェクトコード'),
      l('Tên dự án', 'プロジェクト名'),
      l('Tình trạng', '状態'),
      l('Màu', '色'),
      l('PL/GL khai', 'PL/GL申告'),
      l('PMO đánh giá', 'PMO評価'),
      l('Mục quá hạn', '期限超過'),
      l('Trễ (giờ)', '遅れ（時間）'),
    ],
    // Newest day first; only the projects the caller may see.
    rows: [...days]
      .sort((a, b) => b.date.localeCompare(a.date))
      .flatMap((d) =>
        Object.entries(d.projects)
          .filter(([id]) => projectName.has(id))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, m]) => [
            d.date,
            id,
            projectName.get(id),
            STATE(m.state),
            HEALTH(m.health),
            HEALTH(m.declaredHealth),
            HEALTH(m.pmoHealth),
            m.overdueItems,
            m.state === 'active' ? m.lateHours : undefined,
          ]),
      ),
  };

  return [projects, items, updates, colours];
}
