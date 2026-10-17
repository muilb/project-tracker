import { api } from '../../api';
import { fmtDateTime } from '../../format';
import { l } from '../../i18n';
import { LANG_LABEL } from '../../labels';
import { useSession } from '../../session';
import { ChannelExtras, type ChannelFlags } from './ChannelExtras';
import { resolveSchedule } from './ScheduleFields';
import { EVENT_LABEL, KIND_LABEL, SAMPLE_LABEL, scopeLabel, type PublicChannel } from './shared';
import { TestSender } from './TestSender';

/** " · yên lặng 22h–7h" from the channel's schedule (legacy channels: the quietHours switch). */
function quietLabel(ch: PublicChannel) {
  const { quietFrom, quietTo } = resolveSchedule(ch);
  return quietFrom === quietTo ? '' : l(` · yên lặng ${quietFrom}h–${quietTo}h`, ` · 夜間停止 ${quietFrom}:00–${quietTo}:00`);
}

export function ChannelList({
  channels,
  onEdit,
  act,
  reload,
}: {
  channels: ChannelFlags[];
  onEdit: (ch: PublicChannel) => void;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  reload: () => void;
}) {
  const { name, isAdmin } = useSession();
  return (
    <ul className="rows">
      {channels.map((ch) => (
        <li key={ch.id} className="row">
          <div className="row-main">
            <div className="row-title">
              <span className="badge">{KIND_LABEL[ch.kind]}</span>
              <b>{ch.name}</b>
              <span className={`badge ${ch.enabled ? 'tone-green' : ''}`}>
                <span aria-hidden>{ch.enabled ? '●' : '○'}</span> {ch.enabled ? l('Đang bật', '有効') : l('Đã tắt', '無効')}
              </span>
              {ch.autoPausedAt && !ch.enabled && (
                <span className="badge tone-red" title={fmtDateTime(ch.autoPausedAt)}>
                  <span aria-hidden>■</span> {l('Tự tắt do gửi lỗi', '送信エラーで自動停止')}
                </span>
              )}
              {isAdmin && ch.orphan && (
                <span
                  className="badge tone-yellow"
                  title={l(
                    'Người phụ trách không còn tài khoản hoặc không xem được dự án trong phạm vi — hãy chuyển người phụ trách',
                    '担当者のアカウントがないか、範囲内のプロジェクトを閲覧できません。担当者を変更してください',
                  )}
                >
                  <span aria-hidden>▲</span> {l('Mồ côi', '担当者不在')}
                </span>
              )}
              <span className="muted">{scopeLabel(ch.scope, name)}</span>
            </div>
            <p className="row-text">{ch.events.map((e) => EVENT_LABEL[e].replace(/\s*[(（].*[)）]$/, '')).join(' · ')}</p>
            <small className="muted">
              {ch.kind === 'telegram'
                ? `${l('Nhóm Telegram', 'Telegram グループ')}: ${ch.telegramChatTitle ?? ch.telegramChatId}`
                : ch.webhookUrlMasked}{' '}
              · {l('tạo bởi', '作成者')} {name(ch.createdBy)} · {LANG_LABEL[ch.lang ?? 'vi']}
              {quietLabel(ch)}
              {ch.lastSentAt ? ` · ${l('gửi lần cuối', '最終送信')} ${fmtDateTime(ch.lastSentAt)}` : ''}
            </small>
            {ch.lastError && (
              <div className="warn">
                ⚠ {l('Lỗi gửi gần nhất', '直近の送信エラー')}: {ch.lastError}
                {ch.failCount ? l(` (${ch.failCount} tin lỗi liên tiếp)`, `（${ch.failCount} 件連続で失敗）`) : ''}
              </div>
            )}
            {ch.legacyWebhook && (
              <div className="warn">
                ▲{' '}
                {l(
                  'Webhook kiểu cũ (…webhook.office.com) — Microsoft đã ngừng. Tạo Workflow mới trong Teams rồi Sửa → dán URL mới.',
                  '旧形式の Webhook（…webhook.office.com）は Microsoft により廃止されました。Teams で新しい Workflow を作成し、編集 → 新しい URL を貼り付けてください。',
                )}
              </div>
            )}
            <ChannelExtras channel={ch} reload={reload} />
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
            <button className="btn" onClick={() => onEdit(ch)}>
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
  );
}
