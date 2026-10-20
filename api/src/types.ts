import type { Lang } from './i18n.js';
import type { Message, MessageLine } from './notify/message.js';

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

export const COMMENT_TARGETS = ['update', 'item'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

/**
 * A reply under an update or an item. It never changes the colour and does not count as an update.
 * Mentions are written into the text as `@{<user id>}` (shown as @Name).
 */
export interface Comment {
  id: string; // time-ordered (see comments.ts)
  projectId: string;
  target: CommentTarget;
  targetId: string; // the update's or the item's id
  updateAt?: string; // an update's time: with targetId, its sort key
  at: string; // ISO
  author: string; // user id
  authorRole: Role;
  text: string;
  mentions: string[]; // user ids, from the text
  editedAt?: string;
  deletedAt?: string; // soft delete
  deletedBy?: string;
}

/** One project at the end of a Vietnam day (the last hourly check of that day), for the trend views. */
export interface HealthMark {
  state: ProjectState; // active or paused (closed projects are no longer recorded)
  health: Health;
  declaredHealth?: Health;
  pmoHealth?: Health;
  overdueItems: number;
  lateHours: number;
}

/** The projects that were running or paused on one Vietnam day; written by the hourly job (`trend.ts`). */
export interface HealthDay {
  date: string; // YYYY-MM-DD, Vietnam time
  at: string; // ISO time of the check that wrote it
  projects: Record<string, HealthMark>;
}

export interface Settings {
  frequencyHours: Record<Health, number>; // required update frequency by health
  soonDays: number; // "upcoming" threshold
  nearEventFrequencyHours: number; // frequency when an event/milestone is within soonDays
  upcomingDays: number; // window for "this week" lists on dashboards
  /** compact = every group channel gets compact messages, whatever its own setting. */
  maxChannelDetail?: ChannelDetail;
}

export const DEFAULT_SETTINGS: Settings = {
  frequencyHours: { green: 168, yellow: 72, red: 24 },
  soonDays: 3,
  nearEventFrequencyHours: 24,
  upcomingDays: 7,
};

// --- Notifications (group channels and personal) ---

export const ALERT_EVENTS = ['became_red', 'high_issue', 'overdue', 'late_update', 'milestone_soon', 'daily_digest'] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

export const SCOPE_TYPES = ['all', 'gl', 'projects'] as const;
export interface ChannelScope {
  type: (typeof SCOPE_TYPES)[number];
  gl?: string; // GL user id when type = gl
  projects?: string[]; // project ids when type = projects
}

export const CHANNEL_KINDS = ['teams', 'telegram', 'slack'] as const;
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
  /** compact = no user-entered text (summaries, needHelp, item titles), only codes, states, dates and links. */
  detail?: ChannelDetail;
  /** Replaces quietHours when set. */
  schedule?: ChannelSchedule;
  /** No messages until this time (ISO). */
  pausedUntil?: string;
  /** Consecutive failed deliveries (reset on success). */
  failCount?: number;
  /** Set when the channel was disabled after too many failures. */
  autoPausedAt?: string;
}

export const CHANNEL_DETAILS = ['full', 'compact'] as const;
export type ChannelDetail = (typeof CHANNEL_DETAILS)[number];

export const DIGEST_DAYS = ['daily', 'weekdays', 'monday'] as const;

/** When a channel (or a person) receives messages; every field falls back to today's behaviour. */
export interface ChannelSchedule {
  /** Quiet hours in Vietnam time, may wrap midnight (22 → 7). Equal values = no quiet hours. */
  quietFrom?: number;
  quietTo?: number;
  /** No hourly alerts or digest on Saturday / Sunday. */
  skipWeekends?: boolean;
  /** Vietnam hour of the digest (default 8). */
  digestHour?: number;
  digestDays?: (typeof DIGEST_DAYS)[number];
  /** Days before an event / milestone to remind (default [1]). */
  milestoneLeadDays?: number[];
}

