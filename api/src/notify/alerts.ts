// Decides which Teams channels get which alerts, de-duplicates them and builds the messages.
import { type ItemView, type ProjectView } from '../rules.js';
import type { Store } from '../store/store.js';
import { l, withLang } from '../i18n.js';
import { vnDate } from '../time.js';
import type { AlertEvent, Channel, Health, Item, Project, Update } from '../types.js';
import { activeProjectViews } from '../views.js';
import type { Message, MessageLine } from './message.js';
import type { Sender } from './sender.js';

export interface NotifyDeps {
  store: Store;
  send: Sender;
  /** Base URL of the web app, used for "open project" links. */
  webUrl?: string;
}

const HEALTH = (h: Health) => ({ green: l('● Xanh', '● 緑'), yellow: l('▲ Vàng', '▲ 黄'), red: l('■ Đỏ', '■ 赤') })[h];
const TYPE = (t: Item['type']) =>
  ({ issue: l('▲ Vấn đề', '▲ 課題'), event: l('● Sự kiện', '● イベント'), milestone: l('◆ Mốc', '◆ マイルストーン') })[t];
const MAX_LINES = 15;
const DEDUPE_DAYS = 14;

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
function hours(h: number) {
  const t = Math.round(h);
  const [d, hr] = [l(' ngày', '日'), l(' giờ', '時間')];
  return t >= 24 ? `${Math.floor(t / 24)}${d}${t % 24 ? ` ${t % 24}${hr}` : ''}` : `${t}${hr}`;
}
const clip = (s = '', n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const vnHour = (now: Date) => (now.getUTCHours() + 7) % 24;
const message = (m: Message): Message => m;

export function inScope(ch: Channel, p: Pick<Project, 'id' | 'gl'>): boolean {
  if (ch.scope.type === 'gl') return !!ch.scope.gl && p.gl === ch.scope.gl;
  if (ch.scope.type === 'projects') return (ch.scope.projects ?? []).includes(p.id);
  return true;
}

function wants(ch: Channel, event: AlertEvent, p?: Pick<Project, 'id' | 'gl'>) {
  return ch.enabled && ch.events.includes(event) && (!p || inScope(ch, p));
}

function link(deps: NotifyDeps, path: string, title: string) {
  return deps.webUrl ? { title, url: deps.webUrl.replace(/\/$/, '') + path } : undefined;
}

/** Sends one message and records the outcome on the channel (shown on the web page). */
export async function deliver(deps: NotifyDeps, ch: Channel, msg: Message, now: Date): Promise<boolean> {
  try {
    await deps.send(ch, msg);
    await deps.store.putChannel({ ...ch, lastSentAt: now.toISOString(), lastError: undefined });
    return true;
  } catch (e) {
    console.error(`Delivery failed for ${ch.kind} channel ${ch.id}`, e);
    await deps.store.putChannel({ ...ch, lastError: (e as Error).message.slice(0, 300) });
    return false;
  }
}

async function names(store: Store) {
  const users = await store.listUsers();
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return (id?: string) => (id ? (byId.get(id) ?? id.split('@')[0]) : '—');
}

export function testMessage(ch: Pick<Channel, 'name'>, webUrl?: string) {
  return message({
    title: l(`✅ Đã kết nối "${ch.name}" với hệ thống Theo dõi dự án`, `✅「${ch.name}」をプロジェクト管理システムに接続しました`),
    tone: 'good',
    lines: [
      {
        text: l('Từ giờ các cảnh báo và bản tóm tắt sẽ được gửi vào đây.', '今後、アラートとサマリーはここに送信されます。'),
        subtle: true,
      },
    ],
    link: webUrl ? { title: l('Mở hệ thống', 'システムを開く'), url: webUrl } : undefined,
  });
}

// ---------- Immediate alerts (sent from the API right after a change) ----------

function becameRedMessage(deps: NotifyDeps, view: ProjectView, update: Update, name: (id?: string) => string) {
  return message({
    title: l(`■ ${view.id} · ${view.name} chuyển sang ĐỎ`, `■ ${view.id} · ${view.name} が「赤」になりました`),
    tone: 'attention',
    lines: [
      { text: `${name(update.author)}: ${clip(update.summary, 400)}` },
      ...(update.needHelp ? [{ text: `🙋 ${l('Cần hỗ trợ', '支援依頼')}: ${clip(update.needHelp, 300)}` }] : []),
      { text: `GL ${name(view.gl)} · PL ${name(view.pl)}`, subtle: true },
    ],
    link: link(deps, `/projects/${view.id}`, l('Mở dự án', 'プロジェクトを開く')),
  });
}

function highIssueMessage(deps: NotifyDeps, project: Project, item: Item, name: (id?: string) => string) {
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
      },
      ...(item.note ? [{ text: clip(item.note, 300), subtle: true }] : []),
    ],
    link: link(deps, `/projects/${project.id}`, l('Mở dự án', 'プロジェクトを開く')),
  });
}

