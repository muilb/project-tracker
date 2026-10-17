import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

interface SessionValue {
  me: User;
  users: User[];
  /** Display name for a user id (email); falls back to the part before @. */
  name: (id?: string) => string;
  reloadUsers: () => void;
  isAdmin: boolean; // PMO / SUBMNG / MNG / ADMIN
  canManageUsers: boolean; // PMO / MNG / ADMIN
  /** System administrator: AI key, Telegram bot, granting ADMIN, audit log. */
  isSystemAdmin: boolean;
}

const Ctx = createContext<SessionValue | undefined>(undefined);

export function SessionProvider({ me, children }: { me: User; children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const reloadUsers = useCallback(() => {
    api
      .get<{ users: User[] }>('/users')
      .then((r) => setUsers(r.users))
      .catch(() => {});
  }, []);
  useEffect(reloadUsers, [reloadUsers]);

  const value = useMemo<SessionValue>(() => {
    const byId = new Map(users.map((u) => [u.id, u.name]));
    return {
      me,
      users,
      name: (id) => (id ? (byId.get(id) ?? id.split('@')[0]) : '—'),
      reloadUsers,
      isAdmin: ['PMO', 'SUBMNG', 'MNG', 'ADMIN'].includes(me.role),
      canManageUsers: ['PMO', 'MNG', 'ADMIN'].includes(me.role),
      isSystemAdmin: me.role === 'ADMIN',
    };
  }, [me, users, reloadUsers]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
