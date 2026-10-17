import {
  DEFAULT_SETTINGS,
  type AiConfig,
  type AuditEntry,
  type Channel,
  type Item,
  type Project,
  type Settings,
  type TelegramBot,
  type Update,
  type User,
} from '../types.js';
import { ConflictError, liveRows, liveSnapshot, type ListOptions, type Snapshot, type Store } from './store.js';

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
  async listAudit(limit: number) {
    return [...this.audit]
      .reverse() // same timestamp: newest written first
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map(clone);
  }

  async nextSeq(name: 'project' | 'item' | 'channel') {
    return ++this.seqs[name];
  }

  async snapshot(opts?: ListOptions): Promise<Snapshot> {
    const snap = clone({
      users: [...this.users.values()],
      projects: [...this.projects.values()],
      updates: this.updates,
      items: [...this.items.values()],
      settings: this.settings,
    });
    return opts?.includeDeleted ? snap : liveSnapshot(snap);
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}
