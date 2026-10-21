import type {
  AiConfig,
  AuditEntry,
  Channel,
  Comment,
  DeliveryLog,
  HealthDay,
  InboxEntry,
  Item,
  NotifyPrefs,
  OutboxEntry,
  Project,
  PushConfig,
  PushSubscriptionRecord,
  Settings,
  TelegramBot,
  Update,
  User,
} from '../types.js';

export interface Snapshot {
  users: User[];
  projects: Project[];
  /**
   * With `now`: the updates of the last SNAPSHOT_UPDATE_DAYS plus each project's pinned updates
   * (`pinUpdates`), which is all `buildProjectView` needs. Without `now`: every update.
   */
  updates: Update[];
  /**
   * With `now`: open items and the closed ones changed in the last SNAPSHOT_UPDATE_DAYS (`keepItem`);
   * a project page reads all of its own items (`listItems`). Without `now`: every item.
   */
  items: Item[];
  settings: Settings;
}

export class ConflictError extends Error {}

export const AUDIT_DAYS = 400;
export const INBOX_DAYS = 60;
export const OUTBOX_DAYS = 7;
export const DELIVERY_LOG_DAYS = 30;
/** Days of update history the snapshot carries (the AI questions look this far back). */
export const SNAPSHOT_UPDATE_DAYS = 60;

/** Sort key of an audit entry, used as the paging cursor. */
export const auditCursor = (e: Pick<AuditEntry, 'at' | 'id'>) => `${e.at}#${e.id}`;
/** Sort key of an inbox entry, used as the paging cursor. */
export const inboxCursor = (e: Pick<InboxEntry, 'at' | 'id'>) => `${e.at}#${e.id}`;
/** Sort key of an update within its project, used as the paging cursor. */
export const updateCursor = (u: Pick<Update, 'at' | 'id'>) => `${u.at}#${u.id}`;
/** Sort key of an outbox entry (due time first). */
export const outboxKey = (e: Pick<OutboxEntry, 'dueAt' | 'id'>) => `${e.dueAt}#${e.id}`;

/**
 * Persistence boundary. Data volume is small (tens of projects, thousands of rows), so dashboards
 * load users, projects and items with `snapshot()`; what grows for ever is limited: recent updates
 * plus the pinned ones (see `pinUpdates`), open items plus recently closed ones (see `keepItem`).
 */
export interface Store {
  getUser(id: string): Promise<User | undefined>;
  putUser(user: User): Promise<void>;
  listUsers(): Promise<User[]>;

  /** Returns soft-deleted projects too (callers check `deletedAt`). */
  getProject(id: string): Promise<Project | undefined>;
  /** Throws ConflictError when the id already exists. */
  createProject(project: Project): Promise<void>;
  putProject(project: Project): Promise<void>;

  /** Adds or replaces (same id and time) an update, and keeps the project's pinned updates current. */
  putUpdate(update: Update): Promise<void>;
  /** The whole history; soft-deleted updates are left out unless `includeDeleted`. */
  listUpdates(projectId: string, opts?: ListOptions): Promise<Update[]>;
  /** Live updates, newest first, older than the `before` cursor (`updateCursor`). */
  pageUpdates(projectId: string, limit: number, before?: string): Promise<Update[]>;
  /** The project's pinned updates (`pinUpdates` of its live history): enough for `buildProjectView`. */
  listPinnedUpdates(projectId: string): Promise<Update[]>;
  /** Soft-deleted updates of every project (the trash). */
  listDeletedUpdates(): Promise<Update[]>;

  /** One update by its time and id (the sort key); soft-deleted ones too. */
  getUpdate(projectId: string, at: string, id: string): Promise<Update | undefined>;

  /** Returns soft-deleted items too (callers check `deletedAt`). */
  getItem(projectId: string, id: string): Promise<Item | undefined>;
  putItem(item: Item): Promise<void>;
  listItems(projectId: string, opts?: ListOptions): Promise<Item[]>;

  getSettings(): Promise<Settings>;
  putSettings(settings: Settings): Promise<void>;

  listChannels(): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | undefined>;
  putChannel(channel: Channel): Promise<void>;
  deleteChannel(id: string): Promise<void>;

  /** The system Telegram bot (secret token); undefined removes it. */
  getTelegramBot(): Promise<TelegramBot | undefined>;
  putTelegramBot(bot: TelegramBot | undefined): Promise<void>;

  /** Claude API key (secret); undefined removes it. */
  getAiConfig(): Promise<AiConfig | undefined>;
  putAiConfig(config: AiConfig | undefined): Promise<void>;

  /** Alert de-duplication: whether `key` was recorded by markSent (records expire after `ttlDays`). */
  hasSent(key: string): Promise<boolean>;
  markSent(key: string, ttlDays: number): Promise<void>;

  /** Administrative log (kept AUDIT_DAYS); newest first, older than the `before` cursor (`auditCursor`). */
  addAudit(entry: AuditEntry): Promise<void>;
  listAudit(limit: number, before?: string): Promise<AuditEntry[]>;

  /** Personal notification settings; listNotifyPrefs returns everyone who saved them. */
  getNotifyPrefs(userId: string): Promise<NotifyPrefs | undefined>;
  putNotifyPrefs(prefs: NotifyPrefs): Promise<void>;
  listNotifyPrefs(): Promise<NotifyPrefs[]>;

