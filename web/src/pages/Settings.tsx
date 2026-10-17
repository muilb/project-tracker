import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, useApi } from '../api';
import { ErrorBox, MoreLess, Section } from '../components/ui';
import { l, lang } from '../i18n';
import { HEALTH_LABEL } from '../labels';
import { useSession } from '../session';
import type { AuditAction, AuditEntry } from '../../../api/src/types';
import { fmtDateTime } from '../format';
import type { Settings } from '../types';

/** AI key and Telegram bot as seen by PMO / managers: status only, changes are for ADMIN. */
function ReadOnlySecret({ title, status }: { title: string; status: string }) {
  return (
    <Section title={title}>
      <div className="info-box">{status}</div>
      <p className="muted">
        {l('Chỉ Quản trị hệ thống (ADMIN) mới cài hoặc đổi được.', '設定・変更できるのはシステム管理者（ADMIN）のみです。')}
      </p>
    </Section>
  );
}

const ACTION_LABEL: Record<AuditAction, string> = {
  role_change: l('Đổi vai trò', 'ロール変更'),
  admin_granted: l('Cấp ADMIN (ADMIN_EMAILS)', 'ADMIN 付与（ADMIN_EMAILS）'),
  user_create: l('Thêm người dùng', 'ユーザー追加'),
  account_approve: l('Duyệt tài khoản', 'アカウント承認'),
  account_reject: l('Từ chối tài khoản', 'アカウント却下'),
  password_reset: l('Đặt lại mật khẩu', 'パスワード再設定'),
  ai_key_set: l('Cài API key AI', 'AI の API キー設定'),
  ai_key_remove: l('Gỡ API key AI', 'AI の API キー削除'),
  telegram_set: l('Cài / đổi bot Telegram', 'Telegram ボット設定 / 変更'),
  telegram_remove: l('Gỡ bot Telegram', 'Telegram ボット削除'),
  project_delete: l('Xoá dự án', 'プロジェクト削除'),
  restore: l('Khôi phục từ thùng rác', 'ごみ箱から復元'),
};

/** Administrative log (ADMIN only). */
function AuditLog() {
  const { name } = useSession();
  const { data, error } = useApi<{ entries: AuditEntry[]; nextBefore?: string }>('/audit');
  const [older, setOlder] = useState<{ entries: AuditEntry[]; nextBefore?: string; busy?: boolean; loaded?: boolean }>({ entries: [] });
  const nextBefore = older.loaded ? older.nextBefore : data?.nextBefore;
  async function loadOlder() {
    if (!nextBefore) return;
    setOlder((o) => ({ ...o, busy: true }));
    try {
      const page = await api.get<{ entries: AuditEntry[]; nextBefore?: string }>(`/audit?before=${encodeURIComponent(nextBefore)}`);
      setOlder((o) => ({ entries: [...o.entries, ...page.entries], nextBefore: page.nextBefore, loaded: true }));
    } catch {
      setOlder((o) => ({ ...o, busy: false }));
    }
  }
  return (
    <Section title={l('Nhật ký quản trị', '操作ログ')}>
      <ErrorBox error={error} />
      {!data ? (
        <p className="loading">{l('Đang tải…', '読み込み中…')}</p>
      ) : data.entries.length === 0 ? (
        <p className="muted">{l('Chưa có thao tác nào.', '操作はまだありません。')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l('Thời gian', '日時')}</th>
                <th>{l('Người làm', '実行者')}</th>
                <th>{l('Thao tác', '操作')}</th>
                <th>{l('Đối tượng', '対象')}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.entries, ...older.entries].map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDateTime(e.at)}</td>
                  <td>{name(e.actor)}</td>
                  <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td>
                    {e.target}
                    {e.detail && <div className="muted">{e.detail}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <MoreLess
            onMore={nextBefore ? loadOlder : undefined}
            busy={older.busy}
            canLess={older.entries.length > 0}
            onLess={() => setOlder({ entries: [] })}
          />
        </div>
      )}
    </Section>
  );
}

