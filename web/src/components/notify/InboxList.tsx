// Inbox messages (🔔 drop-down): clicking one marks it read and opens its link.
import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { fmtDateTime } from '../../format';
import { l } from '../../i18n';
import { markRead, type InboxEntry } from './shared';

/** Message lines may contain **bold**; everything else is plain text. */
function rich(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}

/** Links into this app open in place; anything else in a new tab. */
function openLink(url: string, navigate: (path: string) => void) {
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin) return navigate(u.pathname + u.search + u.hash);
  } catch {
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function InboxList({
  entries,
  onOpened,
  onNavigate,
}: {
  entries: InboxEntry[];
  onOpened: (id: string) => void;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  if (!entries.length) return <p className="empty">{l('Chưa có thông báo nào.', '通知はまだありません。')}</p>;

  function open(e: InboxEntry) {
    if (!e.readAt) {
      onOpened(e.id);
      markRead({ ids: [e.id] }).catch(() => {});
    }
    if (e.link) {
      onNavigate?.();
      openLink(e.link.url, navigate);
    }
  }

  return (
    <ul className="inbox-list">
      {entries.map((e) => (
        <li key={e.id}>
          <button type="button" className={`inbox-entry${e.readAt ? '' : ' unread'}`} onClick={() => open(e)}>
            <span className="inbox-entry-head">
              <span className="inbox-title">{e.title}</span>
              {e.readAt ? (
                <span className="inbox-state muted">✓ {l('Đã đọc', '既読')}</span>
              ) : (
                <span className="inbox-state is-new">● {l('Mới', '未読')}</span>
              )}
            </span>
            {e.lines.slice(0, 3).map((line, i) => (
              <span key={i} className={`inbox-line${line.subtle ? ' muted' : ''}`}>
                {rich(line.text)}
              </span>
            ))}
            <span className="inbox-meta muted">
              {fmtDateTime(e.at)}
              {e.link && <> · {e.link.title} →</>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