/** A project's aggregated health turned red. */
export async function notifyBecameRed(deps: NotifyDeps, now: Date, view: ProjectView, update: Update) {
  const channels = (await deps.store.listChannels()).filter((c) => wants(c, 'became_red', view));
  if (!channels.length) return;
  const name = await names(deps.store);
  await Promise.all(channels.map((c) => withLang(c.lang, () => deliver(deps, c, becameRedMessage(deps, view, update, name), now))));
}

/** A new high-priority issue was logged. */
export async function notifyHighIssue(deps: NotifyDeps, now: Date, project: Project, item: Item) {
  const channels = (await deps.store.listChannels()).filter((c) => wants(c, 'high_issue', project));
  if (!channels.length) return;
  const name = await names(deps.store);
  await Promise.all(channels.map((c) => withLang(c.lang, () => deliver(deps, c, highIssueMessage(deps, project, item, name), now))));
}

// ---------- Hourly job ----------

interface Pending {
  key: string;
  line: MessageLine;
}

function collectAlerts(ch: Channel, views: ProjectView[], now: Date, name: (id?: string) => string): Pending[] {
  const out: Pending[] = [];
  const today = vnDate(now);
  for (const v of views) {
    if (ch.events.includes('late_update') && v.lateHours > 0) {
      // One reminder per missed deadline, repeated every 24h while it stays late.
      out.push({
        key: `late#${v.id}#${v.dueAt}#${Math.floor(v.lateHours / 24)}`,
        line: {
          text: l(
            `⏰ ${v.id} · ${v.name}: trễ cập nhật ${hours(v.lateHours)} — nhắc PL ${name(v.pl)}, GL ${name(v.gl)}`,
            `⏰ ${v.id} · ${v.name}: 報告が ${hours(v.lateHours)} 遅れています — PL ${name(v.pl)}、GL ${name(v.gl)} へ`,
          ),
        },
      });
    }
    for (const i of v.openItems) {
      if (ch.events.includes('overdue') && i.overdue) {
        out.push({
          key: `overdue#${i.id}#${today}`,
          line: {
            text: l(
              `⚠ ${v.id}: ${TYPE(i.type)} "${i.title}" quá hạn ${-i.daysLeft} ngày — ${name(i.owner)}`,
              `⚠ ${v.id}: ${TYPE(i.type)}「${i.title}」期限を ${-i.daysLeft} 日超過 — ${name(i.owner)}`,
            ),
            tone: 'attention',
          },
        });
      }
      if (ch.events.includes('milestone_soon') && i.type !== 'issue' && i.daysLeft === 1) {
        out.push({
          key: `soon#${i.id}#${i.date}`,
          line: {
            text: l(
              `📅 Ngày mai ${dm(i.date)} – ${v.id}: ${TYPE(i.type)} "${i.title}"`,
              `📅 明日 ${dm(i.date)} – ${v.id}: ${TYPE(i.type)}「${i.title}」`,
            ),
          },
        });
      }
    }
  }
  return out;
}

