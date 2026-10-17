// Bot commands: /mine, /status P03, /late, /help. Answers show only what the asker may see on the web
// (a group: its channel's scope, as seen by the channel's creator).
import { takesPart } from '../auth.js';
import { l } from '../i18n.js';
import type { Message, MessageLine } from '../notify/message.js';
import { clip, dm, effectiveDetail, HEALTH, hours, link, MAX_LINES, TYPE, compact } from '../notify/render.js';
import { inScope } from '../notify/routeChannels.js';
import { buildProjectView, type ProjectView } from '../rules.js';
import type { Snapshot } from '../store/store.js';
import { activeProjectViews, visibleSnapshot } from '../views.js';
import type { Asker, BotDeps } from './who.js';

export const COMMANDS = ['mine', 'status', 'late', 'help'] as const;
export type Command = (typeof COMMANDS)[number];

type Known = Exclude<Asker, { kind: 'unknown' }>;

/** Vietnam time as dd/mm HH:MM. */
const vnTime = (iso: string) => {
  const t = new Date(Date.parse(iso) + 7 * 3600_000).toISOString();
  return `${dm(t.slice(0, 10))} ${t.slice(11, 16)}`;
};

/** The data the asker may see: their projects on the web, or the group channel's scope. */
function visible(deps: BotDeps, asker: Known, all: Snapshot): Snapshot {
  if (asker.kind === 'person') return visibleSnapshot(asker.user, all);
  const snap = visibleSnapshot(asker.owner, all);
  const projects = snap.projects.filter((p) => inScope(asker.channel, p));
  const ids = new Set(projects.map((p) => p.id));
  return {
    ...snap,
    projects,
    updates: snap.updates.filter((u) => ids.has(u.projectId)),
    items: snap.items.filter((i) => ids.has(i.projectId)),
  };
}

function projectLine(v: ProjectView): MessageLine {
  const state =
    v.lateHours > 0
      ? l(`trễ cập nhật ${hours(v.lateHours)}`, `報告が ${hours(v.lateHours)} 遅れ`)
      : l(`hạn cập nhật ${vnTime(v.dueAt)}`, `報告期限 ${vnTime(v.dueAt)}`);
  return { text: `${HEALTH(v.health)} **${v.id}** · ${v.name} — ${state}`, tone: v.lateHours > 0 ? 'attention' : undefined, compact: true };
}

function capped(lines: MessageLine[]): MessageLine[] {
  if (lines.length <= MAX_LINES) return lines;
  return [
    ...lines.slice(0, MAX_LINES),
    { text: l(`… và ${lines.length - MAX_LINES} dự án khác`, `… ほか ${lines.length - MAX_LINES} 件`), subtle: true, compact: true },
  ];
}

export function helpMessage(asker: Known): Message {
  return {
    title: l('🤖 Lệnh của bot', '🤖 ボットのコマンド'),
    lines: [
      {
        text:
          asker.kind === 'group'
            ? l('/mine — các dự án của kênh này (trạng thái, trễ cập nhật)', '/mine — このチャネルのプロジェクト（状態・報告の遅れ）')
            : l('/mine — dự án của tôi (trạng thái, trễ cập nhật)', '/mine — 自分のプロジェクト（状態・報告の遅れ）'),
      },
      { text: l('/status P03 — tình hình một dự án', '/status P03 — 1 つのプロジェクトの状況') },
      { text: l('/late — các dự án đang trễ cập nhật', '/late — 報告が遅れているプロジェクト') },
      { text: l('/help — danh sách lệnh', '/help — コマンド一覧') },
      ...(asker.kind === 'person' && asker.user.role !== 'OTHER'
        ? [
            {
              text: l(
                'Gõ ghi chú tự do (vd. "P03 xong UAT, chuyển xanh") — bot đề xuất thay đổi bằng AI, bạn bấm Xác nhận thì mới ghi.',
                '自由にメモを書くと（例:「P03 UAT 完了、緑に」）AI が変更を提案します。「確定」を押すまで保存されません。',
              ),
              subtle: true,
            },
          ]
        : []),
    ],
  };
}

