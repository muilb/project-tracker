// Sample data copied from the original Excel tracker (TheoDoiDuAn.xlsx) — dev/test only.
// The Excel was a snapshot at 2026-10-09 09:45 (Vietnam time); `loadSample` shifts every
// date by whole days so the sample always looks "current".
import type { Store } from '../store/store.js';
import { addDays, vnDate, vnToIso } from '../time.js';
import { recordHealth } from '../trend.js';
import type { Health, HealthMark, ItemStatus, ItemType, Priority, Project, Role } from '../types.js';

export const SAMPLE_NOW_VN = '2026-10-09 09:45';

const DOMAIN = 'example.com';
const u = (name: string) => `${name}@${DOMAIN}`;

const USERS: [string, string, Role][] = [
  ['an', 'An', 'PL'],
  ['binh', 'Bình', 'PL'],
  ['cuong', 'Cường', 'PL'],
  ['dung', 'Dũng', 'PL'],
  ['hoa', 'Hoa', 'PL'],
  ['khanh', 'Khánh', 'PL'],
  ['long', 'Long', 'PL'],
  ['phuc', 'Phúc', 'OTHER'],
  ['quang', 'Quang', 'OTHER'],
  ['hung', 'Hùng', 'GL'],
  ['son', 'Sơn', 'GL'],
  ['tuan', 'Tuấn', 'GL'],
  ['lan', 'Lan', 'PMO'],
  ['mai', 'Mai', 'PMO'],
  ['minh', 'Minh', 'SUBMNG'],
  ['mng', 'MNG', 'MNG'],
  ['admin', 'Quản trị', 'ADMIN'],
];

// id, name, customer, gl, pl, supporters, pmo, start, end, custom frequency (hours)
const PROJECTS: [string, string, string, string, string, string[], string, string, string, number | null][] = [
  ['P01', 'Hệ thống quản lý kho', 'KH A', 'hung', 'an', ['phuc'], 'lan', '2026-07-01', '2026-12-25', null],
  ['P02', 'App đặt lịch', 'KH B', 'hung', 'binh', [], 'lan', '2026-08-15', '2026-11-30', null],
  ['P03', 'Nâng cấp ERP', 'KH C', 'son', 'cuong', ['quang'], 'mai', '2026-05-10', '2026-11-15', 8],
  ['P04', 'Portal nội bộ', 'Công ty mẹ', 'son', 'dung', ['phuc'], 'mai', '2026-08-01', '2027-01-31', null],
  ['P05', 'Bảo trì hệ thống bán hàng', 'KH D', 'tuan', 'hoa', [], 'lan', '2026-01-01', '2026-12-31', null],
  ['P06', 'Chuyển đổi cloud', 'KH E', 'tuan', 'khanh', ['quang'], 'mai', '2026-06-01', '2026-10-31', null],
  ['P07', 'Web thương mại', 'KH F', 'hung', 'long', [], 'lan', '2026-09-01', '2026-12-15', null],
];

