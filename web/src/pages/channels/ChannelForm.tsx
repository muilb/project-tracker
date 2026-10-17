import { useMemo, useState, type FormEvent } from 'react';
import { ALERT_EVENTS, type AlertEvent, type ChannelKind, type ChannelScope } from '../../../../api/src/types';
import { api, useApi } from '../../api';
import { ErrorBox } from '../../components/ui';
import { l, lang, type Lang } from '../../i18n';
import { LANG_LABEL, LANGS } from '../../labels';
import { useSession } from '../../session';
import type { ProjectView } from '../../types';
import { connectCode, forgetConnectCode, KindFields } from './KindFields';
import { ScheduleFields, type Timing } from './ScheduleFields';
import { EVENT_LABEL, KIND_LABEL, type BotStatus, type PublicChannel } from './shared';

export function ChannelForm({
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
  const { users, me } = useSession();
  const { data: projects } = useApi<{ projects: ProjectView[] }>('/projects');
  const [kind, setKind] = useState<ChannelKind>(channel?.kind ?? 'telegram');
  const [chName, setName] = useState(channel?.name ?? '');
  const [url, setUrl] = useState('');
  const code = useMemo(connectCode, []);
  const [regroup, setRegroup] = useState(false);
  const [scopeType, setScopeType] = useState<ChannelScope['type']>(channel?.scope.type ?? (me.role === 'GL' ? 'gl' : 'all'));
  const [gl, setGl] = useState(channel?.scope.gl ?? (me.role === 'GL' ? me.id : ''));
  const [picked, setPicked] = useState<string[]>(channel?.scope.projects ?? []);
  const [events, setEvents] = useState<AlertEvent[]>(channel?.events ?? [...ALERT_EVENTS]);
  const [timing, setTiming] = useState<Timing>({
    quietHours: channel?.quietHours ?? true,
    schedule: channel?.schedule,
    pausedUntil: channel?.pausedUntil,
  });
  const [msgLang, setMsgLang] = useState<Lang>(channel?.lang ?? lang);
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
        await api.patch(`/channels/${channel.id}`, {
          name: chName,
          scope,
          events,
          ...timing,
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
        await api.post('/channels', { kind, name: chName, scope, events, ...timing, lang: msgLang, ...target });
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

      <KindFields kind={kind} channel={channel} bot={bot} code={code} url={url} setUrl={setUrl} regroup={regroup} setRegroup={setRegroup} />

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
      <ScheduleFields value={timing} onChange={setTiming} />
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
