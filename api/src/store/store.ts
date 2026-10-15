import type { Item, Project, Settings, Update, User } from '../types.js';

export interface Snapshot {
  users: User[];
  projects: Project[];
  updates: Update[];
  items: Item[];
  settings: Settings;
}

export class ConflictError extends Error {}

/**
 * Persistence boundary. Data volume is small (tens of projects, thousands of rows),
 * so dashboards simply load everything with `snapshot()`.
 */
export interface Store {
  getUser(id: string): Promise<User | undefined>;
  putUser(user: User): Promise<void>;
  listUsers(): Promise<User[]>;

  getProject(id: string): Promise<Project | undefined>;
  /** Throws ConflictError when the id already exists. */
  createProject(project: Project): Promise<void>;
  putProject(project: Project): Promise<void>;

  addUpdate(update: Update): Promise<void>;
  listUpdates(projectId: string): Promise<Update[]>;

  getItem(projectId: string, id: string): Promise<Item | undefined>;
  putItem(item: Item): Promise<void>;
  listItems(projectId: string): Promise<Item[]>;

  getSettings(): Promise<Settings>;
  putSettings(settings: Settings): Promise<void>;

  /** Atomically increments and returns a named counter (project / item ids). */
  nextSeq(name: 'project' | 'item'): Promise<number>;

  snapshot(): Promise<Snapshot>;
}
