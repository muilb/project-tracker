// Per-channel extras under each row (track C: delivery log, transfer to another owner).
import { useEffect, useState, type FormEvent } from 'react';
import type { DeliveryLog } from '../../../../api/src/types';
import { api } from '../../api';
import { fmtDateTime } from '../../format';
import { l } from '../../i18n';
import { useSession } from '../../session';
import type { PublicChannel } from './shared';

/** Fields the channels API adds for track C. */
export type ChannelFlags = PublicChannel & { legacyWebhook?: boolean; orphan?: boolean };

export function ChannelExtras({ channel, reload }: { channel: PublicChannel; reload: () => void }) {
  const [open, setOpen] = useState<'log' | 'transfer' | null>(null);
  return (
    <div className="stack" style={{ gap: '0.4rem', marginTop: '0.4rem' }}>
      <div className="actions">
        <button className="btn" aria-expanded={open === 'log'} onClick={() => setOpen(open === 'log' ? null : 'log')}>
          {open === 'log' ? '▾' : '▸'} {l('Nhật ký gửi', '送信履歴')}
        </button>
        <button
          className="btn"
          aria-expanded={open === 'transfer'}
          onClick={() => setOpen(open === 'transfer' ? null : 'transfer')}
        >
          {open === 'transfer' ? '▾' : '▸'} {l('Chuyển người phụ trách', '担当者を変更')}
        </button>
      </div>
      {open === 'log' && <DeliveryLogList channelId={channel.id} />}
      {open === 'transfer' && (
        <TransferForm
          channel={channel}
          onDone={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DeliveryLogList({ channelId }: { channelId: string }) {
  const [rows, setRows] = useState<DeliveryLog[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .get<{ deliveries: DeliveryLog[] }>(`/channels/${channelId}/deliveries`)
      .then((r) => setRows(r.deliveries))
      .catch((e: Error) => setError(e.message));
  }, [channelId]);
  if (error) return <div className="warn">⚠ {error}</div>;
  if (!rows) return <p className="loading">{l('Đang tải…', '読み込み中…')}</p>;
  if (rows.length === 0) return <p className="muted">{l('Chưa có lần gửi nào trong 30 ngày qua.', '過去 30 日間の送信はありません。')}</p>;
  return (
    <ul className="rows" aria-label={l('20 lần gửi gần nhất', '直近 20 件の送信')}>
      {rows.map((d) => (
        <li key={`${d.at}#${d.id}`} className="row" style={{ padding: '0.3rem 0' }}>
          <div className="row-main">
            <small>
              <span className={`badge ${d.ok ? 'tone-green' : 'tone-red'}`}>
                <span aria-hidden>{d.ok ? '●' : '■'}</span> {d.ok ? l('Đã gửi', '送信済み') : l('Lỗi', 'エラー')}
              </span>{' '}
              {fmtDateTime(d.at)} · {d.title}
            </small>
            {d.error && <div className="warn">{d.error}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TransferForm({ channel, onDone }: { channel: PublicChannel; onDone: () => void }) {
  const { users, name } = useSession();
  const [to, setTo] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const others = users.filter((u) => u.id !== channel.createdBy).sort((a, b) => a.name.localeCompare(b.name));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/channels/${channel.id}/transfer`, { to });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: '0.4rem' }} onSubmit={submit}>
      <p className="muted">
        {l(
          `Đang phụ trách: ${name(channel.createdBy)}. Người nhận phải có tài khoản đăng nhập; họ sẽ sửa / xoá được kênh này.`,
          `現在の担当者：${name(channel.createdBy)}。新しい担当者はログインアカウントが必要です。このチャネルを編集 / 削除できるようになります。`,
        )}
      </p>
      <div className="actions">
        <select required value={to} onChange={(e) => setTo(e.target.value)} aria-label={l('Người phụ trách mới', '新しい担当者')}>
          <option value="">{l('— Chọn người —', '— 選択 —')}</option>
          {others.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.id})
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!to || busy}>
          {l('Chuyển', '変更')}
        </button>
      </div>
      {error && <div className="warn">⚠ {error}</div>}
    </form>
  );
}
