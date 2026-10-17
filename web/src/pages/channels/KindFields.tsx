// Where a channel posts: Telegram group (connect code), Teams Workflows URL or Slack Incoming Webhook; and how detailed messages are.
import type { ChannelDetail, ChannelKind } from '../../../../api/src/types';
import { l, lang } from '../../i18n';
import { useSession } from '../../session';
import type { BotStatus, PublicChannel } from './shared';

const CODE_KEY = 'telegram-connect-code';
const CODE_TTL_MS = 24 * 3600_000; // Telegram keeps undelivered bot updates about 24h

/**
 * Connect code, kept in localStorage: on phones the browser often reloads the tab
 * while the user is in the Telegram app, and a new code would no longer match the
 * line already sent to the group.
 */
export function connectCode() {
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

export function forgetConnectCode() {
  try {
    localStorage.removeItem(CODE_KEY);
  } catch {
    // ignore
  }
}

export function KindFields({
  kind,
  channel,
  bot,
  code,
  url,
  setUrl,
  regroup,
  setRegroup,
  detail,
  setDetail,
}: {
  kind: ChannelKind;
  channel?: PublicChannel;
  bot?: BotStatus;
  code: string;
  url: string;
  setUrl: (url: string) => void;
  /** Editing a Telegram channel: move it to another group with a new connect line. */
  regroup: boolean;
  setRegroup: (on: boolean) => void;
  detail: ChannelDetail;
  setDetail: (d: ChannelDetail) => void;
}) {
  const { isSystemAdmin } = useSession();
  const connectLine = `/connect@${bot?.username ?? 'bot'} ${code}`;
  const telegramBlocked = !channel && kind === 'telegram' && bot && !bot.configured;
  return (
    <>
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

      {kind === 'slack' && (
        <label>
          {l('URL Incoming Webhook của Slack', 'Slack の Incoming Webhook URL')}{' '}
          {channel && (
            <small className="muted">
              {l(`(để trống = giữ URL hiện tại: ${channel.webhookUrlMasked})`, `（空欄 = 現在の URL のまま: ${channel.webhookUrlMasked}）`)}
            </small>
          )}
          <input
            type="url"
            required={!channel}
            value={url}
            placeholder="https://hooks.slack.com/services/…"
            onChange={(e) => setUrl(e.target.value)}
          />
          {!channel && (
            <ol className="howto">
              <li>
                {lang === 'ja' ? (
                  <>
                    api.slack.com/apps で <b>Create New App</b> → <b>From scratch</b>（ワークスペースを選択）。
                  </>
                ) : (
                  <>
                    Vào api.slack.com/apps → <b>Create New App</b> → <b>From scratch</b> (chọn workspace).
                  </>
                )}
              </li>
              <li>
                {lang === 'ja' ? (
                  <>
                    <b>Incoming Webhooks</b> をオン → <b>Add New Webhook to Workspace</b>。
                  </>
                ) : (
                  <>
                    Bật <b>Incoming Webhooks</b> → <b>Add New Webhook to Workspace</b>.
                  </>
                )}
              </li>
              <li>{l('Chọn kênh Slack muốn nhận thông báo → Allow.', '通知を受け取る Slack チャネルを選択 → Allow。')}</li>
              <li>
                {l(
                  'Copy URL (https://hooks.slack.com/services/…) và dán vào ô trên. URL này như mật khẩu: không chia sẻ.',
                  'URL（https://hooks.slack.com/services/…）をコピーして上の欄に貼り付けます。この URL はパスワードと同じです。共有しないでください。',
                )}
              </li>
            </ol>
          )}
          {channel && (
            <small className="muted">{l('Đổi URL sẽ gửi tin thử trước khi lưu.', 'URL を変更すると、保存前にテストメッセージを送信します。')}</small>
          )}
        </label>
      )}

      <label>
        {l('Mức chi tiết của tin', 'メッセージの詳細度')}
        <select value={detail} onChange={(e) => setDetail(e.target.value as ChannelDetail)}>
          <option value="full">{l('Đầy đủ', '詳細')}</option>
          <option value="compact">{l('Rút gọn', '簡易')}</option>
        </select>
        <small className="muted">
          {l(
            'Rút gọn: không gửi nội dung người dùng nhập (tóm tắt, cần hỗ trợ, ghi chú, tên mục), chỉ mã và tên dự án, trạng thái, hạn, số lượng và link. Dùng cho kênh có người ngoài. PMO có thể bắt buộc rút gọn cho mọi kênh (Cài đặt).',
            '簡易: ユーザーが入力した内容（報告内容、支援依頼、メモ、項目名）を送らず、プロジェクトのコードと名前、状態、期限、件数、リンクのみ送ります。外部の人がいるチャネル向けです。PMO はすべてのチャネルを簡易に固定できます（設定）。',
          )}
        </small>
      </label>
    </>
  );
}
