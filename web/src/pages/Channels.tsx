import { useState, type FormEvent } from 'react';
import { ALERT_EVENTS, type AlertEvent, type Channel, type ChannelScope } from '../../../api/src/types';
import { api, useApi } from '../api';
import { Empty, ErrorBox, Section } from '../components/ui';
import { fmtDateTime } from '../format';
import { useSession } from '../session';
import type { ProjectView } from '../types';

type PublicChannel = Omit<Channel, 'webhookUrl'> & { webhookUrlMasked: string };

const EVENT_LABEL: Record<AlertEvent, string> = {
  became_red: 'Dự án chuyển sang Đỏ (ngay lập tức)',
  high_issue: 'Vấn đề ưu tiên Cao mới (ngay lập tức)',
  overdue: 'Mục quá hạn (mỗi ngày một lần)',
  late_update: 'Trễ cập nhật (nhắc mỗi 24 giờ)',
  milestone_soon: 'Mốc / sự kiện vào ngày mai',
  daily_digest: 'Tóm tắt lúc 8h sáng',
};

export function ChannelsPage() {
  const { data, error, reload } = useApi<{ channels: PublicChannel[] }>('/channels');
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
      reload();
    } catch (e) {
      setActionError((e as Error).message);
      reload();
    }
  }

  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>Kênh thông báo Teams</h1>
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
          <Empty>Chưa có kênh nào. Bấm “Đăng ký kênh” để nhận cảnh báo trong Teams.</Empty>
        ) : (
          <ul className="rows">
            {data.channels.map((ch) => (
              <li key={ch.id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <b>{ch.name}</b>
                    <span className={`badge ${ch.enabled ? 'tone-green' : ''}`}>
                      <span aria-hidden>{ch.enabled ? '●' : '○'}</span> {ch.enabled ? 'Đang bật' : 'Đã tắt'}
                    </span>
                    <span className="muted">{scopeLabel(ch.scope, name)}</span>
                  </div>
                  <p className="row-text">{ch.events.map((e) => EVENT_LABEL[e].replace(/ \(.*\)$/, '')).join(' · ')}</p>
                  <small className="muted">
                    {ch.webhookUrlMasked} · tạo bởi {name(ch.createdBy)}
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

      <Section title="Cách lấy URL webhook trong Teams">
        <ol className="howto">
          <li>
            Trong kênh Teams muốn nhận thông báo, bấm <b>⋯</b> cạnh tên kênh → <b>Workflows</b>.
          </li>
          <li>
            Chọn mẫu <b>“Post to a channel when a webhook request is received”</b> (Đăng lên kênh khi nhận yêu cầu webhook).
          </li>
          <li>Đặt tên, chọn đúng Team và Channel, bấm <b>Add workflow</b>.</li>
          <li>
            Copy URL hiện ra (bắt đầu bằng <code>https://…logic.azure.com</code> hoặc <code>…powerplatform.com</code>) và dán vào ô URL ở
            trên.
          </li>
        </ol>
        <p className="muted">
          URL này cho phép bất kỳ ai đăng tin vào kênh, nên hệ thống chỉ lưu và không bao giờ hiển thị lại đầy đủ. Khi đăng ký, hệ thống
          gửi một tin thử; kênh chỉ được lưu khi tin thử tới được Teams.
        </p>
      </Section>
    </div>
  );
}

function scopeLabel(scope: ChannelScope, name: (id?: string) => string) {
  if (scope.type === 'gl') return `Nhóm GL ${name(scope.gl)}`;
  if (scope.type === 'projects') return `Dự án: ${(scope.projects ?? []).join(', ')}`;
  return 'Tất cả dự án';
}

function ChannelForm({
  channel,
  onCancel,
  onSaved,
}: {
  channel?: PublicChannel;
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const { users, me } = useSession();
  const { data: projects } = useApi<{ projects: ProjectView[] }>('/projects');
  const [chName, setName] = useState(channel?.name ?? '');
  const [url, setUrl] = useState('');
  const [scopeType, setScopeType] = useState<ChannelScope['type']>(channel?.scope.type ?? (me.role === 'GL' ? 'gl' : 'all'));
  const [gl, setGl] = useState(channel?.scope.gl ?? (me.role === 'GL' ? me.id : ''));
  const [picked, setPicked] = useState<string[]>(channel?.scope.projects ?? []);
  const [events, setEvents] = useState<AlertEvent[]>(channel?.events ?? [...ALERT_EVENTS]);
  const [quietHours, setQuiet] = useState(channel?.quietHours ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
        await api.post('/channels', { name: chName, webhookUrl: url, scope, events, quietHours });
        onSaved(`Đã đăng ký kênh "${chName}" — kiểm tra tin thử trong Teams`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{channel ? `Sửa kênh "${channel.name}"` : 'Đăng ký kênh Teams'}</h2>
      <label>
        Tên kênh (để nhận biết)
        <input required value={chName} placeholder="VD: Nhóm Hùng – #du-an" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        URL webhook của Teams Workflows {channel && <small className="muted">(để trống = giữ URL hiện tại: {channel.webhookUrlMasked})</small>}
        <input type="url" required={!channel} value={url} placeholder="https://…logic.azure.com/workflows/…" onChange={(e) => setUrl(e.target.value)} />
      </label>

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
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Đang gửi tin thử…' : channel ? 'Lưu' : 'Đăng ký & gửi tin thử'}
        </button>
      </div>
    </form>
  );
}