export function SettingsPage() {
  const { isAdmin, isSystemAdmin } = useSession();
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
      <Section title="Microsoft Teams">
        <p className="muted">
          {l(
            'Teams không cần cài ở đây: mỗi kênh Teams có URL webhook riêng (tạo bằng Workflows trong Teams). Đăng ký hoặc đổi URL ở trang Kênh thông báo → ＋ Đăng ký kênh → Teams, hoặc nút Sửa của kênh.',
            'Teams はここで設定する必要はありません。Teams のチャネルごとに Workflows で作成した Webhook URL を使います。「通知チャネル → ＋ チャネル登録 → Teams」で登録し、URL の変更はチャネルの「編集」から行います。',
          )}
        </p>
        <div className="actions">
          <Link className="btn" to="/channels">
            {l('Mở Kênh thông báo', '通知チャネルを開く')}
          </Link>
        </div>
      </Section>
      <Section title={`🗑 ${l('Thùng rác', 'ごみ箱')}`}>
        <p className="muted">
          {l(
            'Dự án, cập nhật, vấn đề / sự kiện / mốc đã xoá được giữ lại và khôi phục được.',
            '削除したプロジェクト・報告・課題 / イベント / マイルストーンは保持され、復元できます。',
          )}
        </p>
        <div className="actions">
          <Link className="btn" to="/trash">
            {l('Mở thùng rác', 'ごみ箱を開く')}
          </Link>
        </div>
      </Section>
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
      {isSystemAdmin && <AuditLog />}
    </div>
  );
}

function TelegramSettings() {
  const { data, reload } = useApi<{ configured: boolean; username?: string }>('/settings/telegram');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState<string>();
  const { isSystemAdmin } = useSession();
  if (!isSystemAdmin)
    return (
      <ReadOnlySecret
        title={l('Bot Telegram', 'Telegram ボット')}
        status={
          data?.configured
            ? l(`✓ Đang dùng bot @${data.username}.`, `✓ ボット @${data.username} を使用中です。`)
            : l('Chưa cài bot Telegram.', 'Telegram ボットは未設定です。')
        }
      />
    );

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const before = data?.username;
      const r = await api.put<{ username: string }>('/settings/telegram', { token });
      setToken('');
      setChanging(false);
      setNotice(
        before && before !== r.username
          ? l(
              `Đã đổi sang bot @${r.username}. Thêm @${r.username} vào từng nhóm Telegram đang nhận thông báo (kênh nhận riêng: mở chat với bot và bấm Start), rồi bấm "Gửi thử" ở trang Kênh thông báo.`,
              `ボット @${r.username} に切り替えました。通知を受け取っている各 Telegram グループに @${r.username} を追加し（個人チャネルはボットとのチャットで Start）、「通知チャネル」画面で「テスト送信」してください。`,
            )
          : l('Đã lưu token mới.', '新しいトークンを保存しました。'),
      );
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
      {notice && <div className="info-box">{notice}</div>}
      {data?.configured && !changing ? (
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
            <button
              className="btn"
              onClick={() => {
                setChanging(true);
                setNotice(undefined);
              }}
            >
              {l('Đổi token', 'トークンを変更')}
            </button>
            <button className="btn" onClick={remove}>
              {l('Gỡ bot', 'ボットを削除')}
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          {changing && (
            <p className="muted">
              {l(
                `Cùng bot @${data?.username}, chỉ đổi token (gửi /revoke cho @BotFather): các nhóm vẫn nhận tin, không cần kết nối lại. Dán token của bot khác: phải thêm bot mới vào từng nhóm. Bot cũ vẫn chạy cho đến khi lưu token mới.`,
                `同じボット @${data?.username} のトークンだけを変更する場合（@BotFather に /revoke）、グループはそのまま通知を受け取れます。別のボットのトークンを貼り付けた場合は、新しいボットを各グループに追加してください。新しいトークンを保存するまでは現在のボットが動作します。`,
              )}
            </p>
          )}
          <ol className="howto" hidden={changing}>
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
          <div className="actions gap">
            {changing && (
              <button type="button" className="btn" onClick={() => setChanging(false)}>
                {l('Huỷ', 'キャンセル')}
              </button>
            )}
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
  const { isSystemAdmin } = useSession();
  if (!isSystemAdmin)
    return (
      <ReadOnlySecret
        title="AI (Claude)"
        status={
          data?.configured
            ? l(`✓ Đã cài API key, model ${data.model}.`, `✓ API キー設定済み（モデル ${data.model}）。`)
            : l('Chưa cài API key AI.', 'AI の API キーは未設定です。')
        }
      />
    );

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
