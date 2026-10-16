import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, useApi } from '../api';
import { ErrorBox, Section } from '../components/ui';
import { HEALTH_LABEL, ITEM_STATUS_LABEL, PRIORITY_LABEL, STATE_LABEL, TYPE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ProjectView, Proposal, User } from '../types';

type Row = { p: Proposal; selected: boolean; result?: 'ok' | string };
type Option = { id: string; label: string };

const EXAMPLE =
  'P03 tuần này vàng, khách đổi yêu cầu màn hình báo cáo, cần thêm 1 dev từ tuần sau. Thứ 6 demo cho khách. Lỗi đăng nhập của P01 đã xử lý xong.\n' +
  'Dự án mới: Web bán hàng cho KH ABC, PL An, GL Hùng, chạy từ 1/11 đến 31/12, release 15/12.';

const KIND_TITLE: Record<Proposal['kind'], string> = {
  update: 'Cập nhật tình hình',
  item: 'Thêm mục',
  item_status: 'Đổi trạng thái',
  item_update: 'Sửa mục',
  project_create: 'Tạo dự án mới',
  project_update: 'Sửa thông tin dự án',
};

function target(p: Proposal): { method: 'post' | 'patch'; path: string } {
  switch (p.kind) {
    case 'update':
      return { method: 'post', path: `/projects/${p.projectId}/updates` };
    case 'item':
      return { method: 'post', path: `/projects/${p.projectId}/items` };
    case 'project_create':
      return { method: 'post', path: '/projects' };
    case 'project_update':
      return { method: 'patch', path: `/projects/${p.projectId}` };
    default:
      return { method: 'patch', path: `/projects/${p.projectId}/items/${p.itemId}` };
  }
}

const PROJECT_ERROR = 'Không tìm thấy dự án';

