import { useMemo, useState, type FormEvent } from 'react';
import { ALERT_EVENTS, type AlertEvent, type Channel, type ChannelKind, type ChannelScope } from '../../../api/src/types';
import { api, useApi } from '../api';
import { Empty, ErrorBox, Section } from '../components/ui';
import { fmtDateTime } from '../format';
import { l, lang, type Lang } from '../i18n';
import { LANG_LABEL, LANGS } from '../labels';
import { useSession } from '../session';
import type { TestSample } from '../../../api/src/notify/alerts';
import type { ProjectView } from '../types';

type PublicChannel = Omit<Channel, 'webhookUrl'> & { webhookUrlMasked?: string };
type BotStatus = { configured: boolean; username?: string };

const EVENT_LABEL: Record<AlertEvent, string> = {
  became_red: l('Dự án chuyển sang Đỏ (ngay lập tức)', 'プロジェクトが「赤」に（即時）'),
  high_issue: l('Vấn đề ưu tiên Cao mới (ngay lập tức)', '優先度「高」の新しい課題（即時）'),
  overdue: l('Mục quá hạn (mỗi ngày một lần)', '期限超過の項目（1 日 1 回）'),
  late_update: l('Trễ cập nhật (nhắc mỗi 24 giờ)', '報告遅れ（24 時間ごとにリマインド）'),
  milestone_soon: l('Mốc / sự kiện vào ngày mai', '明日のマイルストーン / イベント'),
  daily_digest: l('Tóm tắt lúc 8h sáng', '朝 8 時のサマリー'),
};
const KIND_LABEL: Record<ChannelKind, string> = { telegram: 'Telegram', teams: 'Teams' };

const SAMPLE_LABEL: Record<TestSample, string> = {
  connect: l('Tin kết nối', '接続メッセージ'),
  became_red: l('Mẫu: dự án chuyển Đỏ', 'サンプル: プロジェクトが「赤」に'),
  high_issue: l('Mẫu: vấn đề ưu tiên Cao', 'サンプル: 優先度「高」の課題'),
  hourly: l('Mẫu: nhắc mỗi giờ', 'サンプル: 毎時リマインド'),
  daily_digest: l('Mẫu: tóm tắt 8h sáng', 'サンプル: 朝 8 時のサマリー'),
};

