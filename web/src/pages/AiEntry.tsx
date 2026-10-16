import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, useApi } from '../api';
import { ErrorBox, Section, TypeIcon } from '../components/ui';
import { HEALTH_LABEL, ITEM_STATUS_LABEL, PRIORITY_LABEL, TYPE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ProjectView, Proposal } from '../types';

type Row = { p: Proposal; selected: boolean; result?: 'ok' | string };

const EXAMPLE =
  'P03 tuần này vàng, khách đổi yêu cầu màn hình báo cáo, cần thêm 1 dev từ tuần sau. Thứ 6 demo cho khách. Lỗi đăng nhập của P01 đã xử lý xong.';

function target(p: Proposal): { method: 'post' | 'patch'; path: string } {
  if (p.kind === 'update') return { method: 'post', path: `/projects/${p.projectId}/updates` };
  if (p.kind === 'item') return { method: 'post', path: `/projects/${p.projectId}/items` };
  return { method: 'patch', path: `/projects/${p.projectId}/items/${p.itemId}` };
}

export function AiEntryPage() {
  const { isAdmin, me } = useSession();
  const status = useApi<{ configured: boolean; model: string }>('/settings/ai');
  const projectList = useApi<{ projects: ProjectView[] }>('/projects');
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
    for (const [i, row] of next.entries()) {
      if (!row.selected || row.result === 'ok') continue;
      const { method, path } = target(row.p);
      const body = row.p.kind === 'update' ? { ...row.p.body, rawText: sourceText } : row.p.body;
      try {
        await api[method](path, body);
        next[i] = { ...row, result: 'ok', selected: false };
      } catch (err) {
        next[i] = { ...row, result: (err as Error).message };
      }
      setRows([...next]);
    }
    setBusy(undefined);
  }

  const update = (i: number, p: Proposal) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, p } : r)));
  const setProject = (i: number, id: string) =>
    setRows((rs) =>
      rs?.map((r, j) =>
        j === i
          ? {
              ...r,
              p: {
                ...r.p,
                projectId: id,
                projectName: projects.find((x) => x.id === id)?.name,
                needsProject: !id || undefined,
                // A wrong project from the AI is fixed by picking one; other errors stay.
                error: r.p.error?.startsWith('Không tìm thấy dự án') ? undefined : r.p.error,
              },
              selected: !!id && !(r.p.error && !r.p.error.startsWith('Không tìm thấy dự án')),
            }
          : r,
      ),
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
          Viết tình hình như nhắn tin — AI tách thành cập nhật, vấn đề, sự kiện để bạn duyệt trước khi ghi
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
                projects={projects}
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

function ProposalCard({
  row,
  projects,
  onToggle,
  onChange,
  onProject,
}: {
  row: Row;
  projects: ProjectView[];
  onToggle: () => void;
  onChange: (p: Proposal) => void;
  onProject: (id: string) => void;
}) {
  const { p } = row;
  const done = row.result === 'ok';
  const locked = done || !!p.error || !!p.needsProject;
  // Updates and new items can be moved to another project; a status change belongs to its item.
  const movable = p.kind !== 'item_status' && !done;
  return (
    <div className={`card proposal${row.selected ? ' selected' : ''}`}>
      <label className="proposal-head">
        <input type="checkbox" checked={row.selected} disabled={locked} onChange={onToggle} />
        <span>
          <b>{p.kind === 'update' ? 'Cập nhật tình hình' : p.kind === 'item' ? `Thêm ${TYPE_LABEL[p.body.type].toLowerCase()}` : 'Đổi trạng thái'}</b>
          {!movable && (
            <>
              {' · '}
              <Link to={`/projects/${p.projectId}`}>
                {p.projectId}
                {p.projectName ? ` ${p.projectName}` : ''}
              </Link>
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
            {projects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} · {x.name}
              </option>
            ))}
          </select>
          {p.needsProject && <small className="warn-text">Ghi chú không nêu dự án — chọn dự án để ghi.</small>}
        </label>
      )}

      {p.kind === 'update' && (
        <div className="form">
          <div className="form-grid">
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
          </div>
          <label>
            Tình hình
            <textarea rows={2} disabled={done} value={p.body.summary} onChange={(e) => onChange({ ...p, body: { ...p.body, summary: e.target.value } })} />
          </label>
          {(p.body.needHelp !== undefined || !done) && (
            <label>
              Cần hỗ trợ
              <input
                disabled={done}
                value={p.body.needHelp ?? ''}
                onChange={(e) => onChange({ ...p, body: { ...p.body, needHelp: e.target.value || undefined } })}
              />
            </label>
          )}
        </div>
      )}

      {p.kind === 'item' && (
        <div className="form">
          <label>
            <span>
              <TypeIcon type={p.body.type} /> Nội dung
            </span>
            <input disabled={done} value={p.body.title} onChange={(e) => onChange({ ...p, body: { ...p.body, title: e.target.value } })} />
          </label>
          <div className="form-grid">
            <label>
              Loại
              <select disabled={done} value={p.body.type} onChange={(e) => onChange({ ...p, body: { ...p.body, type: e.target.value as typeof p.body.type } })}>
                {(['issue', 'event', 'milestone'] as const).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {p.body.type === 'issue' ? 'Hạn xử lý' : 'Ngày'}
              <input type="date" disabled={done} value={p.body.date} onChange={(e) => onChange({ ...p, body: { ...p.body, date: e.target.value } })} />
            </label>
            <label>
              Ưu tiên
              <select
                disabled={done}
                value={p.body.priority}
                onChange={(e) => onChange({ ...p, body: { ...p.body, priority: e.target.value as typeof p.body.priority } })}
              >
                {(['high', 'medium', 'low'] as const).map((v) => (
                  <option key={v} value={v}>
                    {PRIORITY_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {p.body.owner && <small className="muted">Phụ trách: {p.body.owner}</small>}
        </div>
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

      {p.error && <ErrorBox error={`Không ghi được: ${p.error}`} />}
      {row.result && row.result !== 'ok' && <ErrorBox error={row.result} />}
    </div>
  );
}
