// 🔔 in the top bar: unread personal messages. Track B adds the drop-down list and mounts it in App.tsx.
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { api } from '../api';
import { l } from '../i18n';

/** Unread count, refreshed every minute, when the tab comes back, and on 'inbox-changed'. */
export function useUnreadCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () =>
      api
        .get<{ unread: number }>('/me/inbox')
        .then((r) => setCount(r.unread))
        .catch(() => {});
    const onVisible = () => document.visibilityState === 'visible' && load();
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener('inbox-changed', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('inbox-changed', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return count;
}

export function InboxBell() {
  const unread = useUnreadCount();
  return (
    <NavLink to="/me/notify" className="inbox-bell" aria-label={l(`Thông báo (${unread} chưa đọc)`, `通知（未読 ${unread} 件）`)}>
      <span aria-hidden>🔔</span>
      {unread > 0 && <span className="nav-count">{unread}</span>}
    </NavLink>
  );
}
