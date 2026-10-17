import type { AiConfig, AuditEntry, Channel, Item, Project, Settings, TelegramBot, Update, User } from '../types.js';

export interface Snapshot {
  users: User[];
  projects: Project[];
  updates: Update[];
  items: Item[];
  settings: Settings;
}

export class ConflictError extends Error {}

export const AUDIT_DAYS = 400;

/** Sort key of an audit entry, used as the paging cursor. */
export const auditCursor = (e: Pick<AuditEntry, 'at' | 'id'>) => `${e.at}#${e.id}`;

/**
 * Persistence boundary. Data volume is small (tens of projects, thousands of rows),
 * so dashboards simply load everything with `snapshot()`.
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

  /** Adds or replaces (same id and time) an update. */
  putUpdate(update: Update): Promise<void>;
  /** Soft-deleted updates are left out unless `includeDeleted`. */
  listUpdates(projectId: string, opts?: ListOptions): Promise<Update[]>;

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

  /** Atomically increments and returns a named counter (project / item ids). */
  nextSeq(name: 'project' | 'item' | 'channel'): Promise<number>;

  /** Live data only, unless `includeDeleted` (the trash). */
  snapshot(opts?: ListOptions): Promise<Snapshot>;
}

export interface ListOptions {
  includeDeleted?: boolean;
}

const live = (r: { deletedAt?: string }) => !r.deletedAt;

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
