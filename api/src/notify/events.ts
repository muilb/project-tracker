// What happened: immediate events emitted by the routes, and the hourly scan of the data.
import type { ProjectView } from '../rules.js';
import { l } from '../i18n.js';
import { vnDate } from '../time.js';
import type { Channel, Item, Project, Update } from '../types.js';
import type { MessageLine } from './message.js';
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
