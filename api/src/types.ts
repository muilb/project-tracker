import type { Lang } from './i18n.js';

// Domain types. Codes are English; the web UI maps them to Vietnamese labels.

export const HEALTHS = ['green', 'yellow', 'red'] as const;
export type Health = (typeof HEALTHS)[number];

// PL: project leader, GL: group leader, PMO, SUBMNG/MNG: managers, OTHER: supporter/other staff,
// ADMIN: system administrator (accounts, secrets, everything managers can do).
export const ROLES = ['PL', 'GL', 'PMO', 'SUBMNG', 'MNG', 'OTHER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Login account state in Cognito: none = never signed up, pending = sign-up not confirmed,
 * temp = temporary password not changed yet, active = can sign in with their own password. */
export type AccountStatus = 'none' | 'pending' | 'temp' | 'active';

export const PROJECT_STATES = ['active', 'paused', 'closed'] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export const ITEM_TYPES = ['issue', 'event', 'milestone'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ITEM_STATUSES = ['open', 'in_progress', 'done', 'postponed'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type Urgency = 'critical' | 'attention' | 'normal';

export interface User {
  id: string; // lower-cased email
  name: string;
  role: Role;
  createdAt: string;
}

export interface Project {
  id: string; // e.g. P01
  name: string;
  customer?: string;
  gl?: string; // user id
  pl?: string; // user id
  supporters: string[]; // user ids allowed to update on behalf of PL/GL
  pmo?: string; // user id
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  state: ProjectState;
  updateFrequencyHours?: number | null; // overrides the computed frequency
  publicVisible: boolean;
  publicName?: string; // name shown on the public dashboard
  createdBy: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /** Soft delete: hidden everywhere, PMO can restore it from the trash. */
  deletedAt?: string;
  deletedBy?: string;
}

export interface Update {
  id: string;
  projectId: string;
  at: string; // ISO
  author: string; // user id
  authorRole: Role; // role of the author at write time
  health?: Health;
  summary: string;
  needHelp?: string;
  rawText?: string; // original natural-language text when entered through AI
  deletedAt?: string; // soft delete
  deletedBy?: string;
}

export interface Item {
  id: string; // e.g. I0015
  projectId: string;
  type: ItemType;
  title: string;
  priority: Priority;
  date: string; // YYYY-MM-DD: due date for issues, day of event/milestone
  owner?: string; // user id
  status: ItemStatus;
  note?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string; // soft delete
  deletedBy?: string;
}

export interface Settings {
  frequencyHours: Record<Health, number>; // required update frequency by health
  soonDays: number; // "upcoming" threshold
  nearEventFrequencyHours: number; // frequency when an event/milestone is within soonDays
  upcomingDays: number; // window for "this week" lists on dashboards
}

export const DEFAULT_SETTINGS: Settings = {
  frequencyHours: { green: 168, yellow: 72, red: 24 },
  soonDays: 3,
  nearEventFrequencyHours: 24,
  upcomingDays: 7,
};

// --- Notifications (Teams) ---

export const ALERT_EVENTS = ['became_red', 'high_issue', 'overdue', 'late_update', 'milestone_soon', 'daily_digest'] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

export const SCOPE_TYPES = ['all', 'gl', 'projects'] as const;
export interface ChannelScope {
  type: (typeof SCOPE_TYPES)[number];
  gl?: string; // GL user id when type = gl
  projects?: string[]; // project ids when type = projects
}

export const CHANNEL_KINDS = ['teams', 'telegram'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * Where alerts go: a Teams channel (Workflows "post to channel" webhook) or a
 * Telegram chat/group the system bot was added to.
 */
export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  webhookUrl?: string; // teams; a secret, never returned by the API
  telegramChatId?: string; // telegram
  telegramChatTitle?: string; // telegram, for display
  scope: ChannelScope;
  events: AlertEvent[];
  quietHours: boolean; // no hourly alerts 22:00–07:00 (Vietnam time)
  lang?: Lang; // language of the messages; Vietnamese when missing
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
  lastError?: string;
}

/** The single Telegram bot used for all Telegram channels (token is a secret). */
export interface TelegramBot {
  token: string;
  username: string;
}

export const AUDIT_ACTIONS = [
  'role_change',
  'admin_granted', // ADMIN_EMAILS raised someone to ADMIN at sign-in
  'user_create',
  'account_approve',
  'account_reject',
  'password_reset',
  'ai_key_set',
  'ai_key_remove',
  'telegram_set',
  'telegram_remove',
  'project_delete',
  'restore',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Who did which administrative change, shown to ADMIN in Settings. */
export interface AuditEntry {
  id: string;
  at: string; // ISO
  actor: string; // user id
  action: AuditAction;
  target?: string; // user email, project id, …
  detail?: string; // e.g. "PL → GL"
}

/** Claude API key for the natural-language entry page (a secret, never returned by the API). */
export interface AiConfig {
  apiKey: string;
}
