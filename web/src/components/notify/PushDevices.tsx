// track H: "Thông báo trên trình duyệt / điện thoại" on My notifications — enable on this device, my devices, remove.
import { useEffect, useState } from 'react';
import { useApi } from '../../api';
import { fmtDateTime } from '../../format';
import { l } from '../../i18n';
import { currentSubscription, enablePush, permission, pushSupport, removeDevice, subscriptionIdOf } from '../../push';
import { savePrefs, type MyPrefs } from './shared';

interface Device {
  id: string;
  label: string;
  createdAt: string;
  lastSentAt?: string;
  lastError?: string;
}

export function PushDevices({
  prefs,
  push,
  setPush,
  onEnabled,
}: {
  prefs: MyPrefs;
  /** Draft value of "send to my devices" (saved with the page). */
  push: boolean;
  setPush: (on: boolean) => void;
  onEnabled: (prefs: MyPrefs) => void;
}) {
  const { data, error: loadError, reload } = useApi<{ subscriptions: Device[] }>('/me/push/subscriptions');
  const [thisId, setThisId] = useState<string | null>();
  const [perm, setPerm] = useState(permission);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const support = pushSupport();
  const devices = data?.subscriptions ?? [];

  const refreshThis = () =>
    currentSubscription()
      .then((s) => (s ? subscriptionIdOf(s.endpoint) : null))
      .then(setThisId)
      .catch(() => setThisId(null));
  useEffect(() => {
    refreshThis();
  }, []);

  const onThisDevice = !!thisId && devices.some((d) => d.id === thisId);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPerm(permission());
      await refreshThis();
      reload();
    }
  }

  const enable = () =>
    run(async () => {
      const result = await enablePush(devices.map((d) => d.id));
      if (result !== 'granted') return;
      if (!prefs.push) onEnabled(await savePrefs(prefs, { push: true }));
      else setPush(true);
    });
  const remove = (d: Device) =>
    run(async () => {
      if (!window.confirm(l(`Gỡ thiết bị "${d.label}"?`, `デバイス「${d.label}」を削除しますか？`))) return;
      await removeDevice(d.id);
    });

  const status =
    support === 'ios-home-screen' ? (
      <span className="badge tone-yellow">
        <span aria-hidden>▲</span> {l('Cần thêm vào Màn hình chính', 'ホーム画面への追加が必要')}
      </span>
    ) : support === 'unsupported' ? (
      <span className="badge">
        <span aria-hidden>✕</span> {l('Trình duyệt không hỗ trợ', 'このブラウザは非対応')}
      </span>
    ) : perm === 'denied' ? (
      <span className="badge tone-red">
        <span aria-hidden>✕</span> {l('Đã bị chặn trên thiết bị này', 'この端末でブロック中')}
      </span>
    ) : onThisDevice ? (
      <span className="badge tone-green">
        <span aria-hidden>●</span> {l('Đã bật trên thiết bị này', 'この端末で有効')}
      </span>
    ) : (
      <span className="badge">
        <span aria-hidden>○</span> {l('Chưa bật trên thiết bị này', 'この端末では未設定')}
      </span>
    );

  return (
    <div className="notify-channel">
      <div className="notify-channel-head">
        <b>📱 {l('Thông báo trên trình duyệt / điện thoại', 'ブラウザ / スマートフォンへの通知')}</b>
        {status}
      </div>
      <p className="muted">
        {l(
          'Hiện thông báo của hệ thống trên máy tính hoặc điện thoại, kể cả khi không mở trang. Bật riêng cho từng thiết bị.',
          'ページを開いていなくても、PC やスマートフォンに通知を表示します。端末ごとに有効にします。',
        )}
      </p>

      {support === 'ios-home-screen' && (
        <p className="notify-unavailable">
          <span aria-hidden>▲</span>{' '}
          {l(
            'Trên iPhone / iPad (iOS 16.4 trở lên): mở trang này bằng Safari → nút Chia sẻ → "Thêm vào MH chính", rồi mở ứng dụng từ Màn hình chính và bật ở đây.',
            'iPhone / iPad（iOS 16.4 以降）: Safari でこのページを開き → 共有ボタン →「ホーム画面に追加」→ ホーム画面からアプリを開いて、ここで有効にしてください。',
          )}
        </p>
      )}
      {support === 'unsupported' && (
        <p className="notify-unavailable">
          <span aria-hidden>▲</span>{' '}
          {l(
            'Trình duyệt này không nhận được thông báo đẩy. Hãy dùng Chrome, Edge, Firefox hoặc Safari bản mới.',
            'このブラウザはプッシュ通知に対応していません。最新の Chrome、Edge、Firefox、Safari をお使いください。',
          )}
        </p>
      )}
      {support === 'ok' && perm === 'denied' && (
        <p className="notify-unavailable">
          <span aria-hidden>▲</span>{' '}
          {l(
            'Trình duyệt đang chặn thông báo của trang này. Bấm biểu tượng 🔒 cạnh địa chỉ trang → Thông báo → Cho phép, rồi tải lại trang.',
            'このページの通知はブラウザでブロックされています。アドレスバーの 🔒 → 通知 →「許可」にしてから、ページを再読み込みしてください。',
          )}
        </p>
      )}
      {support === 'ok' && perm !== 'denied' && !onThisDevice && thisId !== undefined && (
        <div className="actions gap">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={enable}>
            {busy ? l('Đang bật…', '設定中…') : l('Bật trên thiết bị này', 'この端末で有効にする')}
          </button>
          <span className="muted notify-when">{l('Trình duyệt sẽ hỏi quyền hiện thông báo.', 'ブラウザが通知の許可を求めます。')}</span>
        </div>
      )}

      {devices.length > 0 && (
        <>
          <label className="check">
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />{' '}
            {l('Gửi thông báo tới các thiết bị dưới đây', '以下の端末に通知を送る')}
          </label>
          <ul className="rows notify-devices">
            {devices.map((d) => (
              <li key={d.id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <b>{d.label}</b>
                    {d.id === thisId && (
                      <span className="badge tone-green">
                        <span aria-hidden>●</span> {l('Thiết bị này', 'この端末')}
                      </span>
                    )}
                    {d.lastError && (
                      <span className="badge tone-yellow" title={d.lastError}>
                        <span aria-hidden>▲</span> {l('Lần gửi gần nhất bị lỗi', '直近の送信に失敗')}
                      </span>
                    )}
                  </div>
                  <div className="muted notify-when">
                    {l('Thêm lúc', '追加')} {fmtDateTime(d.createdAt)}
                    {d.lastSentAt && ` · ${l('gửi gần nhất', '最終送信')} ${fmtDateTime(d.lastSentAt)}`}
                  </div>
                </div>
                <button type="button" className="btn" disabled={busy} onClick={() => remove(d)}>
                  {l('Gỡ', '削除')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {data && !devices.length && prefs.push && (
        <p className="muted">{l('Chưa có thiết bị nào được bật.', '有効な端末はまだありません。')}</p>
      )}
      {(error || loadError) && <div className="error-box">⚠ {error ?? loadError}</div>}
    </div>
  );
}
