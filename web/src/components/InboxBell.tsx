// 🔔 in the top bar: unread personal messages and a drop-down of the latest ones.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../api';
import { l } from '../i18n';
import { InboxList } from './notify/InboxList';
import './notify/notify.css';
import { markRead, type InboxEntry, type InboxPage } from './notify/shared';

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
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="inbox-bell-wrap" ref={wrap}>
      <button
        type="button"
        className="inbox-bell"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={l(`Thông báo (${unread} chưa đọc)`, `通知（未読 ${unread} 件）`)}
        title={l('Thông báo của tôi', '自分の通知')}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && <span className="nav-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && <InboxPopover unread={unread} close={() => setOpen(false)} />}
    </div>
  );
}

function InboxPopover({ unread, close }: { unread: number; close: () => void }) {
  const [entries, setEntries] = useState<InboxEntry[]>();
  const [nextBefore, setNextBefore] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function load(before?: string) {
    setBusy(true);
    try {
      const page = await api.get<InboxPage>(`/me/inbox${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      setEntries((prev) => (before ? [...(prev ?? []), ...page.entries] : page.entries));
      setNextBefore(page.nextBefore);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function readAll() {
    try {
      await markRead({ all: true });
      const at = new Date().toISOString();
      setEntries((prev) => prev?.map((e) => ({ ...e, readAt: e.readAt ?? at })));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="inbox-pop card" role="dialog" aria-label={l('Thông báo', '通知')}>
      <div className="inbox-pop-head">
        <b>{l('Thông báo', '通知')}</b>
        <button type="button" className="btn-link" disabled={!unread} onClick={readAll}>
          ✓ {l('Đánh dấu đã đọc tất cả', 'すべて既読にする')}
        </button>
      </div>
      {error && <div className="error-box">⚠ {error}</div>}
      <div className="inbox-pop-list">
        {entries ? (
          <InboxList
            entries={entries}
            onOpened={(id) => setEntries((prev) => prev?.map((e) => (e.id === id ? { ...e, readAt: new Date().toISOString() } : e)))}
            onNavigate={close}
          />
        ) : (
          <p className="loading">{l('Đang tải…', '読み込み中…')}</p>
        )}
        {nextBefore && (
          <div className="more-row">
            <button type="button" className="btn-link" disabled={busy} onClick={() => load(nextBefore)}>
              {busy ? l('Đang tải…', '読み込み中…') : l('Xem thêm', 'さらに表示')}
            </button>
          </div>
        )}
      </div>
      <div className="inbox-pop-foot">
        <Link to="/me/notify" onClick={close}>
          ⚙ {l('Cài đặt thông báo của tôi', '自分の通知設定')}
        </Link>
      </div>
    </div>
  );
}
