import { DEFAULT_SETTINGS, type Item, type Project, type Settings, type Update, type User } from '../types.js';
import { ConflictError, type Snapshot, type Store } from './store.js';

/** In-memory store for tests and local development. */
export class MemoryStore implements Store {
  users = new Map<string, User>();
  projects = new Map<string, Project>();
  updates: Update[] = [];
  items = new Map<string, Item>();
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  seqs = { project: 0, item: 0 };

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

  async addUpdate(update: Update) {
    this.updates.push(clone(update));
  }
  async listUpdates(projectId: string) {
    return this.updates.filter((u) => u.projectId === projectId).map(clone);
  }

  async getItem(projectId: string, id: string) {
    const item = this.items.get(id);
    return item?.projectId === projectId ? clone(item) : undefined;
  }
  async putItem(item: Item) {
    this.items.set(item.id, clone(item));
  }
  async listItems(projectId: string) {
    return [...this.items.values()].filter((i) => i.projectId === projectId).map(clone);
  }

  async getSettings() {
    return clone(this.settings);
  }
  async putSettings(settings: Settings) {
    this.settings = clone(settings);
  }

  async nextSeq(name: 'project' | 'item') {
    return ++this.seqs[name];
  }

  async snapshot(): Promise<Snapshot> {
    return clone({
      users: [...this.users.values()],
      projects: [...this.projects.values()],
      updates: this.updates,
      items: [...this.items.values()],
      settings: this.settings,
    });
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}
