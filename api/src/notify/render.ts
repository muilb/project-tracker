// Builds the channel-neutral messages (Teams / Telegram / Slack / inbox render them).
import type { ItemView, ProjectView } from '../rules.js';
import { l } from '../i18n.js';
import { vnDate } from '../time.js';
import type { Channel, ChannelDetail, Health, Item, Project, Settings, Update } from '../types.js';
import type { NotifyDeps } from './deps.js';
import type { Pending } from './events.js';
import type { Message, MessageLine } from './message.js';

export const HEALTH = (h: Health) => ({ green: l('● Xanh', '● 緑'), yellow: l('▲ Vàng', '▲ 黄'), red: l('■ Đỏ', '■ 赤') })[h];
export const TYPE = (t: Item['type']) =>
  ({ issue: l('▲ Vấn đề', '▲ 課題'), event: l('● Sự kiện', '● イベント'), milestone: l('◆ Mốc', '◆ マイルストーン') })[t];
export const MAX_LINES = 15;
export const DEDUPE_DAYS = 14;

export const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export function hours(h: number) {
  const t = Math.round(h);
  const [d, hr] = [l(' ngày', '日'), l(' giờ', '時間')];
  return t >= 24 ? `${Math.floor(t / 24)}${d}${t % 24 ? ` ${t % 24}${hr}` : ''}` : `${t}${hr}`;
}
export const clip = (s = '', n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const message = (m: Message): Message => m;

export function link(deps: NotifyDeps, path: string, title: string) {
  return deps.webUrl ? { title, url: deps.webUrl.replace(/\/$/, '') + path } : undefined;
}

export function testMessage(ch: Pick<Channel, 'name'>, webUrl?: string) {
  return message({
    title: l(`✅ Đã kết nối "${ch.name}" với hệ thống Theo dõi dự án`, `✅「${ch.name}」をプロジェクト管理システムに接続しました`),
    tone: 'good',
    lines: [
      {
        text: l('Từ giờ các cảnh báo và bản tóm tắt sẽ được gửi vào đây.', '今後、アラートとサマリーはここに送信されます。'),
        subtle: true,
        compact: true,
      },
    ],
    link: webUrl ? { title: l('Mở hệ thống', 'システムを開く'), url: webUrl } : undefined,
  });
}

export function becameRedMessage(deps: NotifyDeps, view: ProjectView, update: Update, name: (id?: string) => string) {
  return message({
    title: l(`■ ${view.id} · ${view.name} chuyển sang ĐỎ`, `■ ${view.id} · ${view.name} が「赤」になりました`),
    tone: 'attention',
    lines: [
      { text: `${name(update.author)}: ${clip(update.summary, 400)}` },
      ...(update.needHelp
        ? [{ text: `🙋 ${l('Cần hỗ trợ', '支援依頼')}: ${clip(update.needHelp, 300)}`, compact: `🙋 ${l('Cần hỗ trợ', '支援依頼')}` }]
        : []),
      { text: `GL ${name(view.gl)} · PL ${name(view.pl)}`, subtle: true },
    ],
    link: link(deps, `/projects/${view.id}`, l('Mở dự án', 'プロジェクトを開く')),
  });
}

export function highIssueMessage(deps: NotifyDeps, project: Project, item: Item, name: (id?: string) => string) {
  return message({
    title: l(`▲ Vấn đề ưu tiên cao mới – ${project.id} · ${project.name}`, `▲ 優先度「高」の新しい課題 – ${project.id} · ${project.name}`),
    tone: 'warning',
    lines: [
      { text: item.title },
      {
        text: l(
          `Hạn xử lý ${dm(item.date)} · phụ trách ${name(item.owner)} · nhập bởi ${name(item.createdBy)}`,
          `対応期限 ${dm(item.date)} · 担当 ${name(item.owner)} · 登録者 ${name(item.createdBy)}`,
        ),
        subtle: true,
        compact: l(`Hạn xử lý ${dm(item.date)}`, `対応期限 ${dm(item.date)}`),
      },
      ...(item.note ? [{ text: clip(item.note, 300), subtle: true }] : []),
    ],
    link: link(deps, `/projects/${project.id}`, l('Mở dự án', 'プロジェクトを開く')),
  });
}

export function hourlyMessage(deps: NotifyDeps, pending: Pending[]) {
  const shown = pending.slice(0, MAX_LINES).map((p) => p.line);
  if (pending.length > MAX_LINES)
    shown.push({
      text: l(`… và ${pending.length - MAX_LINES} mục khác`, `… ほか ${pending.length - MAX_LINES} 件`),
      subtle: true,
      compact: true,
    });
  return message({
    title: `🔔 ${l('Cần chú ý', '要注意')} (${pending.length})`,
    tone: 'warning',
    lines: shown,
    link: link(deps, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
  });
}

export function digestMessage(deps: NotifyDeps, ch: Channel, views: ProjectView[], now: Date, name: (id?: string) => string) {
  const count = (h: Health) => views.filter((v) => v.health === h).length;
  const late = views.filter((v) => v.lateHours > 0).length;
  const overdue = views.reduce((n, v) => n + v.overdueItems, 0);
  const attention = views.filter((v) => v.urgency !== 'normal').slice(0, 8);
  const soon: [ProjectView, ItemView][] = views.flatMap((v) =>
    v.openItems.filter((i) => i.type !== 'issue' && i.daysLeft >= 0 && i.daysLeft <= 1).map((i): [ProjectView, ItemView] => [v, i]),
  );
  const lines: MessageLine[] = [
    {
      text: `${l('Đang chạy', '進行中')} ${views.length} · ${HEALTH('red')} ${count('red')} · ${HEALTH('yellow')} ${count('yellow')} · ${HEALTH('green')} ${count('green')}`,
      compact: true,
    },
    {
      text: l(`⏰ Trễ cập nhật: ${late} · ⚠ Mục quá hạn: ${overdue}`, `⏰ 報告遅れ: ${late} · ⚠ 期限超過: ${overdue}`),
      tone: late || overdue ? 'attention' : 'default',
      compact: true,
    },
  ];
  if (attention.length) {
    lines.push({ text: `**${l('Cần chú ý', '要注意')}**`, compact: true });
    for (const v of attention)
      lines.push({
        text: `${HEALTH(v.health)} ${v.id} · ${v.name} — ${clip(v.latestUpdate?.summary ?? l('chưa có cập nhật', '報告なし'), 120)}`,
        compact: `${HEALTH(v.health)} ${v.id} · ${v.name}`,
      });
  }
  if (soon.length) {
    lines.push({ text: `**${l('Hôm nay & ngày mai', '今日・明日')}**`, compact: true });
    for (const [v, i] of soon.slice(0, 8))
      lines.push({
        text: `${i.daysLeft === 0 ? l('Hôm nay', '今日') : l('Ngày mai', '明日')} – ${v.id}: ${TYPE(i.type)} ${l(`"${i.title}"`, `「${i.title}」`)} (${name(i.owner)})`,
        compact: `${i.daysLeft === 0 ? l('Hôm nay', '今日') : l('Ngày mai', '明日')} – ${v.id}: ${TYPE(i.type)}`,
      });
  }
  return message({
    title: `☀️ ${l('Tóm tắt dự án', 'プロジェクトサマリー')} ${dm(vnDate(now))} – ${ch.name}`,
    lines,
    link: link(deps, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
  });
}

/** Several new high-priority issues of one channel, merged into one message (policy.hold). */
export function highIssueGroupMessage(deps: NotifyDeps, parts: { projectId?: string; message: Message }[]) {
  const ids = [...new Set(parts.map((p) => p.projectId).filter(Boolean))] as string[];
  const lines: MessageLine[] = [];
  for (const p of parts.slice(0, MAX_LINES)) {
    const [title, detail] = p.message.lines;
    const code = p.projectId ? `▲ **${p.projectId}**` : '▲';
    // The issue title is user-entered: compact channels get the project code only.
    lines.push({ text: `${code}${p.projectId ? ':' : ''} ${title?.text ?? p.message.title}`, compact: code });
    if (detail) lines.push({ ...detail, subtle: true });
  }
  if (parts.length > MAX_LINES)
    lines.push({
      text: l(`… và ${parts.length - MAX_LINES} vấn đề khác`, `… ほか ${parts.length - MAX_LINES} 件`),
      subtle: true,
      compact: true,
    });
  const n = parts.length;
  return message({
    title:
      ids.length === 1
        ? l(`▲ ${n} vấn đề ưu tiên cao mới ở ${ids[0]}`, `▲ ${ids[0]} に優先度「高」の新しい課題が ${n} 件`)
        : l(`▲ ${n} vấn đề ưu tiên cao mới`, `▲ 優先度「高」の新しい課題が ${n} 件`),
    tone: 'warning',
    lines,
    link:
      ids.length === 1
        ? link(deps, `/projects/${ids[0]}`, l('Mở dự án', 'プロジェクトを開く'))
        : link(deps, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
  });
}

/** What changed since the same time last week (built by events.weeklyChanges). */
export interface WeeklyChanges {
  /** Projects whose colour differs from a week ago. */
  colour: { view: ProjectView; before: Health }[];
  /** Items marked done during the week. */
  closed: Item[];
}

/** The Monday digest: colour changes vs last week, items closed, events / milestones in the next 7 days. */
export function weeklyDigestMessage(
  deps: NotifyDeps,
  ch: Channel,
  views: ProjectView[],
  changes: WeeklyChanges,
  now: Date,
  name: (id?: string) => string,
) {
  const count = (h: Health) => views.filter((v) => v.health === h).length;
  const more = (n: number): MessageLine => ({ text: l(`… và ${n} mục khác`, `… ほか ${n} 件`), subtle: true, compact: true });
  const heading = (text: string, n: number): MessageLine => ({ text: `**${text}** (${n})`, compact: true });
  const lines: MessageLine[] = [
    {
      text: `${l('Đang chạy', '進行中')} ${views.length} · ${HEALTH('red')} ${count('red')} · ${HEALTH('yellow')} ${count('yellow')} · ${HEALTH('green')} ${count('green')}`,
      compact: true,
    },
  ];

  lines.push(heading(l('Đổi màu so với tuần trước', '先週から色が変わったプロジェクト'), changes.colour.length));
  if (!changes.colour.length) lines.push({ text: l('Không có', 'なし'), subtle: true, compact: true });
  for (const { view, before } of changes.colour.slice(0, 8))
    lines.push({
      text: `${view.id} · ${view.name}: ${HEALTH(before)} → ${HEALTH(view.health)}`,
      tone: view.health === 'red' ? 'attention' : 'default',
      compact: true,
    });
  if (changes.colour.length > 8) lines.push(more(changes.colour.length - 8));

  lines.push(heading(l('Đã đóng trong tuần', '今週完了した項目'), changes.closed.length));
  for (const i of changes.closed.slice(0, 8))
    lines.push({
      text: `✔ ${i.projectId}: ${TYPE(i.type)} ${l(`"${i.title}"`, `「${i.title}」`)} (${name(i.owner)})`,
      compact: `✔ ${i.projectId}: ${TYPE(i.type)}`,
    });
  if (changes.closed.length > 8) lines.push(more(changes.closed.length - 8));

  const ahead: [ProjectView, ItemView][] = views
    .flatMap((v) =>
      v.openItems.filter((i) => i.type !== 'issue' && i.daysLeft >= 0 && i.daysLeft <= 7).map((i): [ProjectView, ItemView] => [v, i]),
    )
    .sort((a, b) => a[1].date.localeCompare(b[1].date));
  lines.push(heading(l('Mốc / sự kiện 7 ngày tới', '今後 7 日間のマイルストーン / イベント'), ahead.length));
  for (const [v, i] of ahead.slice(0, 10))
    lines.push({
      text: `${dm(i.date)} – ${v.id}: ${TYPE(i.type)} ${l(`"${i.title}"`, `「${i.title}」`)} (${name(i.owner)})`,
      compact: `${dm(i.date)} – ${v.id}: ${TYPE(i.type)}`,
    });
  if (ahead.length > 10) lines.push(more(ahead.length - 10));

  return message({
    title: `🗓 ${l('Tóm tắt tuần', '週次サマリー')} ${dm(vnDate(now))} – ${ch.name}`,
    lines,
    link: link(deps, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
  });
}

// track E: compact(msg) — drops user-entered text for channels with detail = 'compact'.

/**
 * The message without user-entered text (summaries, needHelp, notes, item titles, names):
 * each line is replaced by its `compact` version, lines without one are dropped.
 * Titles carry only project code + name, counts and the channel name.
 */
export function compact(msg: Message): Message {
  const lines = msg.lines.flatMap(({ compact: c, ...line }) => (c === undefined ? [] : [{ ...line, text: c === true ? line.text : c }]));
  return { ...msg, lines };
}

/** The detail level a group channel gets: PMO's system-wide maximum wins over the channel's own choice. */
export const effectiveDetail = (ch: Pick<Channel, 'detail'>, settings: Pick<Settings, 'maxChannelDetail'>): ChannelDetail =>
  settings.maxChannelDetail === 'compact' ? 'compact' : (ch.detail ?? 'full');
