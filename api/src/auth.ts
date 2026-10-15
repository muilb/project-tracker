import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env.js';
import type { Project, Role, User } from './types.js';

export interface AuthConfig {
  /** `jwt`: identity from the API Gateway Cognito authorizer. `dev`: `x-dev-user: <email>` header. */
  mode: 'jwt' | 'dev';
  /** Emails that get the PMO role on first login. */
  adminEmails: string[];
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

/** Resolves the caller and auto-creates a user record on first login (default role PL). */
export function requireUser(config: AuthConfig): MiddlewareHandler<AppEnv> {
  const admins = new Set(config.adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return async (c, next) => {
    const id = identity(c, config);
    if (!id) throw new HTTPException(401, { message: 'Chưa đăng nhập' });
    const store = c.get('store');
    const email = id.email.trim().toLowerCase();
    let user = await store.getUser(email);
    if (!user) {
      user = {
        id: email,
        name: id.name || email.split('@')[0],
        role: admins.has(email) ? 'PMO' : 'PL',
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

export function ensure(allowed: boolean, message = 'Không có quyền thực hiện thao tác này') {
  if (!allowed) throw new HTTPException(403, { message });
}