// project, VN time, author, health, summary, needHelp
const UPDATES: [string, string, string, Health | null, string, string?][] = [
  ['P01', '2026-10-07 17:00', 'an', 'green', 'Test tích hợp module nhập kho đạt 80%. Không có vấn đề lớn.'],
  ['P02', '2026-10-06 16:00', 'binh', 'yellow', 'Spec thanh toán mới chốt 70%, phần thiết kế chậm 2 ngày.', 'Nhờ Key BrSE hối khách chốt spec trước 09/10'],
  ['P03', '2026-10-07 18:00', 'cuong', 'red', 'UAT chưa bắt đầu do môi trường test của khách chưa sẵn sàng; thiếu 1 dev Java.', 'Cần thêm 1 dev Java từ 09/10'],
  ['P03', '2026-10-08 08:30', 'son', 'red', 'Khách xác nhận bàn giao môi trường test 10/10. Đã lập kế hoạch UAT mới bắt đầu 12/10.'],
  ['P03', '2026-10-08 09:00', 'minh', null, 'Duyệt mượn 1 dev Java từ nhóm GL Hùng trong 3 tuần. Cập nhật mỗi 8 giờ đến khi UAT bắt đầu.'],
  ['P03', '2026-10-08 09:30', 'mai', 'red', 'PMO xác nhận Đỏ, theo dõi sát.'],
  ['P04', '2026-10-05 16:00', 'phuc', 'green', '(Cập nhật thay Dũng nghỉ phép) Q&A còn 12 câu chờ công ty mẹ.'],
  ['P04', '2026-10-06 11:00', 'lan', 'yellow', 'PMO đánh giá Vàng vì Q&A tồn đã quá hạn, ảnh hưởng review thiết kế.'],
  ['P05', '2026-09-28 15:00', 'hoa', 'green', 'Bảo trì ổn định, 3 ticket trong tuần đã xử lý.'],
  ['P06', '2026-10-06 10:00', 'khanh', 'yellow', 'Hiệu năng batch chưa đạt (45 phút), đang tối ưu. Release dự kiến 10/10.', 'Nhờ TL review phương án tối ưu'],
  ['P07', '2026-10-08 08:00', 'long', 'green', 'Đang phân tích yêu cầu, tiến độ đúng kế hoạch.'],
];

// project, type, title, priority, date, owner, status, note, created by
const ITEMS: [string, ItemType, string, Priority, string, string, ItemStatus, string | null, string][] = [
  ['P01', 'milestone', 'Giao hàng phase 1', 'high', '2026-10-20', 'an', 'open', null, 'an'],
  ['P01', 'event', 'Báo cáo tháng cho khách', 'medium', '2026-10-12', 'an', 'open', null, 'an'],
  ['P01', 'issue', 'Thiếu dữ liệu mẫu từ khách', 'low', '2026-09-30', 'an', 'done', 'Khách đã gửi 29/09', 'an'],
  ['P02', 'issue', 'Spec màn hình thanh toán chưa chốt', 'medium', '2026-10-09', 'binh', 'in_progress', 'Họp chốt 09/10', 'binh'],
  ['P02', 'event', 'Họp chốt spec thanh toán', 'high', '2026-10-09', 'binh', 'open', null, 'binh'],
  ['P02', 'milestone', 'UAT', 'medium', '2026-11-10', 'binh', 'open', null, 'lan'],
  ['P03', 'issue', 'Môi trường test của khách chưa sẵn sàng', 'high', '2026-10-03', 'son', 'in_progress', 'Khách hứa bàn giao 10/10', 'cuong'],
  ['P03', 'issue', 'Thiếu 1 dev Java cho UAT', 'high', '2026-10-09', 'minh', 'in_progress', 'Đã duyệt mượn từ nhóm GL Hùng', 'son'],
  ['P03', 'milestone', 'Bắt đầu UAT (kế hoạch mới)', 'high', '2026-10-12', 'cuong', 'open', 'Dời từ 01/10', 'cuong'],
  ['P03', 'event', 'Review kế hoạch đối ứng', 'high', '2026-10-09', 'son', 'open', null, 'mai'],
  ['P04', 'issue', 'Q&A tồn 12 câu với công ty mẹ', 'medium', '2026-10-05', 'dung', 'open', null, 'lan'],
  ['P04', 'event', 'Review thiết kế với công ty mẹ', 'medium', '2026-10-14', 'dung', 'open', null, 'dung'],
  ['P05', 'event', 'Audit bảo mật của khách', 'medium', '2026-10-15', 'hoa', 'open', null, 'lan'],
  ['P06', 'milestone', 'Release batch mới', 'high', '2026-10-10', 'khanh', 'open', null, 'khanh'],
  ['P06', 'issue', 'Hiệu năng batch chưa đạt (45 > 30 phút)', 'high', '2026-10-09', 'khanh', 'in_progress', 'TL đang review', 'khanh'],
  ['P06', 'milestone', 'Bàn giao cuối', 'high', '2026-10-28', 'khanh', 'open', null, 'khanh'],
  ['P07', 'event', 'Kết thúc phân tích yêu cầu', 'medium', '2026-10-16', 'long', 'open', null, 'long'],
];

