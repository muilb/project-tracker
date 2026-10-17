// Personal notification settings: defaults by role (track A refines who receives what).
import type { NotifyPrefs, PersonalEvent, User } from '../types.js';

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
