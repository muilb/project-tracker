import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { Health, ItemStatus, ItemType, Priority } from '../../../api/src/types';
import { api, useApi } from '../api';
import { Empty, ErrorBox, HealthBadge, Section, TypeIcon, UrgencyBadge, Warnings } from '../components/ui';
import { fmtDateTime, fmtDay, fmtDaysLeft, todayVN } from '../format';
import { HEALTH_LABEL, ITEM_STATUS_LABEL, PRIORITY_LABEL, ROLE_LABEL, STATE_LABEL, TYPE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ItemView, ProjectDetail } from '../types';

export function ProjectDetailPage() {
  const { id } = useParams();
  const { me, name, isAdmin } = useSession();
  const { data, error, reload } = useApi<ProjectDetail>(`/projects/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">Đang tải…</p>;
  const p = data.project;
  const canEdit = isAdmin || p.gl === me.id || p.pl === me.id;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <Link to="/projects" className="muted">
            ← Dự án
          </Link>
          <h1>
            {p.id} · {p.name}
          </h1>
          <div className="badges">
            <HealthBadge health={p.health} />
            <UrgencyBadge urgency={p.urgency} />
            {p.state !== 'active' && <span className="badge">{STATE_LABEL[p.state]}</span>}
            {!p.publicVisible && <span className="badge">Ẩn khỏi trang public</span>}
          </div>
        </div>
        {canEdit && (
          <Link className="btn" to={`/projects/${p.id}/edit`}>
            Sửa dự án
          </Link>
        )}
      </div>

      <section className="card">
        <dl className="facts">
          <Fact label="Khách hàng">{p.customer || '—'}</Fact>
          <Fact label="GL">{name(p.gl)}</Fact>
          <Fact label="PL">{name(p.pl)}</Fact>
          <Fact label="Người hỗ trợ">{p.supporters.map(name).join(', ') || '—'}</Fact>
          <Fact label="PMO theo dõi">{name(p.pmo)}</Fact>
          <Fact label="Thời gian">
            {fmtDay(p.startDate, false)} → {fmtDay(p.endDate, false)}
          </Fact>
          <Fact label="Trạng thái PL/GL khai">{p.declaredHealth ? HEALTH_LABEL[p.declaredHealth] : '—'}</Fact>
          <Fact label="PMO đánh giá">{p.pmoHealth ? HEALTH_LABEL[p.pmoHealth] : '—'}</Fact>
          <Fact label="Tần suất cập nhật">
            {p.frequencyHours} giờ{p.updateFrequencyHours ? ' (riêng)' : ''}
          </Fact>
          <Fact label="Hạn cập nhật">{fmtDateTime(p.dueAt)}</Fact>
        </dl>
        <Warnings lateHours={p.lateHours} overdueItems={p.overdueItems} highIssues={p.highIssues} />
        {p.lastOwnerUpdate?.needHelp && <p className="help">🙋 Cần hỗ trợ: {p.lastOwnerUpdate.needHelp}</p>}
        {p.managerComment && (
          <p className="help">
            💬 Ý kiến quản lý ({name(p.managerComment.author)}, {fmtDateTime(p.managerComment.at)}): {p.managerComment.summary}
          </p>
        )}
      </section>

      <div className="grid-2">
        <UpdateForm projectId={p.id} defaultHealth={p.declaredHealth ?? p.health} onDone={reload} />
        <Section title="Lịch sử cập nhật">
          {data.updates.length === 0 ? (
            <Empty>Chưa có cập nhật</Empty>
          ) : (
            <ul className="history">
              {data.updates.map((u) => (
                <li key={u.id}>
                  <div className="history-head">
                    <span className="nowrap">{fmtDateTime(u.at)}</span>
                    <b>{name(u.author)}</b>
                    <span className="muted">{ROLE_LABEL[u.authorRole]}</span>
                    {u.health && <HealthBadge health={u.health} />}
                  </div>
                  <p>{u.summary}</p>
                  {u.needHelp && <p className="help">🙋 {u.needHelp}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Items projectId={p.id} items={data.items} onChange={reload} />
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
    <Section title="Cập nhật tình hình">
      <form className="form" onSubmit={submit}>
        <fieldset className="health-pick">
          <legend>Trạng thái</legend>
          {(['green', 'yellow', 'red'] as Health[]).map((h) => (
            <label key={h} className={`pick tone-${h} ${health === h ? 'picked' : ''}`}>
              <input type="radio" name="health" value={h} checked={health === h} onChange={() => setHealth(h)} />
              {HEALTH_LABEL[h]}
            </label>
          ))}
        </fieldset>
        <label>
          Tình hình (1–3 dòng)
          <textarea required rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <label>
          Cần hỗ trợ / chỉ đạo (nếu có)
          <input value={needHelp} onChange={(e) => setNeedHelp(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu cập nhật'}
        </button>
      </form>
    </Section>
  );
}

function Items({ projectId, items, onChange }: { projectId: string; items: ItemView[]; onChange: () => void }) {
  const { users, name } = useSession();
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const shown = items.filter((i) => showClosed || !i.closed);

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
      title="Vấn đề · Sự kiện · Mốc"
      extra={
        <div className="filters">
          <label className="check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Hiện mục đã xong / hoãn
          </label>
          <button className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Đóng' : '＋ Thêm'}
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
        <Empty>Không có mục nào</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Loại</th>
                <th>Nội dung</th>
                <th>Ưu tiên</th>
                <th>Ngày</th>
                <th>Phụ trách</th>
                <th>Trạng thái</th>
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
                    <select value={i.status} onChange={(e) => patch(i, { status: e.target.value as ItemStatus })} aria-label="Trạng thái">
                      {Object.entries(ITEM_STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        Loại
        <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="grow">
        Nội dung
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Ưu tiên
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        {type === 'issue' ? 'Hạn xử lý' : 'Ngày diễn ra'}
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Phụ trách
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
        Ghi chú
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorBox error={error} />
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Đang lưu…' : 'Thêm'}
      </button>
    </form>
  );
}
