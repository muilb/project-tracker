import { useEffect, useState, type FormEvent } from 'react';
import { api, useApi } from '../api';
import { ErrorBox, Section } from '../components/ui';
import { useSession } from '../session';
import type { Settings } from '../types';

export function SettingsPage() {
  const { isAdmin } = useSession();
  const [s, setS] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<{ settings: Settings }>('/settings')
      .then((r) => setS(r.settings))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!isAdmin) return <ErrorBox error="Chỉ PMO / quản lý mới sửa cài đặt" />;
  if (!s) return error ? <ErrorBox error={error} /> : <p className="loading">Đang tải…</p>;

  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    try {
      const r = await api.put<{ settings: Settings }>('/settings', s);
      setS(r.settings);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack narrow">
      <h1>Cài đặt</h1>
      <AiSettings />
      <TelegramSettings />
      <form className="card form" onSubmit={submit}>
        <fieldset>
          <legend>Tần suất cập nhật theo trạng thái (giờ)</legend>
          <div className="form-grid">
            {(['green', 'yellow', 'red'] as const).map((h) => (
              <label key={h}>
                {{ green: 'Xanh', yellow: 'Vàng', red: 'Đỏ' }[h]}
                <input
                  type="number"
                  min={1}
                  required
                  value={s.frequencyHours[h]}
                  onChange={(e) => setS({ ...s, frequencyHours: { ...s.frequencyHours, [h]: num(e.target.value) } })}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid">
          <label>
            Cảnh báo "sắp tới" khi còn ≤ (ngày)
            <input type="number" min={0} required value={s.soonDays} onChange={(e) => setS({ ...s, soonDays: num(e.target.value) })} />
          </label>
          <label>
            Tần suất khi mốc / sự kiện sắp tới (giờ)
            <input
              type="number"
              min={1}
              required
              value={s.nearEventFrequencyHours}
              onChange={(e) => setS({ ...s, nearEventFrequencyHours: num(e.target.value) })}
            />
          </label>
          <label>
            Danh sách "sắp tới" trên dashboard (ngày)
            <input type="number" min={1} required value={s.upcomingDays} onChange={(e) => setS({ ...s, upcomingDays: num(e.target.value) })} />
          </label>
        </div>
        <ErrorBox error={error} />
        {saved && <div className="info-box">Đã lưu.</div>}
        <div className="actions">
          <button className="btn btn-primary">Lưu cài đặt</button>
        </div>
      </form>
    </div>
  );
}

function TelegramSettings() {
  const { data, reload } = useApi<{ configured: boolean; username?: string }>('/settings/telegram');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.put('/settings/telegram', { token });
      setToken('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Gỡ bot Telegram? Các kênh Telegram sẽ ngừng nhận thông báo.')) return;
    await api.del('/settings/telegram').catch((e: Error) => setError(e.message));
    reload();
  }

  return (
    <Section title="Bot Telegram">
      {data?.configured ? (
        <div className="form">
          <div className="info-box">
            ✓ Đang dùng bot <b>@{data.username}</b>. Mọi người đăng ký nhóm Telegram ở trang <b>Kênh thông báo</b>.
          </div>
          <div className="actions gap">
            <button className="btn" onClick={remove}>
              Gỡ bot
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          <ol className="howto">
            <li>
              Mở Telegram, chat với <b>@BotFather</b>, gửi <code>/newbot</code>.
            </li>
            <li>
              Đặt tên hiển thị (VD: <i>Theo dõi dự án</i>) và username kết thúc bằng <code>bot</code> (VD: <code>brycen_duan_bot</code>).
            </li>
            <li>
              BotFather trả về <b>token</b> dạng <code>123456789:AA…</code> — dán vào ô dưới.
            </li>
          </ol>
          <label>
            Token của bot
            <input
              type="password"
              required
              autoComplete="off"
              value={token}
              placeholder="123456789:AA…"
              onChange={(e) => setToken(e.target.value)}
            />
            <small className="muted">Token được lưu trên máy chủ, không hiển thị lại. Chỉ PMO / quản lý thay hoặc gỡ được.</small>
          </label>
          <ErrorBox error={error} />
          <div className="actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Đang kiểm tra…' : 'Lưu bot'}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}


function AiSettings() {
  const { data, reload } = useApi<{ configured: boolean; model: string }>('/settings/ai');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.put('/settings/ai', { apiKey });
      setApiKey('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Gỡ API key? Trang "Nhập bằng AI" sẽ ngừng hoạt động.')) return;
    await api.del('/settings/ai').catch((e: Error) => setError(e.message));
    reload();
  }

  return (
    <Section title="AI (Claude)">
      {data?.configured ? (
        <div className="form">
          <div className="info-box">
            ✓ Đã cài API key, đang dùng model <code>{data.model}</code>. Trang <b>Nhập bằng AI</b> đã sẵn sàng.
          </div>
          <ErrorBox error={error} />
          <div className="actions gap">
            <button className="btn" onClick={remove}>
              Gỡ API key
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          <ol className="howto">
            <li>
              Vào <b>console.anthropic.com</b> → <b>Billing</b>: nạp credit (vài USD là đủ dùng lâu với {data?.model ?? 'Haiku'}).
            </li>
            <li>
              <b>API keys</b> → <b>Create key</b>, đặt tên (VD: <i>project-tracker</i>), copy key dạng <code>sk-ant-…</code>.
            </li>
            <li>Dán vào ô dưới. Nên đặt giới hạn chi tiêu (Limits) trên console.</li>
          </ol>
          <label>
            API key Claude
            <input
              type="password"
              required
              autoComplete="off"
              value={apiKey}
              placeholder="sk-ant-…"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <small className="muted">Key được lưu trên máy chủ, không hiển thị lại. Chỉ PMO / quản lý thay hoặc gỡ được.</small>
          </label>
          <ErrorBox error={error} />
          <div className="actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Đang kiểm tra…' : 'Lưu API key'}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
