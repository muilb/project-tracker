import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env.js';
import { audit } from './audit.js';
import { l } from './i18n.js';
import { ROLES, type Item, type Project, type Role, type Update, type User } from './types.js';

export interface AuthConfig {
  /** `jwt`: identity from the API Gateway Cognito authorizer. `dev`: `x-dev-user: <email>` header. */
  mode: 'jwt' | 'dev';
  /**
   * Roles granted on first login, as `email` (PMO) or `email:ROLE`,
   * e.g. ['lan@cty.vn', 'sep@cty.vn:MNG']. Later changes go through PATCH /users.
   */
  adminEmails: string[];
}

/** Parses `email` / `email:ROLE` entries; unknown roles are rejected so typos fail loudly. */
export function parseInitialRoles(entries: string[]): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const entry of entries) {
    const [rawEmail, rawRole] = entry.split(':').map((s) => s.trim());
    if (!rawEmail) continue;
    const role = (rawRole?.toUpperCase() || 'PMO') as Role;
    if (!ROLES.includes(role)) throw new Error(`ADMIN_EMAILS: unknown role "${rawRole}" for ${rawEmail}`);
    roles.set(rawEmail.toLowerCase(), role);
  }
  return roles;
}

interface JwtClaims {
  email?: string;
  name?: string;
  'cognito:username'?: string;
}

function identity(c: Parameters<MiddlewareHandler<AppEnv>>[0], config: AuthConfig) {
  if (config.mode === 'dev') {
    const email = c.req.header('x-dev-user');
    return email ? { email, name: undefined } : undefined;
  }
  const claims = c.env?.event?.requestContext?.authorizer?.jwt?.claims as JwtClaims | undefined;
  return claims?.email ? { email: claims.email, name: claims.name } : undefined;
}

/** Resolves the caller and auto-creates a user record on first login (role from ADMIN_EMAILS, else PL). */
export function requireUser(config: AuthConfig): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = identity(c, config);
    if (!id) throw new HTTPException(401, { message: l('Chưa đăng nhập', 'ログインしていません') });
    const store = c.get('store');
    const email = id.email.trim().toLowerCase();
    let user = await store.getUser(email);
    const initial = c.get('initialRoles').get(email);
    if (!user) {
      user = {
        id: email,
        name: id.name || email.split('@')[0],
        role: initial ?? 'PL',
        createdAt: c.get('now').toISOString(),
      };
      await store.putUser(user);
    } else if (initial === 'ADMIN' && user.role !== 'ADMIN') {
      // ADMIN_EMAILS is how the first ADMIN is made (only repo owners can change it);
      // other roles from it apply on the first sign-in only.
      const from = user.role;
      user = { ...user, role: 'ADMIN' };
      await store.putUser(user);
      await audit(store, c.get('now'), user.id, 'admin_granted', user.id, `${from} → ADMIN (ADMIN_EMAILS)`);
    }
    c.set('user', user);
    await next();
  };
}

const ADMIN_ROLES: Role[] = ['PMO', 'SUBMNG', 'MNG', 'ADMIN'];

export const can = {
  admin: (u: User) => ADMIN_ROLES.includes(u.role),
  /** System administrator: secrets (AI key, Telegram bot), granting ADMIN, the audit log. */
  system: (u: User) => u.role === 'ADMIN',
  manageUsers: (u: User) => u.role === 'PMO' || u.role === 'MNG' || u.role === 'ADMIN',
  /** Managing one account (role, password): ADMIN accounts are only touched by ADMIN. */
  manageAccount: (u: User, target: Pick<User, 'role'> | undefined) =>
    can.manageUsers(u) && (target?.role !== 'ADMIN' || u.role === 'ADMIN'),
  /**
   * Whether `u` may see project `p` (pages, AI context, alerts of channels `u` created).
   * Track F restricts OTHER to the projects they take part in.
   */
  viewProject: (_u: User, _p: Project) => true,
  /** PL and above. */
  createProject: (u: User) => u.role !== 'OTHER',
  editProject: (u: User, p: Project) => can.admin(u) || p.gl === u.id || p.pl === u.id,
  /** Soft deletes; PMO / managers restore them from the trash. */
  deleteProject: (u: User) => can.admin(u),
  deleteItem: (u: User, p: Project, item: Item) => can.editProject(u, p) || item.createdBy === u.id,
  /** The author within DELETE_UPDATE_HOURS (a typo, the wrong project), or PMO / managers. */
  deleteUpdate: (u: User, update: Update, now: Date) =>
    can.admin(u) || (update.author === u.id && now.getTime() - Date.parse(update.at) < DELETE_UPDATE_HOURS * 3600_000),
};

export const DELETE_UPDATE_HOURS = 24;

export function ensure(allowed: boolean, message = l('Không có quyền thực hiện thao tác này', 'この操作を行う権限がありません')) {
  if (!allowed) throw new HTTPException(403, { message });
}