// Colours of the days before the Excel's "now", oldest first (g / y / r; p = paused), so the trend
// views have something to show (the Excel had no history); today's come from the data above.
const HISTORY: Record<string, string> = {
  P01: 'ggggggggggggggggggggggggggg',
  P02: 'ggggggggggggggggggggyyyyyyy',
  P03: 'yyyyyyyyyyyyyyyyyyyyyyyyyrr',
  P04: 'ggggggggggggggggggggggggyyy',
  P05: 'gggggpppppppggggggggggggggg',
  P06: 'ggggggggggyyyyyyyyrrrrryyyy',
  P07: 'ggggggggggggggggggggggggggg',
};
const HISTORY_HEALTH: Record<string, Health> = { g: 'green', y: 'yellow', r: 'red', p: 'green' };

/** Writes the sample into `store`, shifted so that the Excel's "now" becomes the day of `now`. */
export async function loadSample(store: Store, now: Date) {
  const shiftDays = Math.round((Date.parse(vnDate(now)) - Date.parse(SAMPLE_NOW_VN.slice(0, 10))) / 86_400_000);
  const shiftMs = shiftDays * 86_400_000;
  const day = (d: string) => new Date(Date.parse(d) + shiftMs).toISOString().slice(0, 10);
  const time = (vn: string) => new Date(Date.parse(vnToIso(vn)) + shiftMs).toISOString();
  const roles = Object.fromEntries(USERS.map(([id, , role]) => [id, role]));
  const created = time('2026-09-01 08:00');

  for (const [id, name, role] of USERS) await store.putUser({ id: u(id), name, role, createdAt: created });

  for (const [id, name, customer, gl, pl, supporters, pmo, start, end, freq] of PROJECTS) {
    const p: Project = {
      id,
      name,
      customer,
      gl: u(gl),
      pl: u(pl),
      supporters: supporters.map(u),
      pmo: u(pmo),
      startDate: day(start),
      endDate: day(end),
      state: 'active',
      updateFrequencyHours: freq,
      publicVisible: true,
      createdBy: u('lan'),
      createdAt: created,
      updatedAt: created,
    };
    await store.createProject(p);
    await store.nextSeq('project');
  }

  let n = 0;
  for (const [projectId, at, author, health, summary, needHelp] of UPDATES) {
    await store.putUpdate({
      id: `seed${++n}`,
      projectId,
      at: time(at),
      author: u(author),
      authorRole: roles[author],
      health: health ?? undefined,
      summary,
      needHelp,
    });
  }

  for (const [projectId, type, title, priority, date, owner, status, note, by] of ITEMS) {
    const seq = await store.nextSeq('item');
    await store.putItem({
      id: `I${String(seq).padStart(4, '0')}`,
      projectId,
      type,
      title,
      priority,
      date: day(date),
      owner: u(owner),
      status,
      note: note ?? undefined,
      createdBy: u(by),
      createdAt: created,
      updatedAt: created,
    });
  }

  const today = vnDate(now);
  const length = HISTORY.P01.length;
  for (let back = length; back >= 1; back--) {
    const projects: Record<string, HealthMark> = {};
    for (const [id, marks] of Object.entries(HISTORY)) {
      const c = marks[length - back];
      const health = HISTORY_HEALTH[c];
      projects[id] = { state: c === 'p' ? 'paused' : 'active', health, declaredHealth: health, overdueItems: 0, lateHours: 0 };
    }
    const date = addDays(today, -back);
    await store.putHealthDay({ date, at: vnToIso(`${date} 23:00`), projects });
  }
  await recordHealth(store, await store.snapshot({ now }), now);
}
