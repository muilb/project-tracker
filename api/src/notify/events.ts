// What happened: immediate events emitted by the routes, and the hourly scan of the data.
import type { ProjectView } from '../rules.js';
import { l } from '../i18n.js';
import { vnDate } from '../time.js';
import type { Channel, Item, PersonalEvent, Project, Update } from '../types.js';
import type { MessageLine } from './message.js';
import { dueSoonLine, escalationLine, itemDueLine, lateLine } from './personal.js';
import { dm, hours, TYPE } from './render.js';

/** Emitted by the routes after a change is saved (see pipeline.emit). */
export type NotifyEvent =
  | {
      type: 'update_posted';
      project: Project;
      update: Update;
      /** Aggregated view before / after the update. */
      before: ProjectView;
      after: ProjectView;
      actor: string;
    }
  | {
      type: 'item_saved';
      project: Project;
      item: Item;
      /** Missing for a new item. */
      previous?: Item;
      actor: string;
    };

// ---------- Hourly scan (track D owns the time-based rules) ----------

export interface Pending {
  key: string;
  line: MessageLine;
}

export function collectAlerts(ch: Channel, views: ProjectView[], now: Date, name: (id?: string) => string): Pending[] {
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
          compact: l(`⏰ ${v.id} · ${v.name}: trễ cập nhật ${hours(v.lateHours)}`, `⏰ ${v.id} · ${v.name}: 報告が ${hours(v.lateHours)} 遅れています`),
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
            compact: l(`⚠ ${v.id}: ${TYPE(i.type)} quá hạn ${-i.daysLeft} ngày`, `⚠ ${v.id}: ${TYPE(i.type)} 期限を ${-i.daysLeft} 日超過`),
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
            compact: l(`📅 Ngày mai ${dm(i.date)} – ${v.id}: ${TYPE(i.type)}`, `📅 明日 ${dm(i.date)} – ${v.id}: ${TYPE(i.type)}`),
          },
        });
      }
    }
  }
  return out;
}

// track A: personal time-based events (update due soon, my item due, escalation).

/** Hours before the update deadline when the PL gets "update due soon". */
export const DUE_SOON_HOURS = 4;

/** One personal reminder found by the hourly scan; `line` is built in the recipient's language. */
export interface PersonalPending {
  userId: string;
  event: PersonalEvent;
  project: ProjectView;
  /** De-duplication key (without the `P#<userId>#` prefix). */
  key: string;
  line: () => MessageLine;
}

/** Personal time-based events: update due soon / late (PL), escalation (GL, PMO), my items due (owner). */
export function collectPersonal(views: ProjectView[], now: Date, name: (id?: string) => string): PersonalPending[] {
  const out: PersonalPending[] = [];
  const today = vnDate(now);
  for (const v of views) {
    const lead = v.pl ?? v.gl;
    const leftHours = (Date.parse(v.dueAt) - now.getTime()) / 3_600_000;
    if (lead && v.lateHours === 0 && leftHours > 0 && leftHours <= DUE_SOON_HOURS)
      out.push({
        userId: lead,
        event: 'update_due_soon',
        project: v,
        key: `update_due_soon#${v.id}#${v.dueAt}`,
        line: () => dueSoonLine(v, now),
      });
    if (lead && v.lateHours > 0)
      // Repeated every 24h while it stays late.
      out.push({
        userId: lead,
        event: 'late_update_mine',
        project: v,
        key: `late_update_mine#${v.id}#${v.dueAt}#${Math.floor(v.lateHours / 24)}`,
        line: () => lateLine(v),
      });
    const times = v.lateHours >= 4 * v.frequencyHours ? 4 : v.lateHours >= 2 * v.frequencyHours ? 2 : 0;
    if (times && v.gl)
      out.push({
        userId: v.gl,
        event: 'escalation',
        project: v,
        key: `escalation#${v.id}#${v.dueAt}#2`,
        line: () => escalationLine(v, 2, name),
      });
    if (times === 4 && v.pmo)
      out.push({
        userId: v.pmo,
        event: 'escalation',
        project: v,
        key: `escalation#${v.id}#${v.dueAt}#4`,
        line: () => escalationLine(v, 4, name),
      });
    for (const i of v.openItems) {
      if (!i.owner || i.closed || !(i.overdue || i.daysLeft === 1)) continue;
      out.push({ userId: i.owner, event: 'my_item_due', project: v, key: `my_item_due#${i.id}#${today}`, line: () => itemDueLine(v, i) });
    }
  }
  return out;
}
