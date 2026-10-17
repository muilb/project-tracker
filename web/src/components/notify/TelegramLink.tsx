// Personal Telegram on "My notifications": connect (t.me link → "I pressed Start"), status, unlink.
import { useState } from 'react';
import { api } from '../../api';
import { l } from '../../i18n';
import { useSession } from '../../session';
import { notAvailable, type MyPrefs, type TelegramLink } from './shared';

const UNAVAILABLE = () =>
  l(
    'Chức năng này chưa khả dụng — sẽ có trong bản cập nhật tới. Hộp thư web vẫn nhận thông báo bình thường.',
    'この機能はまだ利用できません（次回の更新で対応予定）。Web の受信箱には通常どおり届きます。',
  );

export function TelegramLinkFields({
  prefs,
  bot,
  telegram,
  setTelegram,
  onLinked,
}: {
  prefs: MyPrefs;
  bot?: string;
  /** Draft value of "also send to Telegram" (saved with the page). */
  telegram: boolean;
  setTelegram: (on: boolean) => void;
  onLinked: (prefs: MyPrefs) => void;
}) {
  const { isSystemAdmin } = useSession();
  const [link, setLink] = useState<TelegramLink>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      if (notAvailable(e)) setUnavailable(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const connect = () => run(async () => setLink(await api.post<TelegramLink>('/me/notify/telegram/link', {})));
  const confirm = () =>
    run(async () => {
      const r = await api.post<{ prefs: MyPrefs }>('/me/notify/telegram/confirm', { code: link?.code });
      setLink(undefined);
      onLinked(r.prefs);
    });
  const unlink = () =>
    run(async () => {
      if (!window.confirm(l('Gỡ liên kết Telegram cá nhân?', '個人の Telegram 連携を解除しますか？'))) return;
      const r = await api.del<{ prefs: MyPrefs }>('/me/notify/telegram');
      onLinked(r.prefs);
    });

  return (
    <div className="notify-channel">
      <div className="notify-channel-head">
        <b>Telegram</b>
        {prefs.telegramLinked ? (
          <span className="badge tone-green">
            <span aria-hidden>●</span> {l('Đã kết nối', '接続済み')}
          </span>
        ) : (
          <span className="badge">
            <span aria-hidden>○</span> {l('Chưa kết nối', '未接続')}
          </span>
        )}
      </div>

      {prefs.telegramLinked ? (
        <>
          <p className="muted">
            {l('Chat', 'チャット')}: <b>{prefs.telegramChatTitle ?? '—'}</b>
          </p>
          <label className="check">
            <input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} />{' '}
            {l('Gửi cả vào Telegram (ngoài hộp thư web)', 'Telegram にも送る（Web の受信箱に加えて）')}
          </label>
          <div className="actions gap">
            <button type="button" className="btn" disabled={busy} onClick={unlink}>
              {l('Gỡ liên kết', '連携を解除')}
            </button>
          </div>
        </>
      ) : !bot ? (
        <p className="muted">
          <span aria-hidden>▲</span> {l('Chưa cài bot Telegram.', 'Telegram ボットが未設定です。')}{' '}
          {isSystemAdmin
            ? l('Vào Cài đặt → Bot Telegram để cài.', '「設定 → Telegram ボット」で設定してください。')
            : l('Nhờ Quản trị hệ thống cài bot ở trang Cài đặt.', 'システム管理者に「設定」画面でボットを設定してもらってください。')}
        </p>
      ) : link ? (
        <ol className="howto">
          <li>
            <a className="btn btn-primary" href={link.url} target="_blank" rel="noreferrer">
              {l(`Mở @${bot} trong Telegram`, `Telegram で @${bot} を開く`)} ↗
            </a>{' '}
            {l('rồi bấm', 'を開き、')} <b>Start</b>
            {l('.', 'を押します。')}
            <div className="muted">
              {l('Không mở được? Gửi cho bot dòng', '開けない場合はボットに次の行を送信:')} <code>/start {link.code}</code>
            </div>
          </li>
          <li>
            <button type="button" className="btn" disabled={busy} onClick={confirm}>
              {busy ? l('Đang kiểm tra…', '確認中…') : l('Tôi đã bấm Start', 'Start を押しました')}
            </button>{' '}
            <span className="muted">{l('Bot sẽ gửi một tin thử vào chat riêng.', 'ボットが個人チャットにテストメッセージを送ります。')}</span>
          </li>
        </ol>
      ) : (
        <>
          <p className="muted">
            {l(
              `Nhận thông báo cá nhân qua chat riêng với @${bot}.`,
              `@${bot} との個人チャットで個人通知を受け取ります。`,
            )}
          </p>
          <div className="actions gap">
            <button type="button" className="btn" disabled={busy || unavailable} onClick={connect}>
              {l('Kết nối Telegram', 'Telegram に接続')}
            </button>
          </div>
        </>
      )}

      {unavailable && (
        <p className="notify-unavailable">
          <span aria-hidden>▲</span> {UNAVAILABLE()}
        </p>
      )}
      {error && <div className="error-box">⚠ {error}</div>}
    </div>
  );
}

/** "Gửi thử": one test message to the inbox (and Telegram when it is on). */
export function PersonalTest() {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'unavailable'>('idle');
  const [error, setError] = useState<string>();
  async function send() {
    setState('busy');
    setError(undefined);
    try {
      await api.post('/me/notify/test', {});
      setState('sent');
      window.dispatchEvent(new Event('inbox-changed'));
    } catch (e) {
      if (notAvailable(e)) setState('unavailable');
      else {
        setState('idle');
        setError((e as Error).message);
      }
    }
  }
  return (
    <div className="notify-test">
      <button type="button" className="btn" disabled={state === 'busy' || state === 'unavailable'} onClick={send}>
        {state === 'busy' ? l('Đang gửi…', '送信中…') : l('Gửi thử', 'テスト送信')}
      </button>
      {state === 'sent' && (
        <span className="notify-ok">
          <span aria-hidden>✓</span> {l('Đã gửi tin thử — xem ở 🔔', 'テストメッセージを送信しました — 🔔 で確認')}
        </span>
      )}
      {state === 'unavailable' && (
        <span className="notify-unavailable">
          <span aria-hidden>▲</span> {l('Gửi thử chưa khả dụng', 'テスト送信はまだ利用できません')}
        </span>
      )}
      {error && <span className="warn-text">⚠ {error}</span>}
    </div>
  );
}
