import { useMemo, useState, type FormEvent } from 'react';
import { ALERT_EVENTS, type AlertEvent, type Channel, type ChannelKind, type ChannelScope } from '../../../api/src/types';
import { api, useApi } from '../api';
import { Empty, ErrorBox, Section } from '../components/ui';
import { fmtDateTime } from '../format';
import { useSession } from '../session';
import type { ProjectView } from '../types';

type PublicChannel = Omit<Channel, 'webhookUrl'> & { webhookUrlMasked?: string };
type BotStatus = { configured: boolean; username?: string };

const EVENT_LABEL: Record<AlertEvent, string> = {
  became_red: 'Dự án chuyển sang Đỏ (ngay lập tức)',
  high_issue: 'Vấn đề ưu tiên Cao mới (ngay lập tức)',
  overdue: 'Mục quá hạn (mỗi ngày một lần)',
  late_update: 'Trễ cập nhật (nhắc mỗi 24 giờ)',
  milestone_soon: 'Mốc / sự kiện vào ngày mai',
  daily_digest: 'Tóm tắt lúc 8h sáng',
};
const KIND_LABEL: Record<ChannelKind, string> = { telegram: 'Telegram', teams: 'Teams' };

export function ChannelsPage() {
  const { data, error, reload } = useApi<{ channels: PublicChannel[] }>('/channels');
  const bot = useApi<BotStatus>('/settings/telegram');
  const [editing, setEditing] = useState<PublicChannel | 'new' | null>(null);
  const [msg, setMsg] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const { name } = useSession();

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMsg(undefined);
    setActionError(undefined);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setActionError((e as Error).message);
    }
    reload();
  }

  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>Kênh thông báo</h1>
        {!editing && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            ＋ Đăng ký kênh
          </button>
        )}
      </div>
      <ErrorBox error={error ?? actionError} />
      {msg && <div className="info-box">{msg}</div>}

      {editing && (
        <ChannelForm
          channel={editing === 'new' ? undefined : editing}
          bot={bot.data}
          onCancel={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setMsg(text);
            reload();
          }}
        />
      )}

      <section className="card">
        {!data ? (
          <p className="loading">Đang tải…</p>
        ) : data.channels.length === 0 ? (
          <Empty>Chưa có kênh nào. Bấm “Đăng ký kênh” để nhận cảnh báo qua Telegram hoặc Teams.</Empty>
        ) : (
          <ul className="rows">
            {data.channels.map((ch) => (
              <li key={ch.id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="badge">{KIND_LABEL[ch.kind]}</span>
                    <b>{ch.name}</b>
                    <span className={`badge ${ch.enabled ? 'tone-green' : ''}`}>
                      <span aria-hidden>{ch.enabled ? '●' : '○'}</span> {ch.enabled ? 'Đang bật' : 'Đã tắt'}
                    </span>
                    <span className="muted">{scopeLabel(ch.scope, name)}</span>
                  </div>
                  <p className="row-text">{ch.events.map((e) => EVENT_LABEL[e].replace(/ \(.*\)$/, '')).join(' · ')}</p>
                  <small className="muted">
                    {ch.kind === 'telegram' ? `Nhóm Telegram: ${ch.telegramChatTitle ?? ch.telegramChatId}` : ch.webhookUrlMasked} · tạo bởi{' '}
                    {name(ch.createdBy)}
                    {ch.quietHours ? ' · yên lặng 22h–7h' : ''}
                    {ch.lastSentAt ? ` · gửi lần cuối ${fmtDateTime(ch.lastSentAt)}` : ''}
                  </small>
                  {ch.lastError && <div className="warn">⚠ Lỗi gửi gần nhất: {ch.lastError}</div>}
                </div>
                <div className="row-side actions-col">
                  <button className="btn" onClick={() => act(() => api.post(`/channels/${ch.id}/test`, {}), `Đã gửi tin thử tới "${ch.name}"`)}>
                    Gửi thử
                  </button>
                  <button className="btn" onClick={() => setEditing(ch)}>
                    Sửa
                  </button>
                  <button
                    className="btn"
                    onClick={() => act(() => api.patch(`/channels/${ch.id}`, { enabled: !ch.enabled }), ch.enabled ? 'Đã tắt kênh' : 'Đã bật kênh')}
                  >
                    {ch.enabled ? 'Tắt' : 'Bật'}
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      confirm(`Xoá kênh "${ch.name}"?`) && act(() => api.del(`/channels/${ch.id}`), `Đã xoá kênh "${ch.name}"`)
                    }
                  >
                    Xoá
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function scopeLabel(scope: ChannelScope, name: (id?: string) => string) {
  if (scope.type === 'gl') return `Nhóm GL ${name(scope.gl)}`;
  if (scope.type === 'projects') return `Dự án: ${(scope.projects ?? []).join(', ')}`;
  return 'Tất cả dự án';
}

const CODE_KEY = 'telegram-connect-code';
const CODE_TTL_MS = 24 * 3600_000; // Telegram keeps undelivered bot updates about 24h

/**
 * Connect code, kept in localStorage: on phones the browser often reloads the tab
 * while the user is in the Telegram app, and a new code would no longer match the
 * line already sent to the group.
 */
function connectCode() {
  try {
    const saved = JSON.parse(localStorage.getItem(CODE_KEY) ?? 'null') as { code: string; at: number } | null;
    if (saved && Date.now() - saved.at < CODE_TTL_MS) return saved.code;
  } catch {
    // storage unavailable: fall through to a fresh code
  }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = `PT-${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => chars[b % chars.length]).join('')}`;
  try {
    localStorage.setItem(CODE_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // ignore
  }
  return code;
}

function forgetConnectCode() {
  try {
    localStorage.removeItem(CODE_KEY);
  } catch {
    // ignore
  }
}

function ChannelForm({
  channel,
  bot,
  onCancel,
  onSaved,
}: {
  channel?: PublicChannel;
  bot?: BotStatus;
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const { users, me, isAdmin } = useSession();
  const { data: projects } = useApi<{ projects: ProjectView[] }>('/projects');
  const [kind, setKind] = useState<ChannelKind>(channel?.kind ?? 'telegram');
  const [chName, setName] = useState(channel?.name ?? '');
  const [url, setUrl] = useState('');
  const code = useMemo(connectCode, []);
  const [scopeType, setScopeType] = useState<ChannelScope['type']>(channel?.scope.type ?? (me.role === 'GL' ? 'gl' : 'all'));
  const [gl, setGl] = useState(channel?.scope.gl ?? (me.role === 'GL' ? me.id : ''));
  const [picked, setPicked] = useState<string[]>(channel?.scope.projects ?? []);
  const [events, setEvents] = useState<AlertEvent[]>(channel?.events ?? [...ALERT_EVENTS]);
  const [quietHours, setQuiet] = useState(channel?.quietHours ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const connectLine = `/connect@${bot?.username ?? 'bot'} ${code}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const scope: ChannelScope =
      scopeType === 'gl' ? { type: 'gl', gl } : scopeType === 'projects' ? { type: 'projects', projects: picked } : { type: 'all' };
    try {
      if (channel) {
        await api.patch(`/channels/${channel.id}`, { name: chName, scope, events, quietHours, ...(url ? { webhookUrl: url } : {}) });
        onSaved(`Đã lưu kênh "${chName}"`);
      } else {
        const target = kind === 'telegram' ? { connectCode: code } : { webhookUrl: url };
        await api.post('/channels', { kind, name: chName, scope, events, quietHours, ...target });
        if (kind === 'telegram') forgetConnectCode();
        onSaved(`Đã kết nối "${chName}" — kiểm tra tin thử trong ${KIND_LABEL[kind]}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const telegramBlocked = !channel && kind === 'telegram' && bot && !bot.configured;

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{channel ? `Sửa kênh "${channel.name}"` : 'Đăng ký kênh thông báo'}</h2>

      {!channel && (
        <div className="segmented" role="group" aria-label="Loại kênh">
          {(['telegram', 'teams'] as ChannelKind[]).map((k) => (
            <button type="button" key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      <label>
        Tên kênh (để nhận biết)
        <input required value={chName} placeholder="VD: Nhóm Hùng – dự án" onChange={(e) => setName(e.target.value)} />
      </label>

      {!channel && kind === 'telegram' && (
        <fieldset>
          <legend>Kết nối nhóm Telegram</legend>
          {telegramBlocked ? (
            <div className="error-box">
              Chưa cài bot Telegram.{' '}
              {isAdmin ? (
                <>
                  Vào <a href="/settings">Cài đặt → Bot Telegram</a> để cài.
                </>
              ) : (
                'Nhờ PMO cài bot ở trang Cài đặt.'
              )}
            </div>
          ) : (
            <ol className="howto">
              <li>
                Trong Telegram, mở nhóm muốn nhận thông báo → <b>Add members</b> → thêm <b>@{bot?.username}</b>. (Muốn nhận riêng cho mình thì
                mở chat với @{bot?.username} và bấm <b>Start</b>.)
              </li>
              <li>
                Gửi vào nhóm đúng dòng sau:
                <div className="copy-line">
                  <code>{connectLine}</code>
                  <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(connectLine)}>
                    Copy
                  </button>
                </div>
              </li>
              <li>
                Quay lại đây, bấm <b>Kết nối &amp; gửi tin thử</b>.
              </li>
            </ol>
          )}
        </fieldset>
      )}

      {kind === 'teams' && (
        <label>
          URL webhook của Teams Workflows{' '}
          {channel && <small className="muted">(để trống = giữ URL hiện tại: {channel.webhookUrlMasked})</small>}
          <input
            type="url"
            required={!channel}
            value={url}
            placeholder="https://…logic.azure.com/workflows/…"
            onChange={(e) => setUrl(e.target.value)}
          />
          {!channel && (
            <small className="muted">
              Trong kênh Teams: ⋯ → Workflows → mẫu “Send webhook alerts to a channel” → Save → copy URL. Cần quyền Power Automate.
            </small>
          )}
        </label>
      )}

      <fieldset>
        <legend>Phạm vi dự án</legend>
        <div className="checks">
          <label className="check">
            <input type="radio" name="scope" checked={scopeType === 'all'} onChange={() => setScopeType('all')} /> Tất cả dự án
          </label>
          <label className="check">
            <input type="radio" name="scope" checked={scopeType === 'gl'} onChange={() => setScopeType('gl')} /> Theo nhóm GL
          </label>
          <label className="check">
            <input type="radio" name="scope" checked={scopeType === 'projects'} onChange={() => setScopeType('projects')} /> Chọn dự án
          </label>
        </div>
        {scopeType === 'gl' && (
          <select required value={gl} onChange={(e) => setGl(e.target.value)} aria-label="GL">
            <option value="">— chọn GL —</option>
            {users
              .filter((u) => u.role === 'GL')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        {scopeType === 'projects' && (
          <div className="checks">
            {(projects?.projects ?? []).map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(toggle(picked, p.id, e.target.checked))} />
                {p.id} · {p.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Nhận thông báo khi</legend>
        <div className="checks column">
          {ALERT_EVENTS.map((ev) => (
            <label key={ev} className="check">
              <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(toggle(events, ev, e.target.checked))} />
              {EVENT_LABEL[ev]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={quietHours} onChange={(e) => setQuiet(e.target.checked)} /> Không gửi nhắc nhở từ 22h đến 7h (cảnh báo
        Đỏ và vấn đề Cao vẫn gửi ngay)
      </label>

      <ErrorBox error={error} />
      <div className="actions gap">
        <button type="button" className="btn" onClick={onCancel}>
          Huỷ
        </button>
        <button className="btn btn-primary" disabled={busy || !!telegramBlocked}>
          {busy ? 'Đang gửi tin thử…' : channel ? 'Lưu' : 'Kết nối & gửi tin thử'}
        </button>
      </div>
    </form>
  );
}