function hourlyMessage(deps: NotifyDeps, pending: Pending[]) {
  const shown = pending.slice(0, MAX_LINES).map((p) => p.line);
  if (pending.length > MAX_LINES)
    shown.push({ text: l(`… và ${pending.length - MAX_LINES} mục khác`, `… ほか ${pending.length - MAX_LINES} 件`), subtle: true });
  return message({
    title: `🔔 ${l('Cần chú ý', '要注意')} (${pending.length})`,
    tone: 'warning',
    lines: shown,
    link: link(deps, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
  });
}

function digestMessage(deps: NotifyDeps, ch: Channel, views: ProjectView[], now: Date, name: (id?: string) => string) {
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
    },
    {
      text: l(`⏰ Trễ cập nhật: ${late} · ⚠ Mục quá hạn: ${overdue}`, `⏰ 報告遅れ: ${late} · ⚠ 期限超過: ${overdue}`),
      tone: late || overdue ? 'attention' : 'default',
    },
  ];
  if (attention.length) {
    lines.push({ text: `**${l('Cần chú ý', '要注意')}**` });
    for (const v of attention)
      lines.push({
        text: `${HEALTH(v.health)} ${v.id} · ${v.name} — ${clip(v.latestUpdate?.summary ?? l('chưa có cập nhật', '報告なし'), 120)}`,
      });
  }
  if (soon.length) {
    lines.push({ text: `**${l('Hôm nay & ngày mai', '今日・明日')}**` });
    for (const [v, i] of soon.slice(0, 8))
      lines.push({
        text: `${i.daysLeft === 0 ? l('Hôm nay', '今日') : l('Ngày mai', '明日')} – ${v.id}: ${TYPE(i.type)} ${l(`"${i.title}"`, `「${i.title}」`)} (${name(i.owner)})`,
      });
  }
  return message({
    title: `☀️ ${l('Tóm tắt dự án', 'プロジェクトサマリー')} ${dm(vnDate(now))} – ${ch.name}`,
    lines,
    link: link(deps, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
  });
}

/** One channel's hourly alerts and digest, in the channel's language. */
async function runChannel(deps: NotifyDeps, ch: Channel, views: ProjectView[], now: Date, name: (id?: string) => string) {
  const hour = vnHour(now);
  const quiet = hour >= 22 || hour < 7;
  let sent = 0;
  const scoped = views.filter((v) => inScope(ch, v));

  if (!(quiet && ch.quietHours)) {
    const pending: Pending[] = [];
    for (const p of collectAlerts(ch, scoped, now, name)) {
      if (!(await deps.store.hasSent(`${ch.id}#${p.key}`))) pending.push(p);
    }
    if (pending.length) {
      const msg = hourlyMessage(deps, pending);
      // Mark as sent only after a successful delivery, so failures are retried next hour.
      if (await deliver(deps, ch, msg, now)) {
        sent++;
        await Promise.all(pending.map((p) => deps.store.markSent(`${ch.id}#${p.key}`, DEDUPE_DAYS)));
      }
    }
  }

  const digestKey = `${ch.id}#digest#${vnDate(now)}`;
  if (wants(ch, 'daily_digest') && hour === 8 && scoped.length && !(await deps.store.hasSent(digestKey))) {
    if (await deliver(deps, ch, digestMessage(deps, ch, scoped, now, name), now)) {
      sent++;
      await deps.store.markSent(digestKey, 2);
    }
  }
  return sent;
}

/**
 * Runs every hour: late updates, overdue items and tomorrow's events/milestones
 * (once each, batched into one message per channel), plus the 08:00 daily digest.
 */