/** Messages addressed to one person (inbox, personal Telegram), chosen in "My notifications". */
export const PERSONAL_EVENTS = [
  'update_due_soon', // my project's update is due within a few hours
  'late_update_mine', // my project's update is late
  'escalation', // a project in my group / PMO scope has been late for long
  'assigned_to_me', // I became the owner of an item
  'my_item_due', // an item I own is due tomorrow or overdue
  'need_help', // an update asks for help on a project I lead / manage
  'health_changed', // the aggregated health of my / a watched project changed
  'watched_red', // a watched project turned red
  'watched_high_issue', // a new high-priority issue on a watched project
  'mentioned', // someone wrote @me in a comment
  'comment_reply', // a new comment under my update / item, or in a thread I wrote in
] as const;
/** Events added after people could save their settings, by the `eventsVersion` that brought them (switched on once). */
export const ADDED_EVENTS: { version: number; events: PersonalEvent[] }[] = [{ version: 2, events: ['mentioned', 'comment_reply'] }];
export const EVENTS_VERSION = 2;
export type PersonalEvent = (typeof PERSONAL_EVENTS)[number];

export interface NotifyPrefs {
  userId: string;
  events: PersonalEvent[];
  /** The ADDED_EVENTS this person has seen (absent = 1): newer ones are switched on when read. */
  eventsVersion?: number;
  /** Also send to the linked personal Telegram chat (the inbox always receives). */
  telegram: boolean;
  telegramChatId?: string;
  telegramChatTitle?: string;
  /** Extra projects to follow (⭐ on the project page). */
  watch: string[];
  schedule?: ChannelSchedule;
  pausedUntil?: string;
  lang?: Lang;
  updatedAt: string;
  // track G
  /** Why the personal Telegram link stopped working (the person blocked the bot…); cleared by linking again. */
  telegramBroken?: string;
  // track H: Web Push.
  /** Also send to this person's browsers / phones (Web Push); absent = off. */
  push?: boolean;
}

/** One message in a person's web inbox (🔔). */
export interface InboxEntry {
  userId: string;
  id: string;
  at: string; // ISO
  event: string; // PersonalEvent or a system notice
  title: string;
  lines: MessageLine[];
  link?: Message['link'];
  projectId?: string;
  readAt?: string;
}

/** Where an outbox message goes: a group channel, or one person's inbox / Telegram. */
export type OutboxTarget =
  | { channelId: string }
  | { userId: string; via: 'inbox' | 'telegram' }
  // track H: one browser / phone of the person (all of them when subscriptionId is absent).
  | { userId: string; via: 'push'; subscriptionId?: string };

/** A message waiting to be delivered (delayed, grouped or retried). */
export interface OutboxEntry {
  id: string;
  dueAt: string; // ISO
  createdAt: string;
  target: OutboxTarget;
  event: string;
  message: Message;
  projectId?: string;
  /** De-duplication keys recorded (markSent) once the message is delivered. */
  sentKeys?: { key: string; ttlDays: number }[];
  attempts: number;
  lastError?: string;
}

/** One delivery attempt to a group channel (shown on the channels page). */
export interface DeliveryLog {
  channelId: string;
  id: string;
  at: string; // ISO
  ok: boolean;
  event: string;
  title: string;
  error?: string;
}

/** The single Telegram bot used for all Telegram channels (token is a secret). */
export interface TelegramBot {
  token: string;
  username: string;
  // track G: two-way bot. Without webhookSecret (bots saved before) connect codes are read with getUpdates.
  /** Secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token (never returned by the API). */
  webhookSecret?: string;
  /** Where setWebhook pointed the bot. */
  webhookUrl?: string;
  /** Why setWebhook failed (the bot then keeps working one way, with getUpdates). */
  webhookError?: string;
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
  'channel_create',
  'channel_update',
  'channel_delete',
  'channel_transfer',
  'channel_auto_pause',
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

// track H: Web Push.

/** VAPID key pair of the app (CONFIG/PUSH); the private key is a secret, never returned by the API. */
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  createdAt: string;
}

/** One browser / phone of a person that receives Web Push (endpoint and keys are secrets). */
export interface PushSubscriptionRecord {
  userId: string;
  /** Derived from the endpoint, so subscribing the same browser again replaces the row. */
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** e.g. "Chrome · Windows". */
  label: string;
  createdAt: string;
  lastSentAt?: string;
  lastError?: string;
}
