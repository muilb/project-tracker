import { useEffect, useState, type FormEvent } from 'react';
import { api, useApi } from '../api';
import { ErrorBox, Section } from '../components/ui';
import { l, lang } from '../i18n';
import { HEALTH_LABEL } from '../labels';
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

  if (!isAdmin) return <ErrorBox error={l('Chỉ PMO / quản lý mới sửa cài đặt', '設定の変更は PMO / 管理者のみ行えます')} />;
  if (!s) return error ? <ErrorBox error={error} /> : <p className="loading">{l('Đang tải…', '読み込み中…')}</p>;

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
      <h1>{l('Cài đặt', '設定')}</h1>
      <AiSettings />
      <TelegramSettings />
      <form className="card form" onSubmit={submit}>
        <fieldset>
          <legend>{l('Tần suất cập nhật theo trạng thái (giờ)', '状態別の報告頻度（時間）')}</legend>
          <div className="form-grid">
            {(['green', 'yellow', 'red'] as const).map((h) => (
              <label key={h}>
                {HEALTH_LABEL[h]}
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
            {l('Cảnh báo "sắp tới" khi còn ≤ (ngày)', '「間近」と警告する残り日数（≤ 日）')}
            <input type="number" min={0} required value={s.soonDays} onChange={(e) => setS({ ...s, soonDays: num(e.target.value) })} />
          </label>
          <label>
            {l('Tần suất khi mốc / sự kiện sắp tới (giờ)', 'マイルストーン / イベント間近の報告頻度（時間）')}
            <input
              type="number"
              min={1}
              required
              value={s.nearEventFrequencyHours}
              onChange={(e) => setS({ ...s, nearEventFrequencyHours: num(e.target.value) })}
            />
          </label>
          <label>
            {l('Danh sách "sắp tới" trên dashboard (ngày)', 'ダッシュボードの「近日」一覧（日）')}
            <input
              type="number"
              min={1}
              required
              value={s.upcomingDays}
              onChange={(e) => setS({ ...s, upcomingDays: num(e.target.value) })}
            />
          </label>
        </div>
        <ErrorBox error={error} />
        {saved && <div className="info-box">{l('Đã lưu.', '保存しました。')}</div>}
        <div className="actions">
          <button className="btn btn-primary">{l('Lưu cài đặt', '設定を保存')}</button>
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
    if (
      !confirm(
        l(
          'Gỡ bot Telegram? Các kênh Telegram sẽ ngừng nhận thông báo.',
          'Telegram ボットを削除しますか？ Telegram チャネルへの通知が止まります。',
        ),
      )
    )
      return;
    await api.del('/settings/telegram').catch((e: Error) => setError(e.message));
    reload();
  }

  return (
    <Section title={l('Bot Telegram', 'Telegram ボット')}>
      {data?.configured ? (
        <div className="form">
          <div className="info-box">
            {lang === 'ja' ? (
              <>
                ✓ ボット <b>@{data.username}</b> を使用中です。Telegram グループは各自<b>通知チャネル</b>画面で登録します。
              </>
            ) : (
              <>
                ✓ Đang dùng bot <b>@{data.username}</b>. Mọi người đăng ký nhóm Telegram ở trang <b>Kênh thông báo</b>.
              </>
            )}
          </div>
          <div className="actions gap">
            <button className="btn" onClick={remove}>
              {l('Gỡ bot', 'ボットを削除')}
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          <ol className="howto">
            <li>
              {lang === 'ja' ? (
                <>
                  Telegram で <b>@BotFather</b> とのチャットを開き、<code>/newbot</code> を送信します。
                </>
              ) : (
                <>
                  Mở Telegram, chat với <b>@BotFather</b>, gửi <code>/newbot</code>.
                </>
              )}
            </li>
            <li>
              {lang === 'ja' ? (
                <>
                  表示名（例: <i>プロジェクト管理</i>）と、<code>bot</code> で終わるユーザー名（例: <code>brycen_duan_bot</code>
                  ）を決めます。
                </>
              ) : (
                <>
                  Đặt tên hiển thị (VD: <i>Theo dõi dự án</i>) và username kết thúc bằng <code>bot</code> (VD: <code>brycen_duan_bot</code>
                  ).
                </>
              )}
            </li>
            <li>
              {lang === 'ja' ? (
                <>
                  BotFather から <code>123456789:AA…</code> 形式の<b>トークン</b>が届くので、下の欄に貼り付けます。
                </>
              ) : (
                <>
                  BotFather trả về <b>token</b> dạng <code>123456789:AA…</code> — dán vào ô dưới.
                </>
              )}
            </li>
          </ol>
          <label>
            {l('Token của bot', 'ボットのトークン')}
            <input
              type="password"
              required
              autoComplete="off"
              value={token}
              placeholder="123456789:AA…"
              onChange={(e) => setToken(e.target.value)}
            />
            <small className="muted">
              {l(
                'Token được lưu trên máy chủ, không hiển thị lại. Chỉ PMO / quản lý thay hoặc gỡ được.',
                'トークンはサーバーに保存され、再表示されません。変更・削除は PMO / 管理者のみ行えます。',
              )}
            </small>
          </label>
          <ErrorBox error={error} />
          <div className="actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? l('Đang kiểm tra…', '確認中…') : l('Lưu bot', 'ボットを保存')}
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
    if (!confirm(l('Gỡ API key? Trang "Nhập bằng AI" sẽ ngừng hoạt động.', 'API キーを削除しますか？「AI入力」画面が使えなくなります。')))
      return;
    await api.del('/settings/ai').catch((e: Error) => setError(e.message));
    reload();
  }

  return (
    <Section title="AI (Claude)">
      {data?.configured ? (
        <div className="form">
          <div className="info-box">
            {lang === 'ja' ? (
              <>
                ✓ API キー設定済み、モデル <code>{data.model}</code> を使用中です。<b>AI入力</b>画面を利用できます。
              </>
            ) : (
              <>
                ✓ Đã cài API key, đang dùng model <code>{data.model}</code>. Trang <b>Nhập bằng AI</b> đã sẵn sàng.
              </>
            )}
          </div>
          <ErrorBox error={error} />
          <div className="actions gap">
            <button className="btn" onClick={remove}>
              {l('Gỡ API key', 'API キーを削除')}
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          <ol className="howto">
            <li>
              {lang === 'ja' ? (
                <>
                  <b>console.anthropic.com</b> → <b>Billing</b> でクレジットをチャージします（{data?.model ?? 'Haiku'}{' '}
                  なら数ドルで長く使えます）。
                </>
              ) : (
                <>
                  Vào <b>console.anthropic.com</b> → <b>Billing</b>: nạp credit (vài USD là đủ dùng lâu với {data?.model ?? 'Haiku'}).
                </>
              )}
            </li>
            <li>
              {lang === 'ja' ? (
                <>
                  <b>API keys</b> → <b>Create key</b> で名前（例: <i>project-tracker</i>）を付け、<code>sk-ant-…</code>{' '}
                  形式のキーをコピーします。
                </>
              ) : (
                <>
                  <b>API keys</b> → <b>Create key</b>, đặt tên (VD: <i>project-tracker</i>), copy key dạng <code>sk-ant-…</code>.
                </>
              )}
            </li>
            <li>
              {l(
                'Dán vào ô dưới. Nên đặt giới hạn chi tiêu (Limits) trên console.',
                '下の欄に貼り付けます。console で利用上限（Limits）の設定をおすすめします。',
              )}
            </li>
          </ol>
          <label>
            {l('API key Claude', 'Claude の API キー')}
            <input
              type="password"
              required
              autoComplete="off"
              value={apiKey}
              placeholder="sk-ant-…"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <small className="muted">
              {l(
                'Key được lưu trên máy chủ, không hiển thị lại. Chỉ PMO / quản lý thay hoặc gỡ được.',
                'キーはサーバーに保存され、再表示されません。変更・削除は PMO / 管理者のみ行えます。',
              )}
            </small>
          </label>
          <ErrorBox error={error} />
          <div className="actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? l('Đang kiểm tra…', '確認中…') : l('Lưu API key', 'API キーを保存')}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
