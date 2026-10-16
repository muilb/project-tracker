import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env.js';
import { l } from './i18n.js';
import { ROLES, type Project, type Role, type User } from './types.js';

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
    if (!user) {
      user = {
        id: email,
        name: id.name || email.split('@')[0],
        role: c.get('initialRoles').get(email) ?? 'PL',
        createdAt: c.get('now').toISOString(),
      };
      await store.putUser(user);
    }
    c.set('user', user);
    await next();
  };
}

const ADMIN_ROLES: Role[] = ['PMO', 'SUBMNG', 'MNG'];

export const can = {
  admin: (u: User) => ADMIN_ROLES.includes(u.role),
  manageUsers: (u: User) => u.role === 'PMO' || u.role === 'MNG',
  /** PL and above. */
  createProject: (u: User) => u.role !== 'OTHER',
  editProject: (u: User, p: Project) => can.admin(u) || p.gl === u.id || p.pl === u.id,
};

export function ensure(allowed: boolean, message = l('Không có quyền thực hiện thao tác này', 'この操作を行う権限がありません')) {
  if (!allowed) throw new HTTPException(403, { message });
}
