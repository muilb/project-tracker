// Personal notification settings: defaults by role, when a person may be disturbed, and the messages.
import { l } from '../i18n.js';
import type { ItemView, ProjectView } from '../rules.js';
import type { Item, NotifyPrefs, PersonalEvent, Project, Update, User } from '../types.js';
import type { NotifyDeps } from './deps.js';
import type { Message, MessageLine } from './message.js';
import { clip, dm, HEALTH, hours, link, message, MAX_LINES, TYPE } from './render.js';

const MANAGERS: User['role'][] = ['PMO', 'SUBMNG', 'MNG', 'ADMIN'];

/** Events switched on for someone who never saved their settings. */
export function defaultEvents(role: User['role']): PersonalEvent[] {
  const common: PersonalEvent[] = ['assigned_to_me', 'my_item_due', 'watched_red', 'watched_high_issue'];
  if (role === 'PL') return ['update_due_soon', 'late_update_mine', ...common];
  if (role === 'GL') return ['escalation', 'need_help', 'health_changed', ...common];
  if (MANAGERS.includes(role)) return ['escalation', 'need_help', ...common];
  return common;
}

export function defaultPrefs(user: User, now: Date): NotifyPrefs {
  return { userId: user.id, events: defaultEvents(user.role), telegram: false, watch: [], updatedAt: now.toISOString() };
}

/** Saved settings, or the role defaults. */
export async function prefsOf(store: { getNotifyPrefs(id: string): Promise<NotifyPrefs | undefined> }, user: User, now: Date) {
  return (await store.getNotifyPrefs(user.id)) ?? defaultPrefs(user, now);
}

/** Everyone's settings (saved or defaults), by user id. */
export async function allPrefs(store: { listNotifyPrefs(): Promise<NotifyPrefs[]> }, users: Iterable<User>, now: Date) {
  const saved = new Map((await store.listNotifyPrefs()).map((p) => [p.userId, p]));
  const out = new Map<string, NotifyPrefs>();
  for (const u of users) out.set(u.id, saved.get(u.id) ?? defaultPrefs(u, now));
  return out;
}

/**
 * Timing rules for policy.ts. A person has quiet hours (22:00–07:00 by default) unless the
 * schedule sets equal from / to; quiet hours hold back Telegram, the web inbox is silent anyway.
 */
export function timing(prefs: NotifyPrefs) {
  const s = prefs.schedule;
  const off = s?.quietFrom !== undefined && s.quietFrom === s.quietTo;
  return { quietHours: !off, schedule: s, pausedUntil: prefs.pausedUntil };
}

/** Projects a person follows: the ⭐ list in their settings. */
export const watches = (prefs: NotifyPrefs | undefined, projectId: string) => !!prefs?.watch?.includes(projectId);

// ---------- Messages (built inside withLang(prefs.lang)) ----------

const openProject = (deps: NotifyDeps, id: string) => link(deps, `/projects/${id}`, l('Mở dự án', 'プロジェクトを開く'));

export function personalTestMessage(deps: NotifyDeps): Message {
  return message({
    title: l('✅ Tin thử — thông báo cá nhân', '✅ テスト — 個人通知'),
    tone: 'good',
    lines: [
      {
        text: l('Thông báo cá nhân của bạn sẽ được gửi tới đây.', 'あなた宛ての通知はここに届きます。'),
        subtle: true,
      },
    ],
    link: link(deps, '/me/notify', l('Cài đặt thông báo', '通知の設定')),
  });
}

/** One saved update, for one person; `reasons` are the events this person gets it for (most important first). */
export function updateMessage(
  deps: NotifyDeps,
  project: Project,
  update: Update,
  before: ProjectView,
  after: ProjectView,
  reasons: PersonalEvent[],
  name: (id?: string) => string,
): Message {
  const p = `${project.id} · ${project.name}`;
  const changed = `${HEALTH(before.health)} → ${HEALTH(after.health)}`;
  const title = {
    watched_red: l(`■ ${p} chuyển sang ĐỎ`, `■ ${p} が「赤」になりました`),
    health_changed: l(`${p}: đổi trạng thái ${changed}`, `${p}: 状態が変わりました ${changed}`),
    need_help: l(`🙋 ${p} cần hỗ trợ`, `🙋 ${p} が支援を求めています`),
  } as Partial<Record<PersonalEvent, string>>;
  return message({
    title: title[reasons[0]] ?? p,
    tone: after.health === 'red' ? 'attention' : reasons[0] === 'need_help' ? 'warning' : 'default',
    lines: [
      ...(reasons[0] !== 'health_changed' && before.health !== after.health ? [{ text: changed }] : []),
      { text: `${name(update.author)}: ${clip(update.summary, 400)}` },
      ...(update.needHelp ? [{ text: `🙋 ${l('Cần hỗ trợ', '支援依頼')}: ${clip(update.needHelp, 300)}`, tone: 'warning' as const }] : []),
      { text: `GL ${name(project.gl)} · PL ${name(project.pl)}`, subtle: true },
    ],
    link: openProject(deps, project.id),
  });
}

