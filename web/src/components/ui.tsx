import { useEffect, useState, type ReactNode } from 'react';
import type { Health, ItemType, Urgency } from '../../../api/src/types';
import { fmtHours } from '../format';
import { l, lang, setLang } from '../i18n';
import { HEALTH_LABEL, TYPE_ICON, TYPE_LABEL, URGENCY_LABEL } from '../labels';

// Status colors always come with a symbol and a text label, never color alone.
const HEALTH_ICON: Record<Health, string> = { green: '●', yellow: '▲', red: '■' };
const URGENCY_ICON: Record<Urgency, string> = { critical: '■', attention: '▲', normal: '●' };
const URGENCY_TONE: Record<Urgency, Health> = { critical: 'red', attention: 'yellow', normal: 'green' };

export function HealthBadge({ health }: { health: Health }) {
  return (
    <span className={`badge tone-${health}`}>
      <span aria-hidden>{HEALTH_ICON[health]}</span> {HEALTH_LABEL[health]}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span className={`badge tone-${URGENCY_TONE[urgency]}`}>
      <span aria-hidden>{URGENCY_ICON[urgency]}</span> {URGENCY_LABEL[urgency]}
    </span>
  );
}

export function TypeIcon({ type }: { type: ItemType }) {
  return (
    <span className={`type-icon type-${type}`} title={TYPE_LABEL[type]} aria-label={TYPE_LABEL[type]}>
      {TYPE_ICON[type]}
    </span>
  );
}

export function Warnings({ lateHours, overdueItems, highIssues }: { lateHours: number; overdueItems: number; highIssues: number }) {
  if (!lateHours && !overdueItems && !highIssues) return null;
  return (
    <span className="warnings">
      {lateHours > 0 && <span className="warn">⏰ {l(`Trễ cập nhật ${fmtHours(lateHours)}`, `報告遅れ ${fmtHours(lateHours)}`)}</span>}
      {overdueItems > 0 && <span className="warn">⚠ {l(`${overdueItems} mục quá hạn`, `期限超過 ${overdueItems}件`)}</span>}
      {highIssues > 0 && <span className="warn">▲ {l(`${highIssues} vấn đề ưu tiên cao`, `優先度「高」の課題 ${highIssues}件`)}</span>}
    </span>
  );
}

export function Kpi({ label, value, tone, hint }: { label: string; value: number; tone?: Health; hint?: string }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`} title={hint}>
      <div className="kpi-label">
        {tone && <span className={`dot tone-${tone}`} aria-hidden />}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

export function Section({
  title,
  extra,
  children,
  className,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      <header className="card-head">
        <h2>{title}</h2>
        {extra}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function ErrorBox({ error }: { error?: string }) {
  return error ? <div className="error-box">⚠ {error}</div> : null;
}

/** Stacked red / yellow / green bar with a hover tooltip per segment. */
export function HealthBar({ red, yellow, green }: Record<Health, number>) {
  const total = red + yellow + green;
  if (!total) return <div className="hbar" />;
  const segs: [Health, number][] = [
    ['red', red],
    ['yellow', yellow],
    ['green', green],
  ];
  return (
    <div className="hbar" role="img" aria-label={l(`Đỏ ${red}, Vàng ${yellow}, Xanh ${green}`, `赤 ${red}、黄 ${yellow}、緑 ${green}`)}>
      {segs
        .filter(([, n]) => n > 0)
        .map(([h, n]) => (
          <div key={h} className={`hbar-seg fill-${h}`} style={{ flexGrow: n }} title={`${HEALTH_LABEL[h]}: ${n}${l(' dự án', '件')}`} />
        ))}
    </div>
  );
}

/** "VI | 日本語" switch; the page reloads in the chosen language. */
export function LangSwitch() {
  return (
    <span className="lang-switch" role="group" aria-label="Ngôn ngữ / 言語">
      <button type="button" className={lang === 'vi' ? 'active' : ''} aria-pressed={lang === 'vi'} onClick={() => setLang('vi')}>
        VI
      </button>
      <button type="button" className={lang === 'ja' ? 'active' : ''} aria-pressed={lang === 'ja'} onClick={() => setLang('ja')}>
        日本語
      </button>
    </span>
  );
}

/**
 * Long lists show the first `step` rows; "Xem thêm" adds `step` more (the data is already
 * loaded), "Thu gọn" goes back. Render `more` under the list.
 */
export function useShowMore<T>(items: T[], step: number) {
  const [count, setCount] = useState(step);
  const shown = Math.min(count, items.length);
  return {
    visible: items.slice(0, count),
    more: (
      <MoreLess
        hidden={items.length - shown}
        canLess={shown > step}
        onMore={() => setCount((c) => c + step)}
        onLess={() => setCount(step)}
      />
    ),
  };
}

export function MoreLess({
  hidden,
  canLess,
  onMore,
  onLess,
  busy,
}: {
  /** Rows not shown yet; undefined = unknown (more pages on the server). */
  hidden?: number;
  canLess?: boolean;
  onMore?: () => void;
  onLess?: () => void;
  busy?: boolean;
}) {
  const hasMore = hidden === undefined ? !!onMore : hidden > 0;
  if (!hasMore && !canLess) return null;
  return (
    <div className="more-row">
      {hasMore && (
        <button type="button" className="btn-link" disabled={busy} onClick={onMore}>
          {busy
            ? l('Đang tải…', '読み込み中…')
            : hidden === undefined
              ? l('Xem thêm', 'さらに表示')
              : l(`Xem thêm (còn ${hidden})`, `さらに表示（残り ${hidden} 件）`)}
        </button>
      )}
      {canLess && (
        <button type="button" className="btn-link" onClick={onLess}>
          {l('Thu gọn', '折りたたむ')}
        </button>
      )}
    </div>
  );
}

/**
 * A link to a section (`/help#cap-nhat`) opened from outside: the browser looks for the section
 * before React has drawn it, so scroll to it once the page is there.
 */
export function useScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
}
