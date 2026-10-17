import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, setUnauthorizedHandler } from './api';
import { auth } from './auth';
import { ErrorBox, LangSwitch } from './components/ui';
import { l } from './i18n';
import { ROLE_LABEL } from './labels';
import { AiEntryPage } from './pages/AiEntry';
import { ChannelsPage } from './pages/Channels';
import { Dashboard } from './pages/Dashboard';
import { HelpPage } from './pages/Help';
import { Login } from './pages/Login';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { ProjectForm } from './pages/ProjectForm';
import { Projects } from './pages/Projects';
import { PublicPage } from './pages/Public';
import { SettingsPage } from './pages/Settings';
import { TrashPage } from './pages/Trash';
import { UsersPage } from './pages/Users';
import { SessionProvider, useSession } from './session';
import type { User } from './types';

export function App() {
  return (
    <Routes>
      <Route path="/public" element={<PublicPage />} />
      <Route path="/help" element={<HelpPage />} />
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
  if (!me) return <p className="loading">{l('Đang tải…', '読み込み中…')}</p>;

  return (
    <SessionProvider me={me}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<ProjectForm />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/edit" element={<ProjectForm />} />
          <Route path="/ai" element={<AiEntryPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/trash" element={<TrashPage />} />
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
  // Phones: the menu folds behind ☰ and closes after each navigation.
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, search } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname, search]);
  return (
    <>
      <header className="topbar">
        <div className={`topbar-inner${menuOpen ? ' open' : ''}`}>
          <NavLink to="/" className="brand">
            {l('Theo dõi dự án', 'プロジェクト管理')}
          </NavLink>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-label={l('Menu', 'メニュー')}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? '✕' : '☰'}
            {!menuOpen && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
          </button>
          <nav className="nav">
            <NavLink to="/" end>
              {l('Tổng quan', 'ダッシュボード')}
            </NavLink>
            <NavLink to="/projects">{l('Dự án', 'プロジェクト')}</NavLink>
            <NavLink to="/ai">✦ AI</NavLink>
            <NavLink to="/channels">{l('Kênh thông báo', '通知チャネル')}</NavLink>
            {canManageUsers && (
              <NavLink to="/users">
                {l('Người dùng', 'ユーザー')}
                {pendingCount > 0 && (
                  <span className="nav-count" title={l(`${pendingCount} tài khoản chờ duyệt`, `承認待ちアカウント ${pendingCount}件`)}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            )}
            {isAdmin && <NavLink to="/settings">{l('Cài đặt', '設定')}</NavLink>}
            <a href="/public" target="_blank" rel="noreferrer">
              {l('Trang public', '公開ページ')} ↗
            </a>
            <NavLink to="/help">{l('Hướng dẫn', 'ヘルプ')}</NavLink>
          </nav>
          <div className="me">
            <LangSwitch />
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
              {l('Đăng xuất', 'ログアウト')}
            </button>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