/** "Gửi thử" with a choice of sample: real alert formats filled with the channel's current data. */
function TestSender({ onSend }: { onSend: (sample: TestSample) => Promise<void> }) {
  const [sample, setSample] = useState<TestSample>('connect');
  const [busy, setBusy] = useState(false);
  return (
    <div className="test-sender">
      <select
        aria-label={l('Mẫu tin thử', 'テストメッセージの種類')}
        value={sample}
        onChange={(e) => setSample(e.target.value as TestSample)}
      >
        {(Object.keys(SAMPLE_LABEL) as TestSample[]).map((k) => (
          <option key={k} value={k}>
            {SAMPLE_LABEL[k]}
          </option>
        ))}
      </select>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onSend(sample);
          setBusy(false);
        }}
      >
        {busy ? l('Đang gửi…', '送信中…') : l('Gửi thử', 'テスト送信')}
      </button>
    </div>
  );
}

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
        <h1>{l('Kênh thông báo', '通知チャネル')}</h1>
        {!editing && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            {l('＋ Đăng ký kênh', '＋ チャネル登録')}
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
          <p className="loading">{l('Đang tải…', '読み込み中…')}</p>
        ) : data.channels.length === 0 ? (
          <Empty>
            {l(
              'Chưa có kênh nào. Bấm “Đăng ký kênh” để nhận cảnh báo qua Telegram hoặc Teams.',
              'チャネルはまだありません。「チャネル登録」から Telegram または Teams でアラートを受け取れます。',
            )}
          </Empty>
        ) : (
          <ul className="rows">
            {data.channels.map((ch) => (
              <li key={ch.id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="badge">{KIND_LABEL[ch.kind]}</span>
                    <b>{ch.name}</b>
                    <span className={`badge ${ch.enabled ? 'tone-green' : ''}`}>
                      <span aria-hidden>{ch.enabled ? '●' : '○'}</span> {ch.enabled ? l('Đang bật', '有効') : l('Đã tắt', '無効')}
                    </span>
                    <span className="muted">{scopeLabel(ch.scope, name)}</span>
                  </div>
                  <p className="row-text">{ch.events.map((e) => EVENT_LABEL[e].replace(/\s*[(（].*[)）]$/, '')).join(' · ')}</p>
                  <small className="muted">
                    {ch.kind === 'telegram'
                      ? `${l('Nhóm Telegram', 'Telegram グループ')}: ${ch.telegramChatTitle ?? ch.telegramChatId}`
                      : ch.webhookUrlMasked}{' '}
                    · {l('tạo bởi', '作成者')} {name(ch.createdBy)} · {LANG_LABEL[ch.lang ?? 'vi']}
                    {ch.quietHours ? l(' · yên lặng 22h–7h', ' · 夜間停止 22:00–07:00') : ''}
                    {ch.lastSentAt ? ` · ${l('gửi lần cuối', '最終送信')} ${fmtDateTime(ch.lastSentAt)}` : ''}
                  </small>
                  {ch.lastError && (
                    <div className="warn">
                      ⚠ {l('Lỗi gửi gần nhất', '直近の送信エラー')}: {ch.lastError}
                    </div>
                  )}
                </div>
                <div className="row-side actions-col">
                  <TestSender
                    onSend={(sample) =>
                      act(
                        () => api.post(`/channels/${ch.id}/test`, { sample }),
                        l(`Đã gửi "${SAMPLE_LABEL[sample]}" tới "${ch.name}"`, `「${ch.name}」に「${SAMPLE_LABEL[sample]}」を送信しました`),
                      )
                    }
                  />
                  <button className="btn" onClick={() => setEditing(ch)}>
                    {l('Sửa', '編集')}
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      act(
                        () => api.patch(`/channels/${ch.id}`, { enabled: !ch.enabled }),
                        ch.enabled ? l('Đã tắt kênh', 'チャネルを無効にしました') : l('Đã bật kênh', 'チャネルを有効にしました'),
                      )
                    }
                  >
                    {ch.enabled ? l('Tắt', '無効化') : l('Bật', '有効化')}
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      confirm(l(`Xoá kênh "${ch.name}"?`, `チャネル「${ch.name}」を削除しますか？`)) &&
                      act(() => api.del(`/channels/${ch.id}`), l(`Đã xoá kênh "${ch.name}"`, `チャネル「${ch.name}」を削除しました`))
                    }
                  >
                    {l('Xoá', '削除')}
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
  if (scope.type === 'gl') return l(`Nhóm GL ${name(scope.gl)}`, `GL ${name(scope.gl)} のチーム`);
  if (scope.type === 'projects') return `${l('Dự án', 'プロジェクト')}: ${(scope.projects ?? []).join(', ')}`;
  return l('Tất cả dự án', 'すべてのプロジェクト');
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
  const { users, me, isSystemAdmin } = useSession();
  const { data: projects } = useApi<{ projects: ProjectView[] }>('/projects');
  const [kind, setKind] = useState<ChannelKind>(channel?.kind ?? 'telegram');
  const [chName, setName] = useState(channel?.name ?? '');
  const [url, setUrl] = useState('');
  const code = useMemo(connectCode, []);
  /** Editing a Telegram channel: move it to another group with a new connect line. */
  const [regroup, setRegroup] = useState(false);
  const [scopeType, setScopeType] = useState<ChannelScope['type']>(channel?.scope.type ?? (me.role === 'GL' ? 'gl' : 'all'));
  const [gl, setGl] = useState(channel?.scope.gl ?? (me.role === 'GL' ? me.id : ''));
  const [picked, setPicked] = useState<string[]>(channel?.scope.projects ?? []);
  const [events, setEvents] = useState<AlertEvent[]>(channel?.events ?? [...ALERT_EVENTS]);
  const [quietHours, setQuiet] = useState(channel?.quietHours ?? true);
  const [msgLang, setMsgLang] = useState<Lang>(channel?.lang ?? lang);
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
        await api.patch(`/channels/${channel.id}`, {
          name: chName,
          scope,
          events,
          quietHours,
          lang: msgLang,
          ...(url ? { webhookUrl: url } : {}),
          ...(regroup ? { connectCode: code } : {}),
        });
        if (regroup) forgetConnectCode();
        onSaved(
          regroup
            ? l(
                `Đã chuyển "${chName}" sang nhóm mới — kiểm tra tin thử trong Telegram`,
                `「${chName}」を新しいグループに移しました — Telegram でテストメッセージを確認してください`,
              )
            : l(`Đã lưu kênh "${chName}"`, `チャネル「${chName}」を保存しました`),
        );
      } else {
        const target = kind === 'telegram' ? { connectCode: code } : { webhookUrl: url };
        await api.post('/channels', { kind, name: chName, scope, events, quietHours, lang: msgLang, ...target });
        if (kind === 'telegram') forgetConnectCode();
        onSaved(
          l(
            `Đã kết nối "${chName}" — kiểm tra tin thử trong ${KIND_LABEL[kind]}`,
            `「${chName}」を接続しました — ${KIND_LABEL[kind]} でテストメッセージを確認してください`,
          ),
        );
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
      <h2>
        {channel ? l(`Sửa kênh "${channel.name}"`, `チャネル「${channel.name}」を編集`) : l('Đăng ký kênh thông báo', '通知チャネルの登録')}
      </h2>

      {!channel && (
        <div className="segmented" role="group" aria-label={l('Loại kênh', 'チャネルの種類')}>
          {(['telegram', 'teams'] as ChannelKind[]).map((k) => (
            <button type="button" key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      <label>
        {l('Tên kênh (để nhận biết)', 'チャネル名（識別用）')}
        <input
          required
          value={chName}
          placeholder={l('VD: Nhóm Hùng – dự án', '例: Hùng チーム – プロジェクト')}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {channel && (
        <p className="muted">
          {l(
            'Loại kênh (Telegram / Teams) không đổi được. Muốn chuyển loại, đăng ký kênh mới rồi xoá kênh này.',
            'チャネルの種類（Telegram / Teams）は変更できません。種類を変える場合は新しいチャネルを登録し、このチャネルを削除してください。',
          )}
        </p>
      )}

      {channel && kind === 'telegram' && !regroup && (
        <div className="row-title">
          <span>
            {l('Nhóm Telegram', 'Telegram グループ')}: <b>{channel.telegramChatTitle ?? channel.telegramChatId}</b>
          </span>
          <button type="button" className="btn" onClick={() => setRegroup(true)}>
            {l('Đổi sang nhóm khác', '別のグループに変更')}
          </button>
        </div>
      )}

      {(!channel || regroup) && kind === 'telegram' && (
        <fieldset>
          <legend>
            {regroup ? l('Đổi nhóm Telegram', 'Telegram グループの変更') : l('Kết nối nhóm Telegram', 'Telegram グループに接続')}
          </legend>
          {telegramBlocked ? (
            <div className="error-box">
              {l('Chưa cài bot Telegram.', 'Telegram ボットが未設定です。')}{' '}
              {isSystemAdmin ? (
                lang === 'ja' ? (
                  <>
                    <a href="/settings">設定 → Telegram ボット</a>で設定してください。
                  </>
                ) : (
                  <>
                    Vào <a href="/settings">Cài đặt → Bot Telegram</a> để cài.
                  </>
                )
              ) : (
                l('Nhờ Quản trị hệ thống cài bot ở trang Cài đặt.', 'システム管理者に「設定」画面でボットを設定してもらってください。')
              )}
            </div>
          ) : (
            <ol className="howto">
              <li>
                {lang === 'ja' ? (
                  <>
                    Telegram で通知を受け取るグループを開き → <b>Add members</b> → <b>@{bot?.username}</b>{' '}
                    を追加します。（自分だけで受け取る場合は @{bot?.username} とのチャットを開いて <b>Start</b> を押します。）
                  </>
                ) : (
                  <>
                    Trong Telegram, mở nhóm muốn nhận thông báo → <b>Add members</b> → thêm <b>@{bot?.username}</b>. (Muốn nhận riêng cho
                    mình thì mở chat với @{bot?.username} và bấm <b>Start</b>.)
                  </>
                )}
              </li>
              <li>
                {l('Gửi vào nhóm đúng dòng sau:', 'グループに次の 1 行をそのまま送信します:')}
                <div className="copy-line">
                  <code>{connectLine}</code>
                  <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(connectLine)}>
                    {l('Copy', 'コピー')}
                  </button>
                </div>
              </li>
              <li>
                {lang === 'ja' ? (
                  <>
                    この画面に戻り、<b>{regroup ? '保存してテスト送信' : '接続してテスト送信'}</b>を押します。
                  </>
                ) : (
                  <>
                    Quay lại đây, bấm <b>{regroup ? 'Lưu & gửi tin thử' : 'Kết nối & gửi tin thử'}</b>.
                  </>
                )}
              </li>
            </ol>
          )}
        </fieldset>
      )}

      {kind === 'teams' && (
        <label>
          {l('URL webhook của Teams Workflows', 'Teams Workflows の Webhook URL')}{' '}
          {channel && (
            <small className="muted">
              {l(`(để trống = giữ URL hiện tại: ${channel.webhookUrlMasked})`, `（空欄 = 現在の URL のまま: ${channel.webhookUrlMasked}）`)}
            </small>
          )}
          <input
            type="url"
            required={!channel}
            value={url}
            placeholder="https://…logic.azure.com/workflows/…"
            onChange={(e) => setUrl(e.target.value)}
          />
          {!channel && (
            <small className="muted">
              {l(
                'Trong kênh Teams: ⋯ → Workflows → mẫu “Send webhook alerts to a channel” → Save → copy URL. Cần quyền Power Automate.',
                'Teams のチャネルで ⋯ → Workflows → テンプレート「Send webhook alerts to a channel」→ Save → URL をコピー。Power Automate の権限が必要です。',
              )}
            </small>
          )}
        </label>
      )}

      <fieldset>
        <legend>{l('Phạm vi dự án', '対象範囲')}</legend>
        <div className="checks">
          <label className="check">
            <input type="radio" name="scope" checked={scopeType === 'all'} onChange={() => setScopeType('all')} />{' '}
            {l('Tất cả dự án', 'すべてのプロジェクト')}
          </label>
          <label className="check">
            <input type="radio" name="scope" checked={scopeType === 'gl'} onChange={() => setScopeType('gl')} /> {l('Theo nhóm GL', 'GL別')}
          </label>
          <label className="check">
            <input type="radio" name="scope" checked={scopeType === 'projects'} onChange={() => setScopeType('projects')} />{' '}
            {l('Chọn dự án', 'プロジェクトを選択')}
          </label>
        </div>
        {scopeType === 'gl' && (
          <select required value={gl} onChange={(e) => setGl(e.target.value)} aria-label="GL">
            <option value="">{l('— chọn GL —', '— GL を選択 —')}</option>
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
                <input
                  type="checkbox"
                  checked={picked.includes(p.id)}
                  onChange={(e) => setPicked(toggle(picked, p.id, e.target.checked))}
                />
                {p.id} · {p.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>{l('Nhận thông báo khi', '通知するタイミング')}</legend>
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
        <input type="checkbox" checked={quietHours} onChange={(e) => setQuiet(e.target.checked)} />{' '}
        {l(
          'Không gửi nhắc nhở từ 22h đến 7h (cảnh báo Đỏ và vấn đề Cao vẫn gửi ngay)',
          '夜間停止: 22:00〜07:00 はリマインドを送らない（「赤」と優先度「高」の課題は即時送信）',
        )}
      </label>
      <label>
        {l('Ngôn ngữ tin nhắn', 'メッセージの言語')}
        <select value={msgLang} onChange={(e) => setMsgLang(e.target.value as Lang)}>
          {LANGS.map((k) => (
            <option key={k} value={k}>
              {LANG_LABEL[k]}
            </option>
          ))}
        </select>
      </label>

      <ErrorBox error={error} />
      <div className="actions gap">
        <button type="button" className="btn" onClick={onCancel}>
          {l('Huỷ', 'キャンセル')}
        </button>
        <button className="btn btn-primary" disabled={busy || !!telegramBlocked}>
          {busy
            ? l('Đang gửi tin thử…', 'テスト送信中…')
            : regroup
              ? l('Lưu & gửi tin thử', '保存してテスト送信')
              : channel
                ? l('Lưu', '保存')
                : l('Kết nối & gửi tin thử', '接続してテスト送信')}
        </button>
      </div>
    </form>
  );
}
