import {
  DEFAULT_SETTINGS,
  type AiConfig,
  type AuditEntry,
  type Channel,
  type Comment,
  type DeliveryLog,
  type HealthDay,
  type InboxEntry,
  type Item,
  type NotifyPrefs,
  type OutboxEntry,
  type Project,
  type PushConfig,
  type PushSubscriptionRecord,
  type Settings,
  type TelegramBot,
  type Update,
  type User,
} from '../types.js';
import { newestUpdateFirst, pinUpdates } from '../rules.js';
import {
  auditCursor,
  ConflictError,
  inboxCursor,
  keepItem,
  liveRows,
  liveSnapshot,
  outboxKey,
  snapshotSince,
  uniqueUpdates,
  updateCursor,
  type ListOptions,
  type Snapshot,
  type SnapshotOptions,
  type Store,
} from './store.js';

/** In-memory store for tests and local development. */
export class MemoryStore implements Store {
  users = new Map<string, User>();
  projects = new Map<string, Project>();
  updates: Update[] = [];
  items = new Map<string, Item>();
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  channels = new Map<string, Channel>();
  sent = new Map<string, number>(); // key -> expiry (ms)
  telegramBot?: TelegramBot;
  aiConfig?: AiConfig;
  seqs = { project: 0, item: 0, channel: 0 };
  audit: AuditEntry[] = [];
  notifyPrefs = new Map<string, NotifyPrefs>();
  inbox: InboxEntry[] = [];
  outbox = new Map<string, OutboxEntry>();
  deliveries: DeliveryLog[] = [];
  temp = new Map<string, { value: unknown; expires: number }>(); // track G
  pushConfig?: PushConfig;
  pushSubs = new Map<string, PushSubscriptionRecord>(); // `${userId}#${id}`
  healthDays = new Map<string, HealthDay>(); // by date
  comments = new Map<string, Comment>(); // `${projectId}#${id}`

  async getUser(id: string) {
    return clone(this.users.get(id));
  }
  async putUser(user: User) {
    this.users.set(user.id, clone(user));
  }
  async listUsers() {
    return [...this.users.values()].map(clone);
  }

  async getProject(id: string) {
    return clone(this.projects.get(id));
  }
  async createProject(project: Project) {
    if (this.projects.has(project.id)) throw new ConflictError(`Project ${project.id} already exists`);
    this.projects.set(project.id, clone(project));
  }
  async putProject(project: Project) {
    this.projects.set(project.id, clone(project));
  }

  async putUpdate(update: Update) {
    const i = this.updates.findIndex((u) => u.id === update.id && u.projectId === update.projectId);
    if (i >= 0) this.updates[i] = clone(update);
    else this.updates.push(clone(update));
  }
  async listUpdates(projectId: string, opts?: ListOptions) {
    return liveRows(this.updates.filter((u) => u.projectId === projectId).map(clone), opts);
  }
  async pageUpdates(projectId: string, limit: number, before?: string) {
    return liveRows(this.updates.filter((u) => u.projectId === projectId))
      .sort(newestUpdateFirst)
      .filter((u) => !before || updateCursor(u) < before)
      .slice(0, limit)
      .map(clone);
  }
  async listPinnedUpdates(projectId: string) {
    return pinUpdates(this.updates.filter((u) => u.projectId === projectId)).map(clone);
  }
  async listDeletedUpdates() {
    return this.updates.filter((u) => u.deletedAt).map(clone);
  }

  async getUpdate(projectId: string, at: string, id: string) {
    return clone(this.updates.find((u) => u.projectId === projectId && u.at === at && u.id === id));
  }

  async getItem(projectId: string, id: string) {
    const item = this.items.get(id);
    return item?.projectId === projectId ? clone(item) : undefined;
  }
  async putItem(item: Item) {
    this.items.set(item.id, clone(item));
  }
  async listItems(projectId: string, opts?: ListOptions) {
    return liveRows([...this.items.values()].filter((i) => i.projectId === projectId).map(clone), opts);
  }

  async getSettings() {
    return clone(this.settings);
  }
  async putSettings(settings: Settings) {
    this.settings = clone(settings);
  }

  async listChannels() {
    return [...this.channels.values()].map(clone);
  }
  async getChannel(id: string) {
    return clone(this.channels.get(id));
  }
  async putChannel(channel: Channel) {
    this.channels.set(channel.id, clone(channel));
  }
  async deleteChannel(id: string) {
    this.channels.delete(id);
  }

  async getTelegramBot() {
    return clone(this.telegramBot);
  }
  async putTelegramBot(bot: TelegramBot | undefined) {
    this.telegramBot = clone(bot);
  }
  async getAiConfig() {
    return clone(this.aiConfig);
  }
  async putAiConfig(config: AiConfig | undefined) {
    this.aiConfig = clone(config);
  }

  async hasSent(key: string) {
    return (this.sent.get(key) ?? 0) > Date.now();
  }
  async markSent(key: string, ttlDays: number) {
    this.sent.set(key, Date.now() + ttlDays * 86_400_000);
  }

  async addAudit(entry: AuditEntry) {
    this.audit.push(clone(entry));
  }
  async listAudit(limit: number, before?: string) {
    return [...this.audit]
      .reverse() // same timestamp: newest written first
      .sort((a, b) => b.at.localeCompare(a.at))
      .filter((e) => !before || auditCursor(e) < before)
      .slice(0, limit)
      .map(clone);
  }