/** One saved item, for one person (assigned to them and / or a new high issue on a watched project). */
export function itemMessage(
  deps: NotifyDeps,
  project: Project,
  item: Item,
  reasons: PersonalEvent[],
  actor: string,
  name: (id?: string) => string,
): Message {
  const p = `${project.id} · ${project.name}`;
  const title =
    reasons[0] === 'assigned_to_me'
      ? l(`👤 Bạn được giao phụ trách – ${p}`, `👤 担当に設定されました – ${p}`)
      : l(`▲ Vấn đề ưu tiên cao mới – ${p}`, `▲ 優先度「高」の新しい課題 – ${p}`);
  return message({
    title,
    tone: reasons[0] === 'assigned_to_me' ? 'default' : 'warning',
    lines: [
      { text: `${TYPE(item.type)} ${l(`"${item.title}"`, `「${item.title}」`)}` },
      {
        text: l(
          `Hạn ${dm(item.date)} · phụ trách ${name(item.owner)} · cập nhật bởi ${name(actor)}`,
          `期限 ${dm(item.date)} · 担当 ${name(item.owner)} · 更新者 ${name(actor)}`,
        ),
        subtle: true,
      },
      ...(item.note ? [{ text: clip(item.note, 300), subtle: true }] : []),
    ],
    link: openProject(deps, project.id),
  });
}

// ---------- Hourly lines ----------

export const dueSoonLine = (v: ProjectView, now: Date): MessageLine => {
  const left = hours(Math.max(1, (Date.parse(v.dueAt) - now.getTime()) / 3_600_000));
  return {
    text: l(`🕑 ${v.id} · ${v.name}: còn ${left} đến hạn cập nhật`, `🕑 ${v.id} · ${v.name}: 報告期限まであと ${left}`),
  };
};

export const lateLine = (v: ProjectView): MessageLine => ({
  text: l(
    `⏰ ${v.id} · ${v.name}: trễ cập nhật ${hours(v.lateHours)}`,
    `⏰ ${v.id} · ${v.name}: 報告が ${hours(v.lateHours)} 遅れています`,
  ),
  tone: 'attention',
});

export const escalationLine = (v: ProjectView, times: number, name: (id?: string) => string): MessageLine => ({
  text: l(
    `🚨 ${v.id} · ${v.name}: trễ cập nhật ${hours(v.lateHours)} (≥ ${times} lần chu kỳ ${hours(v.frequencyHours)}) — PL ${name(v.pl)}`,
    `🚨 ${v.id} · ${v.name}: 報告が ${hours(v.lateHours)} 遅れています（周期 ${hours(v.frequencyHours)} の ${times} 倍以上）— PL ${name(v.pl)}`,
  ),
  tone: 'attention',
});

export const itemDueLine = (v: ProjectView, i: ItemView): MessageLine =>
  i.overdue
    ? {
        text: l(
          `⚠ ${v.id}: ${TYPE(i.type)} "${i.title}" quá hạn ${-i.daysLeft} ngày`,
          `⚠ ${v.id}: ${TYPE(i.type)}「${i.title}」期限を ${-i.daysLeft} 日超過`,
        ),
        tone: 'attention',
      }
    : {
        text: l(
          `📅 Ngày mai ${dm(i.date)} – ${v.id}: ${TYPE(i.type)} "${i.title}"`,
          `📅 明日 ${dm(i.date)} – ${v.id}: ${TYPE(i.type)}「${i.title}」`,
        ),
      };

/** A person's hourly reminders, batched into one message. */
export function remindersMessage(deps: NotifyDeps, lines: MessageLine[]): Message {
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES)
    shown.push({ text: l(`… và ${lines.length - MAX_LINES} mục khác`, `… ほか ${lines.length - MAX_LINES} 件`), subtle: true });
  return message({
    title: `🔔 ${l('Nhắc việc của bạn', 'あなたへのリマインダー')} (${lines.length})`,
    tone: lines.some((x) => x.tone === 'attention') ? 'attention' : 'warning',
    lines: shown,
    link: link(deps, '/', l('Mở tổng quan', 'ダッシュボードを開く')),
  });
}