export async function runHourly(deps: NotifyDeps, now: Date): Promise<{ messages: number }> {
  const channels = (await deps.store.listChannels()).filter((c) => c.enabled);
  if (!channels.length) return { messages: 0 };
  const snap = await deps.store.snapshot();
  const views = activeProjectViews(snap, now);
  const byId = new Map(snap.users.map((u) => [u.id, u.name]));
  const name = (id?: string) => (id ? (byId.get(id) ?? id.split('@')[0]) : '—');
  let messages = 0;

  for (const ch of channels) messages += await withLang(ch.lang, () => runChannel(deps, ch, views, now, name));
  return { messages };
}

// ---------- Samples ("Gửi thử" on the channels page) ----------

export const TEST_SAMPLES = ['connect', 'became_red', 'high_issue', 'hourly', 'daily_digest'] as const;
export type TestSample = (typeof TEST_SAMPLES)[number];

/**
 * A preview of a real alert built from the channel's current data, so people can see
 * what they will receive. Nothing is de-duplicated or marked as sent.
 */
export function sampleMessage(deps: NotifyDeps, ch: Channel, sample: TestSample, now: Date): Promise<Message> {
  return withLang(ch.lang, () => buildSample(deps, ch, sample, now));
}

async function buildSample(deps: NotifyDeps, ch: Channel, sample: TestSample, now: Date): Promise<Message> {
  if (sample === 'connect') return testMessage(ch, deps.webUrl);
  const snap = await deps.store.snapshot();
  const views = activeProjectViews(snap, now).filter((v) => inScope(ch, v)); // worst first
  const byId = new Map(snap.users.map((u) => [u.id, u.name]));
  const name = (id?: string) => (id ? (byId.get(id) ?? id.split('@')[0]) : '—');
  const note: MessageLine = {
    text: l(
      '🧪 Tin mẫu từ dữ liệu hiện tại — không phải cảnh báo thật.',
      '🧪 現在のデータから作成したサンプルです — 実際のアラートではありません。',
    ),
    subtle: true,
  };
  const tag = l('[Mẫu]', '[サンプル]');
  const mark = (m: Message): Message => ({ ...m, title: `${tag} ${m.title}`, lines: [...m.lines, note] });
  const empty = (what: string) =>
    message({
      title: `${tag} ${what}`,
      lines: [
        {
          text: l(
            'Phạm vi của kênh hiện chưa có dữ liệu phù hợp để làm mẫu.',
            'このチャネルの対象範囲には、サンプルに使えるデータがまだありません。',
          ),
        },
        note,
      ],
    });

  if (sample === 'became_red') {
    const v = views[0];
    if (!v) return empty(l('Dự án chuyển sang ĐỎ', 'プロジェクトが「赤」に'));
    const update: Update = v.latestUpdate ?? {
      id: 'sample',
      projectId: v.id,
      at: now.toISOString(),
      author: v.pl ?? '',
      authorRole: 'PL',
      summary: l('Chưa có cập nhật', '報告なし'),
    };
    return mark(becameRedMessage(deps, v, update, name));
  }
  if (sample === 'high_issue') {
    const issues = views.flatMap((v) => v.openItems.filter((i) => i.type === 'issue').map((i) => [v, i] as const));
    const pick = issues.find(([, i]) => i.priority === 'high') ?? issues[0];
    if (!pick) return empty(l('Vấn đề ưu tiên cao mới', '優先度「高」の新しい課題'));
    return mark(highIssueMessage(deps, pick[0], pick[1], name));
  }
  if (sample === 'hourly') {
    const all: Channel = { ...ch, events: [...ch.events, 'late_update', 'overdue', 'milestone_soon'] };
    const pending = collectAlerts(all, views, now, name);
    if (!pending.length) return empty(l('Cần chú ý', '要注意'));
    return mark(hourlyMessage(deps, pending));
  }
  if (!views.length) return empty(l('Tóm tắt dự án', 'プロジェクトサマリー'));
  return mark(digestMessage(deps, ch, views, now, name));
}