export function AiEntryPage() {
  const { isAdmin, me } = useSession();
  const status = useApi<{ configured: boolean; model: string }>('/settings/ai');
  const projectList = useApi<{ projects: ProjectView[] }>('/projects');
  const userList = useApi<{ users: User[] }>('/users');
  const users = userList.data?.users ?? [];
  // The writer's own projects first: those are the likely defaults.
  const projects = [...(projectList.data?.projects ?? [])].sort((a, b) => {
    const mine = (p: ProjectView) => (p.pl === me.id || p.gl === me.id || p.supporters.includes(me.id) ? 0 : 1);
    return mine(a) - mine(b) || a.id.localeCompare(b.id);
  });
  const [defaultProject, setDefaultProject] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>();
  const [questions, setQuestions] = useState<string[]>([]);
  const [busy, setBusy] = useState<'parse' | 'save'>();
  const [error, setError] = useState<string>();
  const [sourceText, setSourceText] = useState('');

  // Projects a card can be moved to: existing ones plus those created by this note.
  const projectOptions: Option[] = [
    ...(rows ?? [])
      .filter((r) => r.p.kind === 'project_create' && r.result !== 'ok')
      .map((r) => ({ id: r.p.projectId, label: `${r.p.projectName || 'Dự án mới'} (mới)` })),
    ...projects.map((p) => ({ id: p.id, label: `${p.id} · ${p.name}` })),
  ];

  async function parse(e: FormEvent) {
    e.preventDefault();
    setBusy('parse');
    setError(undefined);
    setRows(undefined);
    try {
      const r = await api.post<{ proposals: Proposal[]; questions: string[] }>('/ai/parse', {
        text,
        projectId: defaultProject || undefined,
      });
      setRows(r.proposals.map((p) => ({ p, selected: !p.error && !p.needsProject })));
      setQuestions(r.questions);
      setSourceText(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function save() {
    if (!rows) return;
    setBusy('save');
    const next = [...rows];
    const created = new Map<string, { id: string; name: string }>(); // NEW1 → the real project
    // New projects first, so the items / updates for them know the real id.
    const order = next.map((_, i) => i).sort((a, b) => Number(next[b].p.kind === 'project_create') - Number(next[a].p.kind === 'project_create'));
    for (const i of order) {
      const row = next[i];
      if (!row.selected || row.result === 'ok') continue;
      let p = row.p;
      if (p.newProject && p.kind !== 'project_create') {
        const real = created.get(p.projectId);
        if (!real) {
          next[i] = { ...row, result: 'Dự án mới chưa được tạo — chọn cả đề xuất "Tạo dự án mới"' };
          continue;
        }
        p = { ...p, projectId: real.id, projectName: real.name, newProject: undefined };
      }
      const { method, path } = target(p);
      const body = p.kind === 'update' ? { ...p.body, rawText: sourceText } : p.body;
      try {
        const res = await api[method]<{ project?: { id: string; name: string } }>(path, body);
        if (p.kind === 'project_create' && res.project) {
          created.set(p.projectId, res.project);
          p = { ...p, projectId: res.project.id };
        }
        next[i] = { ...row, p, result: 'ok', selected: false };
      } catch (err) {
        next[i] = { ...row, p, result: (err as Error).message };
      }
      setRows([...next]);
    }
    setRows([...next]);
    setBusy(undefined);
  }

  const update = (i: number, p: Proposal) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, p } : r)));
  const setProject = (i: number, id: string) =>
    setRows((rs) =>
      rs?.map((r, j) => {
        if (j !== i) return r;
        const fresh = rs.find((x) => x.p.kind === 'project_create' && x.p.projectId === id);
        // A wrong project from the AI is fixed by picking one; other errors stay.
        const error = r.p.error?.startsWith(PROJECT_ERROR) ? undefined : r.p.error;
        return {
          ...r,
          p: {
            ...r.p,
            projectId: id,
            projectName: fresh ? fresh.p.projectName : projects.find((x) => x.id === id)?.name,
            newProject: fresh ? true : undefined,
            needsProject: !id || undefined,
            error,
          },
          selected: !!id && !error,
        };
      }),
    );
  const toggle = (i: number) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, selected: !r.selected } : r)));
  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;
  const savedCount = rows?.filter((r) => r.result === 'ok').length ?? 0;

  if (status.data && !status.data.configured)
    return (
      <div className="stack narrow">
        <h1>Nhập bằng AI</h1>
        <div className="info-box">
          {isAdmin ? (
            <>
              Chưa có API key Claude. Vào <Link to="/settings">Cài đặt → AI</Link> để thêm.
            </>
          ) : (
            'PMO chưa cài API key AI. Nhờ PMO vào Cài đặt → AI để bật tính năng này.'
          )}
        </div>
      </div>
    );

  return (
    <div className="stack narrow">
      <h1>Nhập bằng AI</h1>
      <form className="card form" onSubmit={parse}>
        <label>
          Viết như nhắn tin — AI tách thành cập nhật, vấn đề / sự kiện / mốc, sửa mục, tạo hoặc sửa dự án để bạn duyệt trước khi ghi
          <textarea
            rows={6}
            required
            maxLength={4000}
            value={text}
            placeholder={EXAMPLE}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>
          Dự án mặc định <small className="muted">(dùng khi ghi chú không nêu dự án)</small>
          <select value={defaultProject} onChange={(e) => setDefaultProject(e.target.value)}>
            <option value="">— AI tự nhận diện —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <ErrorBox error={error ?? status.error} />
        <div className="actions gap">
          {!text && (
            <button type="button" className="btn" onClick={() => setText(EXAMPLE)}>
              Dùng ví dụ
            </button>
          )}
          <button className="btn btn-primary" disabled={!!busy}>
            {busy === 'parse' ? 'AI đang đọc…' : 'Phân tích'}
          </button>
        </div>
      </form>

      {questions.length > 0 && (
        <div className="info-box">
          <b>AI cần làm rõ:</b>
          <ul>
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {rows && (
        <Section title={`Đề xuất (${rows.length})`}>
          {rows.length === 0 && <p className="muted">Không có gì để ghi.</p>}
          <div className="stack">
            {rows.map((row, i) => (
              <ProposalCard
                key={i}
                row={row}
                projectOptions={projectOptions}
                users={users}
                onToggle={() => toggle(i)}
                onChange={(p) => update(i, p)}
                onProject={(id) => setProject(i, id)}
              />
            ))}
          </div>
          {rows.length > 0 && (
            <div className="actions gap">
              {savedCount > 0 && <span className="muted">Đã ghi {savedCount} mục.</span>}
              <button className="btn btn-primary" disabled={!!busy || selectedCount === 0} onClick={save}>
                {busy === 'save' ? 'Đang ghi…' : `Ghi ${selectedCount} mục đã chọn`}
              </button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ---------- Fields ----------

type FieldDef = {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'number' | 'user' | 'users' | 'select';
  options?: Record<string, string>;
};

const PROJECT_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Tên dự án', kind: 'text' },
  { key: 'customer', label: 'Khách hàng', kind: 'text' },
  { key: 'pl', label: 'PL', kind: 'user' },
  { key: 'gl', label: 'GL', kind: 'user' },
  { key: 'supporters', label: 'Người hỗ trợ', kind: 'users' },
  { key: 'startDate', label: 'Bắt đầu', kind: 'date' },
  { key: 'endDate', label: 'Kết thúc', kind: 'date' },
  { key: 'state', label: 'Trạng thái dự án', kind: 'select', options: STATE_LABEL },
  { key: 'updateFrequencyHours', label: 'Tần suất cập nhật (giờ)', kind: 'number' },
];
const NEW_PROJECT_KEYS = ['name', 'customer', 'pl', 'gl', 'supporters', 'startDate', 'endDate'];

const ITEM_FIELDS: FieldDef[] = [
  { key: 'title', label: 'Nội dung', kind: 'text' },
  { key: 'type', label: 'Loại', kind: 'select', options: TYPE_LABEL },
  { key: 'date', label: 'Ngày / hạn xử lý', kind: 'date' },
  { key: 'priority', label: 'Ưu tiên', kind: 'select', options: PRIORITY_LABEL },
  { key: 'owner', label: 'Phụ trách', kind: 'user' },
  { key: 'status', label: 'Trạng thái', kind: 'select', options: ITEM_STATUS_LABEL },
  { key: 'note', label: 'Ghi chú', kind: 'text' },
];
const NEW_ITEM_KEYS = ['title', 'type', 'date', 'priority', 'owner'];

function display(f: FieldDef, v: unknown, users: User[]): string {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  if (f.kind === 'user') return userName(String(v));
  if (f.kind === 'users') return (v as string[]).map(userName).join(', ');
  if (f.kind === 'select') return f.options?.[String(v)] ?? String(v);
  if (f.kind === 'date') return String(v).split('-').reverse().join('/');
  return String(v);
}

/** Editable fields of a proposal body; with `before`, each field also shows the current value. */
function FieldEditor({
  fields,
  body,
  before,
  users,
  disabled,
  onChange,
}: {
  fields: FieldDef[];
  body: Record<string, unknown>;
  before?: Record<string, unknown>;
  users: User[];
  disabled: boolean;
  onChange: (body: Record<string, unknown>) => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...body, [key]: value === '' ? undefined : value });
  return (
    <div className="form form-grid">
      {fields.map((f) => {
        const v = body[f.key];
        let input;
        if (f.kind === 'select')
          input = (
            <select disabled={disabled} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)}>
              {Object.entries(f.options ?? {}).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          );
        else if (f.kind === 'user')
          input = (
            <select disabled={disabled} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">— không —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          );
        else if (f.kind === 'users') input = <p className="row-text">{display(f, v, users)}</p>;
        else
          input = (
            <input
              type={f.kind}
              disabled={disabled}
              value={String(v ?? '')}
              onChange={(e) => set(f.key, f.kind === 'number' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value)}
            />
          );
        return (
          <label key={f.key} className={f.kind === 'text' ? 'span-all' : undefined}>
            {f.label}
            {input}
            {before && <small className="muted">Hiện tại: {display(f, before[f.key], users)}</small>}
          </label>
        );
      })}
    </div>
  );
}

// ---------- Card ----------

function ProposalCard({
  row,
  projectOptions,
  users,
  onToggle,
  onChange,
  onProject,
}: {
  row: Row;
  projectOptions: Option[];
  users: User[];
  onToggle: () => void;
  onChange: (p: Proposal) => void;
  onProject: (id: string) => void;
}) {
  const { p } = row;
  const done = row.result === 'ok';
  const locked = done || !!p.error || !!p.needsProject;
  // Updates and new items can be moved to another project; edits belong to what they edit.
  const movable = (p.kind === 'update' || p.kind === 'item') && !done;
  const fieldsOf = (all: FieldDef[], keys: string[]) => all.filter((f) => keys.includes(f.key));
  const title = p.kind === 'item' ? `Thêm ${TYPE_LABEL[p.body.type].toLowerCase()}` : KIND_TITLE[p.kind];

  return (
    <div className={`card proposal${row.selected ? ' selected' : ''}`}>
      <label className="proposal-head">
        <input type="checkbox" checked={row.selected} disabled={locked} onChange={onToggle} />
        <span>
          <b>{title}</b>
          {!movable && p.kind !== 'project_create' && (
            <>
              {' · '}
              {p.newProject ? (
                `${p.projectName ?? ''} (mới)`
              ) : (
                <Link to={`/projects/${p.projectId}`}>
                  {p.projectId}
                  {p.projectName ? ` ${p.projectName}` : ''}
                </Link>
              )}
            </>
          )}
          {p.kind === 'project_create' && done && (
            <>
              {' · '}
              <Link to={`/projects/${p.projectId}`}>{p.projectId}</Link>
            </>
          )}
        </span>
        {done && <span className="ok-text">✓ Đã ghi</span>}
      </label>
      {movable && (
        <label className="proposal-project">
          Dự án
          <select value={p.projectId} onChange={(e) => onProject(e.target.value)}>
            <option value="">— Chọn dự án —</option>
            {projectOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          {p.needsProject && <small className="warn-text">Ghi chú không nêu dự án — chọn dự án để ghi.</small>}
        </label>
      )}

      {p.kind === 'update' && (
        <div className="form">
          <label>
            Trạng thái
            <select
              disabled={done}
              value={p.body.health ?? ''}
              onChange={(e) => onChange({ ...p, body: { ...p.body, health: (e.target.value || undefined) as typeof p.body.health } })}
            >
              <option value="">— không đổi —</option>
              {(['green', 'yellow', 'red'] as const).map((h) => (
                <option key={h} value={h}>
                  {HEALTH_LABEL[h]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tình hình
            <textarea rows={2} disabled={done} value={p.body.summary} onChange={(e) => onChange({ ...p, body: { ...p.body, summary: e.target.value } })} />
          </label>
          <label>
            Cần hỗ trợ
            <input disabled={done} value={p.body.needHelp ?? ''} onChange={(e) => onChange({ ...p, body: { ...p.body, needHelp: e.target.value || undefined } })} />
          </label>
        </div>
      )}

      {p.kind === 'item' && (
        <FieldEditor
          fields={fieldsOf(ITEM_FIELDS, NEW_ITEM_KEYS)}
          body={p.body}
          users={users}
          disabled={done}
          onChange={(body) => onChange({ ...p, body: body as typeof p.body })}
        />
      )}

      {p.kind === 'item_update' && (
        <>
          <p className="row-text">
            {p.itemId}
            {p.itemTitle ? ` · ${p.itemTitle}` : ''}
          </p>
          <FieldEditor
            fields={fieldsOf(ITEM_FIELDS, Object.keys(p.body))}
            body={p.body}
            before={p.before}
            users={users}
            disabled={done}
            onChange={(body) => onChange({ ...p, body })}
          />
        </>
      )}

      {p.kind === 'project_create' && (
        <FieldEditor
          fields={fieldsOf(PROJECT_FIELDS, NEW_PROJECT_KEYS)}
          body={p.body}
          users={users}
          disabled={done}
          onChange={(body) => onChange({ ...p, projectName: String(body.name ?? ''), body: body as typeof p.body })}
        />
      )}

      {p.kind === 'project_update' && (
        <FieldEditor
          fields={fieldsOf(PROJECT_FIELDS, Object.keys(p.body))}
          body={p.body}
          before={p.before}
          users={users}
          disabled={done}
          onChange={(body) => onChange({ ...p, body })}
        />
      )}

      {p.kind === 'item_status' && (
        <div className="form">
          <p className="row-text">
            {p.itemId}
            {p.itemTitle ? ` · ${p.itemTitle}` : ''}
          </p>
          <label>
            Trạng thái mới
            <select
              disabled={done}
              value={p.body.status}
              onChange={(e) => onChange({ ...p, body: { ...p.body, status: e.target.value as typeof p.body.status } })}
            >
              {(['open', 'in_progress', 'done', 'postponed'] as const).map((s) => (
                <option key={s} value={s}>
                  {ITEM_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {p.body.note && <small className="muted">Ghi chú: {p.body.note}</small>}
        </div>
      )}

      {p.warnings?.map((w) => (
        <small key={w} className="warn-text proposal-warning">
          ⚠ {w}
        </small>
      ))}
      {p.error && <ErrorBox error={`Không ghi được: ${p.error}`} />}
      {row.result && row.result !== 'ok' && <ErrorBox error={row.result} />}
    </div>
  );
}
