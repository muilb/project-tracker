// Decides which Teams channels get which alerts, de-duplicates them and builds the messages.
import { type ItemView, type ProjectView } from '../rules.js';
import type { Store } from '../store/store.js';
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

const HEALTH: Record<Health, string> = { green: '● Xanh', yellow: '▲ Vàng', red: '■ Đỏ' };
const TYPE: Record<Item['type'], string> = { issue: '▲ Vấn đề', event: '● Sự kiện', milestone: '◆ Mốc' };
const MAX_LINES = 15;
const DEDUPE_DAYS = 14;

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
function hours(h: number) {
  const t = Math.round(h);
  return t >= 24 ? `${Math.floor(t / 24)} ngày${t % 24 ? ` ${t % 24} giờ` : ''}` : `${t} giờ`;
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
    title: `✅ Đã kết nối "${ch.name}" với hệ thống Theo dõi dự án`,
    tone: 'good',
    lines: [{ text: 'Từ giờ các cảnh báo và bản tóm tắt sẽ được gửi vào đây.', subtle: true }],
    link: webUrl ? { title: 'Mở hệ thống', url: webUrl } : undefined,
  });
}

// ---------- Immediate alerts (sent from the API right after a change) ----------

/** A project's aggregated health turned red. */
export async function notifyBecameRed(deps: NotifyDeps, now: Date, view: ProjectView, update: Update) {
  const channels = (await deps.store.listChannels()).filter((c) => wants(c, 'became_red', view));
  if (!channels.length) return;
  const name = await names(deps.store);
  const msg = message({
    title: `■ ${view.id} · ${view.name} chuyển sang ĐỎ`,
    tone: 'attention',
    lines: [
      { text: `${name(update.author)}: ${clip(update.summary, 400)}` },
      ...(update.needHelp ? [{ text: `🙋 Cần hỗ trợ: ${clip(update.needHelp, 300)}` }] : []),
      { text: `GL ${name(view.gl)} · PL ${name(view.pl)}`, subtle: true },
    ],
    link: link(deps, `/projects/${view.id}`, 'Mở dự án'),
  });
  await Promise.all(channels.map((c) => deliver(deps, c, msg, now)));
}

/** A new high-priority issue was logged. */
export async function notifyHighIssue(deps: NotifyDeps, now: Date, project: Project, item: Item) {
  const channels = (await deps.store.listChannels()).filter((c) => wants(c, 'high_issue', project));
  if (!channels.length) return;
  const name = await names(deps.store);
  const msg = message({
    title: `▲ Vấn đề ưu tiên cao mới – ${project.id} · ${project.name}`,
    tone: 'warning',
    lines: [
      { text: item.title },
      { text: `Hạn xử lý ${dm(item.date)} · phụ trách ${name(item.owner)} · nhập bởi ${name(item.createdBy)}`, subtle: true },
      ...(item.note ? [{ text: clip(item.note, 300), subtle: true }] : []),
    ],
    link: link(deps, `/projects/${project.id}`, 'Mở dự án'),
  });
  await Promise.all(channels.map((c) => deliver(deps, c, msg, now)));
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
        line: { text: `⏰ ${v.id} · ${v.name}: trễ cập nhật ${hours(v.lateHours)} — nhắc PL ${name(v.pl)}, GL ${name(v.gl)}` },
      });
    }
    for (const i of v.openItems) {
      if (ch.events.includes('overdue') && i.overdue) {
        out.push({
          key: `overdue#${i.id}#${today}`,
          line: { text: `⚠ ${v.id}: ${TYPE[i.type]} "${i.title}" quá hạn ${-i.daysLeft} ngày — ${name(i.owner)}`, tone: 'attention' },
        });
      }
      if (ch.events.includes('milestone_soon') && i.type !== 'issue' && i.daysLeft === 1) {
        out.push({ key: `soon#${i.id}#${i.date}`, line: { text: `📅 Ngày mai ${dm(i.date)} – ${v.id}: ${TYPE[i.type]} "${i.title}"` } });
      }
    }
  }
  return out;
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
    { text: `Đang chạy ${views.length} · ${HEALTH.red} ${count('red')} · ${HEALTH.yellow} ${count('yellow')} · ${HEALTH.green} ${count('green')}` },
    { text: `⏰ Trễ cập nhật: ${late} · ⚠ Mục quá hạn: ${overdue}`, tone: late || overdue ? 'attention' : 'default' },
  ];
  if (attention.length) {
    lines.push({ text: '**Cần chú ý**' });
    for (const v of attention)
      lines.push({ text: `${HEALTH[v.health]} ${v.id} · ${v.name} — ${clip(v.latestUpdate?.summary ?? 'chưa có cập nhật', 120)}` });
  }
  if (soon.length) {
    lines.push({ text: '**Hôm nay & ngày mai**' });
    for (const [v, i] of soon.slice(0, 8))
      lines.push({ text: `${i.daysLeft === 0 ? 'Hôm nay' : 'Ngày mai'} – ${v.id}: ${TYPE[i.type]} "${i.title}" (${name(i.owner)})` });
  }
  return message({
    title: `☀️ Tóm tắt dự án ${dm(vnDate(now))} – ${ch.name}`,
    lines,
    link: link(deps, '/', 'Mở tổng quan'),
  });
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
  const hour = vnHour(now);
  const quiet = hour >= 22 || hour < 7;
  let messages = 0;

  for (const ch of channels) {
    const scoped = views.filter((v) => inScope(ch, v));

    if (!(quiet && ch.quietHours)) {
      const pending: Pending[] = [];
      for (const p of collectAlerts(ch, scoped, now, name)) {
        if (!(await deps.store.hasSent(`${ch.id}#${p.key}`))) pending.push(p);
      }
      if (pending.length) {
        const shown = pending.slice(0, MAX_LINES).map((p) => p.line);
        if (pending.length > MAX_LINES) shown.push({ text: `… và ${pending.length - MAX_LINES} mục khác`, subtle: true });
        const msg = message({ title: `🔔 Cần chú ý (${pending.length})`, tone: 'warning', lines: shown, link: link(deps, '/', 'Mở tổng quan') });
        // Mark as sent only after a successful delivery, so failures are retried next hour.
        if (await deliver(deps, ch, msg, now)) {
          messages++;
          await Promise.all(pending.map((p) => deps.store.markSent(`${ch.id}#${p.key}`, DEDUPE_DAYS)));
        }
      }
    }

    const digestKey = `${ch.id}#digest#${vnDate(now)}`;
    if (wants(ch, 'daily_digest') && hour === 8 && scoped.length && !(await deps.store.hasSent(digestKey))) {
      if (await deliver(deps, ch, digestMessage(deps, ch, scoped, now, name), now)) {
        messages++;
        await deps.store.markSent(digestKey, 2);
      }
    }
  }
  return { messages };
}