export async function runCommand(deps: BotDeps, asker: Known, command: Command, args: string): Promise<Message> {
  if (command === 'help') return helpMessage(asker);
  const snap = visible(deps, asker, await deps.store.snapshot({ now: deps.now }));
  const views = activeProjectViews(snap, deps.now);
  let msg: Message;

  if (command === 'mine') {
    const mine =
      asker.kind === 'group'
        ? views
        : views.filter((v) => takesPart(v, asker.user.id) || v.openItems.some((i) => i.owner === asker.user.id));
    msg = {
      title:
        asker.kind === 'group'
          ? l(
              `📋 Dự án của kênh "${asker.channel.name}" (${mine.length})`,
              `📋 チャネル「${asker.channel.name}」のプロジェクト (${mine.length})`,
            )
          : l(`📋 Dự án của tôi (${mine.length})`, `📋 自分のプロジェクト (${mine.length})`),
      lines: mine.length
        ? capped(mine.map(projectLine))
        : [{ text: l('Không có dự án đang chạy nào.', '進行中のプロジェクトはありません。'), subtle: true, compact: true }],
      link: link(deps.notify, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
    };
  } else if (command === 'late') {
    const late = views.filter((v) => v.lateHours > 0).sort((a, b) => b.lateHours - a.lateHours);
    msg = {
      title: l(`⏰ Đang trễ cập nhật (${late.length})`, `⏰ 報告が遅れているプロジェクト (${late.length})`),
      lines: late.length
        ? capped(late.map(projectLine))
        : [{ text: l('Không có dự án nào trễ cập nhật. 👍', '報告が遅れているプロジェクトはありません。👍'), subtle: true, compact: true }],
      link: link(deps.notify, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
    };
  } else {
    msg = statusMessage(deps, snap, args.trim().split(/\s+/)[0]?.toUpperCase() ?? '');
  }
  // A compact group channel never shows text people typed (summaries, item titles).
  if (asker.kind === 'group' && effectiveDetail(asker.channel, snap.settings) === 'compact') return compact(msg);
  return msg;
}

function statusMessage(deps: BotDeps, snap: Snapshot, id: string): Message {
  if (!id) return { title: l('Cách dùng: /status P03', '使い方: /status P03'), lines: [] };
  const p = snap.projects.find((x) => x.id === id);
  // Projects the asker may not see answer like missing ones.
  if (!p) return { title: l(`Không tìm thấy dự án ${id}`, `プロジェクト ${id} が見つかりません`), lines: [] };
  const v = buildProjectView(p, snap.updates, snap.items, snap.settings, deps.now);
  const lines: MessageLine[] = [projectLine(v)];
  if (p.state !== 'active')
    lines.push({ text: p.state === 'paused' ? l('Đang tạm dừng', '一時停止中') : l('Đã đóng', '終了'), subtle: true, compact: true });
  if (v.latestUpdate)
    lines.push({
      text: `${l('Cập nhật', '報告')} ${vnTime(v.latestUpdate.at)}: ${clip(v.latestUpdate.summary, 400)}`,
      compact: `${l('Cập nhật gần nhất', '最新の報告')} ${vnTime(v.latestUpdate.at)}`,
    });
  if (v.lastOwnerUpdate?.needHelp)
    lines.push({
      text: `🙋 ${l('Cần hỗ trợ', '支援依頼')}: ${clip(v.lastOwnerUpdate.needHelp, 300)}`,
      tone: 'warning',
      compact: `🙋 ${l('Cần hỗ trợ', '支援依頼')}`,
    });
  lines.push({
    text: l(
      `Vấn đề mở ${v.openIssues} (cao ${v.highIssues}) · quá hạn ${v.overdueItems}`,
      `未解決の課題 ${v.openIssues}（高 ${v.highIssues}）· 期限超過 ${v.overdueItems}`,
    ),
    subtle: true,
    compact: true,
  });
  if (v.nextItem)
    lines.push({
      text: `${l('Sắp tới', '次の予定')}: ${TYPE(v.nextItem.type)} ${dm(v.nextItem.date)} "${clip(v.nextItem.title, 120)}"`,
      compact: `${l('Sắp tới', '次の予定')}: ${TYPE(v.nextItem.type)} ${dm(v.nextItem.date)}`,
    });
  return {
    title: `${p.id} · ${p.name}`,
    tone: v.health === 'red' ? 'attention' : undefined,
    lines,
    link: link(deps.notify, `/projects/${p.id}`, l('Mở dự án', 'プロジェクトを開く')),
  };
}