  /** Web inbox (kept INBOX_DAYS); newest first, older than the `before` cursor (`inboxCursor`). */
  addInbox(entry: InboxEntry): Promise<void>;
  listInbox(userId: string, limit: number, before?: string): Promise<InboxEntry[]>;
  /** Marks the given entries (or all) read at `at`. */
  markInboxRead(userId: string, ids: string[] | 'all', at: string): Promise<void>;
  countUnread(userId: string): Promise<number>;

  /** Messages waiting for delivery (kept OUTBOX_DAYS). */
  enqueue(entry: OutboxEntry): Promise<void>;
  /** Entries with dueAt <= now, oldest first. */
  listDue(now: Date, limit: number): Promise<OutboxEntry[]>;
  /** Removes the entry; false when another run already took it (so it is sent once). */
  claimOutbox(entry: OutboxEntry): Promise<boolean>;

  /** Delivery attempts per group channel (kept DELIVERY_LOG_DAYS); newest first. */
  addDeliveryLog(entry: DeliveryLog): Promise<void>;
  listDeliveryLog(channelId: string, limit: number): Promise<DeliveryLog[]>;

  /** Atomically increments and returns a named counter (project / item ids). */
  nextSeq(name: 'project' | 'item' | 'channel'): Promise<number>;

  // track G: short-lived bot state (connect codes seen by the webhook, pending AI proposals, rate limits).
  /** A value saved with putTemp that has not expired. */
  getTemp<T>(key: string): Promise<T | undefined>;
  putTemp(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Removes and returns the value; only one caller gets it (confirm buttons pressed twice). */
  takeTemp<T>(key: string): Promise<T | undefined>;
  /** Atomically adds 1 and returns the new count; the counter expires `ttlSeconds` after it was created. */
  bumpCounter(key: string, ttlSeconds: number): Promise<number>;

  /** Comments under updates and items (comments.ts). Returns soft-deleted ones too. */
  getComment(projectId: string, id: string): Promise<Comment | undefined>;
  putComment(comment: Comment): Promise<void>;
  /** The project's live comments, oldest first. */
  listComments(projectId: string): Promise<Comment[]>;
  /** Soft-deleted comments of every project (the trash). */
  listDeletedComments(): Promise<Comment[]>;

  /** Adds or replaces the projects' marks of one day (trend.ts). */
  putHealthDay(day: HealthDay): Promise<void>;
  /** The recorded days from `from` to `to` (YYYY-MM-DD, both included), oldest first. */
  listHealthDays(from: string, to: string): Promise<HealthDay[]>;

  /** Live data only, unless `includeDeleted` (the trash). `now` limits the updates (see `Snapshot.updates`). */
  snapshot(opts?: SnapshotOptions): Promise<Snapshot>;

  // track H: Web Push.
  /** VAPID keys (secret private key). */
  getPushConfig(): Promise<PushConfig | undefined>;
  /** Saves `config` unless keys already exist; returns the stored keys (two first requests agree on one pair). */
  initPushConfig(config: PushConfig): Promise<PushConfig>;
  /** Adds or replaces (same user and id) a browser / phone subscription. */
  putPushSubscription(sub: PushSubscriptionRecord): Promise<void>;
  getPushSubscription(userId: string, id: string): Promise<PushSubscriptionRecord | undefined>;
  listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]>;
  deletePushSubscription(userId: string, id: string): Promise<void>;
}

export interface ListOptions {
  includeDeleted?: boolean;
}

export interface SnapshotOptions extends ListOptions {
  now?: Date;
}

/** The first of each update (same project and id). */
export function uniqueUpdates(updates: Update[]): Update[] {
  const seen = new Set<string>();
  return updates.filter((u) => {
    const key = `${u.projectId}#${u.id}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

/** ISO time SNAPSHOT_UPDATE_DAYS before `now`: the oldest update the snapshot keeps besides the pinned ones. */
export const snapshotSince = (now: Date) => new Date(now.getTime() - SNAPSHOT_UPDATE_DAYS * 86_400_000).toISOString();

const live = (r: { deletedAt?: string }) => !r.deletedAt;

/** Done or postponed. */
export const itemClosed = (i: Pick<Item, 'status'>) => i.status === 'done' || i.status === 'postponed';

/**
 * Whether a snapshot taken with `now` (`since` = snapshotSince(now)) carries the item: open ones always,
 * closed ones changed since then (closed in that time, or edited after), deleted ones only for the trash.
 */
export function keepItem(i: Item, since: string, includeDeleted?: boolean): boolean {
  if (i.deletedAt) return !!includeDeleted;
  return !itemClosed(i) || i.updatedAt >= since;
}

/** Drops soft-deleted rows, and everything under a soft-deleted project. */
export function liveSnapshot(snap: Snapshot): Snapshot {
  const projects = snap.projects.filter(live);
  const ids = new Set(projects.map((p) => p.id));
  return {
    ...snap,
    projects,
    updates: snap.updates.filter((u) => live(u) && ids.has(u.projectId)),
    items: snap.items.filter((i) => live(i) && ids.has(i.projectId)),
  };
}

export function liveRows<T extends { deletedAt?: string }>(rows: T[], opts?: ListOptions): T[] {
  return opts?.includeDeleted ? rows : rows.filter(live);
}