  async getNotifyPrefs(userId: string) {
    return clone(this.notifyPrefs.get(userId));
  }
  async putNotifyPrefs(prefs: NotifyPrefs) {
    this.notifyPrefs.set(prefs.userId, clone(prefs));
  }
  async listNotifyPrefs() {
    return [...this.notifyPrefs.values()].map(clone);
  }

  async addInbox(entry: InboxEntry) {
    this.inbox.push(clone(entry));
  }
  async listInbox(userId: string, limit: number, before?: string) {
    return this.inbox
      .filter((e) => e.userId === userId && (!before || inboxCursor(e) < before))
      .sort((a, b) => inboxCursor(b).localeCompare(inboxCursor(a)))
      .slice(0, limit)
      .map(clone);
  }
  async markInboxRead(userId: string, ids: string[] | 'all', at: string) {
    for (const e of this.inbox)
      if (e.userId === userId && !e.readAt && (ids === 'all' || ids.includes(e.id))) e.readAt = at;
  }
  async countUnread(userId: string) {
    return this.inbox.filter((e) => e.userId === userId && !e.readAt).length;
  }

  async enqueue(entry: OutboxEntry) {
    this.outbox.set(entry.id, clone(entry));
  }
  async listDue(now: Date, limit: number) {
    return [...this.outbox.values()]
      .filter((e) => Date.parse(e.dueAt) <= now.getTime())
      .sort((a, b) => outboxKey(a).localeCompare(outboxKey(b)))
      .slice(0, limit)
      .map(clone);
  }
  async claimOutbox(entry: OutboxEntry) {
    return this.outbox.delete(entry.id);
  }

  async addDeliveryLog(entry: DeliveryLog) {
    this.deliveries.push(clone(entry));
  }
  async listDeliveryLog(channelId: string, limit: number) {
    return this.deliveries
      .filter((e) => e.channelId === channelId)
      .reverse() // same timestamp: newest written first
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map(clone);
  }

  async nextSeq(name: 'project' | 'item' | 'channel') {
    return ++this.seqs[name];
  }

  // track G
  async getTemp<T>(key: string) {
    const row = this.temp.get(key);
    return row && row.expires > Date.now() ? (clone(row.value) as T) : undefined;
  }
  async putTemp(key: string, value: unknown, ttlSeconds: number) {
    this.temp.set(key, { value: clone(value), expires: Date.now() + ttlSeconds * 1000 });
  }
  async takeTemp<T>(key: string) {
    const value = await this.getTemp<T>(key);
    this.temp.delete(key);
    return value;
  }
  async bumpCounter(key: string, ttlSeconds: number) {
    const row = this.temp.get(key);
    const live = row && row.expires > Date.now();
    const count = (live ? (row.value as number) : 0) + 1;
    this.temp.set(key, { value: count, expires: live ? row.expires : Date.now() + ttlSeconds * 1000 });
    return count;
  }

  async getComment(projectId: string, id: string) {
    return clone(this.comments.get(`${projectId}#${id}`));
  }
  async putComment(comment: Comment) {
    this.comments.set(`${comment.projectId}#${comment.id}`, clone(comment));
  }
  async listComments(projectId: string) {
    return [...this.comments.values()]
      .filter((c) => c.projectId === projectId && !c.deletedAt)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(clone);
  }
  async listDeletedComments() {
    return [...this.comments.values()].filter((c) => c.deletedAt).map(clone);
  }

  async putHealthDay(day: HealthDay) {
    this.healthDays.set(day.date, clone(day));
  }
  async listHealthDays(from: string, to: string) {
    return [...this.healthDays.values()]
      .filter((d) => d.date >= from && d.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(clone);
  }

  async snapshot(opts?: SnapshotOptions): Promise<Snapshot> {
    // Same updates as DynamoStore: recent ones plus the pinned ones (worked out here on the fly).
    const since = opts?.now && snapshotSince(opts.now);
    const updates = since
      ? uniqueUpdates([
          ...this.updates.filter((u) => u.at >= since),
          ...[...this.projects.keys()].flatMap((id) => pinUpdates(this.updates.filter((u) => u.projectId === id))),
        ])
      : this.updates;
    const snap = clone({
      users: [...this.users.values()],
      projects: [...this.projects.values()],
      updates,
      items: since ? [...this.items.values()].filter((i) => keepItem(i, since, opts?.includeDeleted)) : [...this.items.values()],
      settings: this.settings,
    });
    return opts?.includeDeleted ? snap : liveSnapshot(snap);
  }

  // track H: Web Push.
  async getPushConfig() {
    return clone(this.pushConfig);
  }
  async initPushConfig(config: PushConfig) {
    this.pushConfig ??= clone(config);
    return clone(this.pushConfig);
  }
  async putPushSubscription(sub: PushSubscriptionRecord) {
    this.pushSubs.set(`${sub.userId}#${sub.id}`, clone(sub));
  }
  async getPushSubscription(userId: string, id: string) {
    return clone(this.pushSubs.get(`${userId}#${id}`));
  }
  async listPushSubscriptions(userId: string) {
    return [...this.pushSubs.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
  async deletePushSubscription(userId: string, id: string) {
    this.pushSubs.delete(`${userId}#${id}`);
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}
