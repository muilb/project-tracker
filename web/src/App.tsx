import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, setUnauthorizedHandler } from './api';
import { auth } from './auth';
import { ErrorBox } from './components/ui';
import { ROLE_LABEL } from './labels';
import { ChannelsPage } from './pages/Channels';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { ProjectForm } from './pages/ProjectForm';
import { Projects } from './pages/Projects';
import { PublicPage } from './pages/Public';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { SessionProvider, useSession } from './session';
import type { User } from './types';

export function App() {
  return (
    <Routes>
      <Route path="/public" element={<PublicPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Authenticated />} />
    </Routes>
  );
}

/** Loads the current user (GET /me) or sends the visitor to /login. */
function Authenticated() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<User>();
  const [error, setError] = useState<string>();

  const toLogin = useCallback(
    () => navigate('/login', { replace: true, state: { from: location.pathname } }),
    [navigate, location.pathname],
  );

  useEffect(() => {
    setUnauthorizedHandler(toLogin);
    if (!auth.isSignedIn()) {
      toLogin();
      return;
    }
    api
      .get<{ user: User }>('/me')
      .then((r) => setMe(r.user))
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!auth.isSignedIn()) return <Navigate to="/login" replace />;
  if (error) return <ErrorBox error={error} />;
  if (!me) return <p className="loading">Đang tải…</p>;

  return (
    <SessionProvider me={me}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<ProjectForm />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/edit" element={<ProjectForm />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </SessionProvider>
  );
}

/** Number of sign-ups waiting for approval (PMO / MNG only), refreshed when the Users page acts. */
function usePendingCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      api
        .get<{ pending: unknown[] }>('/users/pending')
        .then((r) => setCount(r.pending.length))
        .catch(() => {});
    load();
    window.addEventListener('pending-changed', load);
    return () => window.removeEventListener('pending-changed', load);
  }, [enabled]);
  return count;
}

function Layout({ children }: { children: React.ReactNode }) {
  const { me, isAdmin, canManageUsers } = useSession();
  const navigate = useNavigate();
  const pendingCount = usePendingCount(canManageUsers);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            Theo dõi dự án
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>
              Tổng quan
            </NavLink>
            <NavLink to="/projects">Dự án</NavLink>
            <NavLink to="/channels">Kênh Teams</NavLink>
            {canManageUsers && (
              <NavLink to="/users">
                Người dùng
                {pendingCount > 0 && (
                  <span className="nav-count" title={`${pendingCount} tài khoản chờ duyệt`}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            )}
            {isAdmin && <NavLink to="/settings">Cài đặt</NavLink>}
            <a href="/public" target="_blank" rel="noreferrer">
              Trang public ↗
            </a>
          </nav>
          <div className="me">
            <span title={me.id}>
              {me.name} · {ROLE_LABEL[me.role]}
            </span>
            <button
              className="btn-link"
              onClick={() => {
                auth.signOut();
                navigate('/login');
              }}
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
