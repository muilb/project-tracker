import { useState } from 'react';
import { useApi } from '../../api';
import { Empty, ErrorBox } from '../../components/ui';
import { l } from '../../i18n';
import { ChannelForm } from './ChannelForm';
import { ChannelList } from './ChannelList';
import type { BotStatus, PublicChannel } from './shared';

export function ChannelsPage() {
  const { data, error, reload } = useApi<{ channels: PublicChannel[] }>('/channels');
  const bot = useApi<BotStatus>('/settings/telegram');
  const [editing, setEditing] = useState<PublicChannel | 'new' | null>(null);
  const [msg, setMsg] = useState<string>();
  const [actionError, setActionError] = useState<string>();

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
          <ChannelList channels={data.channels} onEdit={setEditing} act={act} reload={reload} />
        )}
      </section>
    </div>
  );
}
