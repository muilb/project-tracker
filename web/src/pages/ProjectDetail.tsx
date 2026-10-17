import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { Health, ItemStatus, ItemType, Priority } from '../../../api/src/types';
import { api, useApi } from '../api';
import { WatchButton } from '../components/notify/WatchButton';
import { Empty, ErrorBox, HealthBadge, MoreLess, Section, TypeIcon, UrgencyBadge, useShowMore, Warnings } from '../components/ui';
import { fmtDateTime, fmtDay, fmtDaysLeft, todayVN } from '../format';
import { HEALTH_LABEL, ITEM_STATUS_LABEL, PRIORITY_LABEL, ROLE_LABEL, STATE_LABEL, TYPE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ItemView, ProjectDetail, Update } from '../types';
import { l } from '../i18n';

export function ProjectDetailPage() {
  const { id } = useParams();
  const { me, name, isAdmin } = useSession();
  const { data, error, reload } = useApi<ProjectDetail>(`/projects/${id}`);
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  // Older updates loaded with "Xem thêm"; reset whenever the page data reloads.
  const [older, setOlder] = useState<{ for?: ProjectDetail; updates: Update[]; nextBefore?: string; busy?: boolean }>({ updates: [] });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">{l('Đang tải…', '読み込み中…')}</p>;
  const p = data.project;
  const extra = older.for === data ? older : { updates: [], nextBefore: data.nextBefore, busy: false };
  const history = [...data.updates, ...extra.updates];
  async function loadOlder() {
    if (!extra.nextBefore) return;
    setOlder({ ...extra, for: data, busy: true });
    try {
      const page = await api.get<{ updates: Update[]; nextBefore?: string }>(
        `/projects/${p.id}/updates?before=${encodeURIComponent(extra.nextBefore)}`,
      );
      setOlder({ for: data, updates: [...extra.updates, ...page.updates], nextBefore: page.nextBefore });
    } catch (e) {
      setOlder({ ...extra, for: data, busy: false });
      setActionError((e as Error).message);
    }
  }
  const canEdit = isAdmin || p.gl === me.id || p.pl === me.id;
  const now = Date.now();
  const canDeleteUpdate = (u: { author: string; at: string }) => isAdmin || (u.author === me.id && now - Date.parse(u.at) < 24 * 3600_000);

  /** Soft delete; PMO / managers can bring it back from the trash. */
  async function remove(path: string, what: string) {
    if (!confirm(l(`Xoá ${what}?`, `${what}を削除しますか？`))) return;
    setNotice(undefined);
    setActionError(undefined);
    try {
      await api.del(path);
      setNotice(
        l(
          'Đã xoá. PMO / quản lý có thể khôi phục ở Cài đặt → Thùng rác.',
          '削除しました。PMO / 管理者は「設定 → ごみ箱」から復元できます。',
        ),
      );
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <Link to="/projects" className="muted">
            ← {l('Dự án', 'プロジェクト')}
          </Link>
          <h1>
            {p.id} · {p.name}
          </h1>
          <div className="badges">
            <HealthBadge health={p.health} />
            <UrgencyBadge urgency={p.urgency} />
            {p.state !== 'active' && <span className="badge">{STATE_LABEL[p.state]}</span>}
            {!p.publicVisible && <span className="badge">{l('Ẩn khỏi trang public', '公開ページに非表示')}</span>}
          </div>
        </div>
        <div className="filters">
          <WatchButton projectId={p.id} />
          {canEdit && (
            <Link className="btn" to={`/projects/${p.id}/edit`}>
              {l('Sửa dự án', 'プロジェクト編集')}
            </Link>
          )}
        </div>
      </div>

      {notice && <div className="info-box">{notice}</div>}
      <ErrorBox error={actionError} />
      <section className="card">
        <dl className="facts">
          <Fact label={l('Khách hàng', '顧客')}>{p.customer || '—'}</Fact>
          <Fact label="GL">{name(p.gl)}</Fact>
          <Fact label="PL">{name(p.pl)}</Fact>
          <Fact label={l('Người hỗ trợ', 'サポーター')}>{p.supporters.map(name).join(', ') || '—'}</Fact>
          <Fact label={l('PMO theo dõi', '担当 PMO')}>{name(p.pmo)}</Fact>
          <Fact label={l('Thời gian', '期間')}>
            {fmtDay(p.startDate, false)} → {fmtDay(p.endDate, false)}
          </Fact>
          <Fact label={l('Trạng thái PL/GL khai', 'PL/GL申告の状態')}>{p.declaredHealth ? HEALTH_LABEL[p.declaredHealth] : '—'}</Fact>
          <Fact label={l('PMO đánh giá', 'PMO評価')}>{p.pmoHealth ? HEALTH_LABEL[p.pmoHealth] : '—'}</Fact>
          <Fact label={l('Tần suất cập nhật', '報告頻度')}>
            {p.frequencyHours}
            {l(' giờ', '時間')}
            {p.updateFrequencyHours ? l(' (riêng)', '（個別設定）') : ''}
          </Fact>
          <Fact label={l('Hạn cập nhật', '報告期限')}>{fmtDateTime(p.dueAt)}</Fact>
        </dl>
        <Warnings lateHours={p.lateHours} overdueItems={p.overdueItems} highIssues={p.highIssues} />
        {p.lastOwnerUpdate?.needHelp && (
          <p className="help">
            🙋 {l('Cần hỗ trợ', '支援依頼')}: {p.lastOwnerUpdate.needHelp}
          </p>
        )}
        {p.managerComment && (
          <p className="help">
            💬 {l('Ý kiến quản lý', 'マネージャーのコメント')} ({name(p.managerComment.author)}, {fmtDateTime(p.managerComment.at)}):{' '}
            {p.managerComment.summary}
          </p>
        )}
      </section>

      <div className="grid-2">
        <UpdateForm projectId={p.id} defaultHealth={p.declaredHealth ?? p.health} onDone={reload} />
        <Section title={l('Lịch sử cập nhật', '報告履歴')} className="history-card">
          {history.length === 0 ? (
            <Empty>{l('Chưa có cập nhật', '報告はまだありません')}</Empty>
          ) : (
            <>
              <ul className="history">
                {history.map((u) => (
                  <li key={u.id}>
                    <div className="history-head">
                      <span className="nowrap">{fmtDateTime(u.at)}</span>
                      <b>{name(u.author)}</b>
                      <span className="muted">{ROLE_LABEL[u.authorRole]}</span>
                      {u.health && <HealthBadge health={u.health} />}
                      {canDeleteUpdate(u) && (
                        <button
                          type="button"
                          className="btn-link danger-link"
                          onClick={() => remove(`/projects/${p.id}/updates/${u.id}`, l('cập nhật này', 'この報告'))}
                        >
                          {l('Xoá', '削除')}
                        </button>
                      )}
                    </div>
                    <p>{u.summary}</p>
                    {u.needHelp && <p className="help">🙋 {u.needHelp}</p>}
                  </li>
                ))}
              </ul>
              <MoreLess
                onMore={extra.nextBefore ? loadOlder : undefined}
                busy={extra.busy}
                canLess={extra.updates.length > 0}
                onLess={() => setOlder({ updates: [] })}
              />
            </>
          )}
        </Section>
      </div>

      <Items
        projectId={p.id}
        items={data.items}
        onChange={reload}
        canDelete={(i) => canEdit || i.createdBy === me.id}
        onDelete={(i) => remove(`/projects/${p.id}/items/${i.id}`, `"${i.title}"`)}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function UpdateForm({ projectId, defaultHealth, onDone }: { projectId: string; defaultHealth: Health; onDone: () => void }) {
  const [health, setHealth] = useState<Health>(defaultHealth);
  const [summary, setSummary] = useState('');
  const [needHelp, setNeedHelp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/projects/${projectId}/updates`, { health, summary, needHelp: needHelp || undefined });
      setSummary('');
      setNeedHelp('');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={l('Cập nhật tình hình', '状況報告')}>
      <form className="form" onSubmit={submit}>
        <fieldset className="health-pick">
          <legend>{l('Trạng thái', '状態')}</legend>
          {(['green', 'yellow', 'red'] as Health[]).map((h) => (
            <label key={h} className={`pick tone-${h} ${health === h ? 'picked' : ''}`}>
              <input type="radio" name="health" value={h} checked={health === h} onChange={() => setHealth(h)} />
              {HEALTH_LABEL[h]}
            </label>
          ))}
        </fieldset>
        <label>
          {l('Tình hình (1–3 dòng)', '状況（1〜3 行）')}
          <textarea required rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <label>
          {l('Cần hỗ trợ / chỉ đạo (nếu có)', '支援依頼 / 指示が必要なこと（任意）')}
          <input value={needHelp} onChange={(e) => setNeedHelp(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? l('Đang lưu…', '保存中…') : l('Lưu cập nhật', '報告を保存')}
        </button>
      </form>
    </Section>
  );
}

function Items({
  projectId,
  items,
  onChange,
  canDelete,
  onDelete,
}: {
  projectId: string;
  items: ItemView[];
  onChange: () => void;
  canDelete: (item: ItemView) => boolean;
  onDelete: (item: ItemView) => void;
}) {
  const { users, name } = useSession();
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const { visible: shown, more } = useShowMore(
    items.filter((i) => showClosed || !i.closed),
    10,
  );

  async function patch(item: ItemView, body: { status: ItemStatus }) {
    setError(undefined);
    try {
      await api.patch(`/projects/${projectId}/items/${item.id}`, body);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Section
      title={l('Vấn đề · Sự kiện · Mốc', '課題・イベント・マイルストーン')}
      extra={
        <div className="filters">
          <label className="check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{' '}
            {l('Hiện mục đã xong / hoãn', '完了 / 保留の項目も表示')}
          </label>
          <button className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
            {adding ? l('Đóng', '閉じる') : l('＋ Thêm', '＋ 追加')}
          </button>
        </div>
      }
    >
      {adding && (
        <ItemForm
          projectId={projectId}
          users={users}
          onDone={() => {
            setAdding(false);
            onChange();
          }}
        />
      )}
      <ErrorBox error={error} />
      {shown.length === 0 ? (
        <Empty>{l('Không có mục nào', '項目はありません')}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l('Loại', '種類')}</th>
                <th>{l('Nội dung', '内容')}</th>
                <th>{l('Ưu tiên', '優先度')}</th>
                <th>{l('Ngày', '日付')}</th>
                <th>{l('Phụ trách', '担当者')}</th>
                <th>{l('Trạng thái', 'ステータス')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className={i.closed ? 'closed' : ''}>
                  <td className="nowrap">
                    <TypeIcon type={i.type} /> {TYPE_LABEL[i.type]}
                  </td>
                  <td>
                    {i.title}
                    {i.note && <div className="muted">{i.note}</div>}
                  </td>
                  <td>{PRIORITY_LABEL[i.priority]}</td>
                  <td className="nowrap">
                    {fmtDay(i.date)}
                    {!i.closed && <div className={i.overdue ? 'warn-text' : 'muted'}>{fmtDaysLeft(i.daysLeft)}</div>}
                  </td>
                  <td>{name(i.owner)}</td>
                  <td>
                    <select
                      value={i.status}
                      onChange={(e) => patch(i, { status: e.target.value as ItemStatus })}
                      aria-label={l('Trạng thái', 'ステータス')}
                    >
                      {Object.entries(ITEM_STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {canDelete(i) && (
                      <button
                        type="button"
                        className="btn-link danger-link"
                        aria-label={l(`Xoá "${i.title}"`, `「${i.title}」を削除`)}
                        onClick={() => onDelete(i)}
                      >
                        {l('Xoá', '削除')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more}
        </div>
      )}
    </Section>
  );
}

function ItemForm({ projectId, users, onDone }: { projectId: string; users: { id: string; name: string }[]; onDone: () => void }) {
  const [type, setType] = useState<ItemType>('issue');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [date, setDate] = useState(todayVN());
  const [owner, setOwner] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/projects/${projectId}/items`, { type, title, priority, date, owner: owner || undefined, note: note || undefined });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form inline-form" onSubmit={submit}>
      <label>
        {l('Loại', '種類')}
        <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="grow">
        {l('Nội dung', '内容')}
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {l('Ưu tiên', '優先度')}
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        {type === 'issue' ? l('Hạn xử lý', '対応期限') : l('Ngày diễn ra', '開催日')}
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        {l('Phụ trách', '担当者')}
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">—</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grow">
        {l('Ghi chú', 'メモ')}
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorBox error={error} />
      <button className="btn btn-primary" disabled={busy}>
        {busy ? l('Đang lưu…', '保存中…') : l('Thêm', '追加')}
      </button>
    </form>
  );
}
