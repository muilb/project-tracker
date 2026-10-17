import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AskPanel } from './AiAsk';
import { api, useApi } from '../api';
import { ErrorBox, Section } from '../components/ui';
import { VoiceButton } from '../components/VoiceButton';
import { l, lang } from '../i18n';
import { HEALTH_LABEL, ITEM_STATUS_LABEL, PRIORITY_LABEL, STATE_LABEL, TYPE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ProjectView, Proposal, User } from '../types';

type Row = { p: Proposal; selected: boolean; result?: 'ok' | string };
type Option = { id: string; label: string };

const EXAMPLE = l(
  'P03 tuần này vàng, khách đổi yêu cầu màn hình báo cáo, cần thêm 1 dev từ tuần sau. Thứ 6 demo cho khách. Lỗi đăng nhập của P01 đã xử lý xong.\n' +
    'Dự án mới: Web bán hàng cho KH ABC, PL An, GL Hùng, chạy từ 1/11 đến 31/12, release 15/12.',
  'P03 は今週「黄」。顧客がレポート画面の要件を変更したため、来週から開発者を 1 名追加したい。金曜に顧客デモ。P01 のログイン不具合は対応完了。\n' +
    '新規プロジェクト: ABC 社向け EC サイト、PL は An さん、GL は Hùng さん、期間 11/1〜12/31、リリース 12/15。',
);

const KIND_TITLE: Record<Proposal['kind'], string> = {
  update: l('Cập nhật tình hình', '状況報告'),
  item: l('Thêm mục', '項目追加'),
  item_status: l('Đổi trạng thái', 'ステータス変更'),
  item_update: l('Sửa mục', '項目編集'),
  project_create: l('Tạo dự án mới', '新規プロジェクト作成'),
  project_update: l('Sửa thông tin dự án', 'プロジェクト情報の編集'),
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

type Tab = 'entry' | 'ask';

/** "✦ AI": ask questions about the data (everyone) or enter changes in plain text (PL and above). */
export function AiEntryPage() {
  const { isSystemAdmin, me } = useSession();
  const status = useApi<{ configured: boolean; model: string }>('/settings/ai');
  const canEnter = me.role !== 'OTHER';
  const [params, setParams] = useSearchParams();
  const tab: Tab = canEnter && params.get('tab') !== 'ask' ? 'entry' : 'ask';

  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>✦ AI</h1>
        {canEnter && (
          <div className="segmented" role="tablist" aria-label="AI">
            {(['entry', 'ask'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'active' : ''}
                onClick={() => setParams(t === 'ask' ? { tab: 'ask' } : {}, { replace: true })}
              >
                {t === 'entry' ? l('Nhập dữ liệu', 'データ入力') : l('Hỏi về dữ liệu', 'データについて質問')}
              </button>
            ))}
          </div>
        )}
      </div>
      <ErrorBox error={status.error} />
      {status.data && !status.data.configured ? (
        <NotConfigured isSystemAdmin={isSystemAdmin} />
      ) : tab === 'ask' ? (
        <AskPanel />
      ) : (
        <EntryPanel />
      )}
    </div>
  );
}

function NotConfigured({ isSystemAdmin }: { isSystemAdmin: boolean }) {
  return (
    <div className="info-box">
      {isSystemAdmin ? (
        <>
          {lang === 'ja' ? (
            <>
              Claude の API キーが未設定です。<Link to="/settings">設定 → AI</Link> で追加してください。
            </>
          ) : (
            <>
              Chưa có API key Claude. Vào <Link to="/settings">Cài đặt → AI</Link> để thêm.
            </>
          )}
        </>
      ) : (
        l(
          'Quản trị hệ thống chưa cài API key AI. Nhờ Quản trị hệ thống vào Cài đặt → AI để bật tính năng này.',
          'システム管理者が AI の API キーを未設定です。システム管理者に「設定 → AI」で有効にしてもらってください。',
        )
      )}
    </div>
  );
}

function EntryPanel() {
  const { me } = useSession();
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
      .map((r) => ({ id: r.p.projectId, label: `${r.p.projectName || l('Dự án mới', '新規プロジェクト')} ${l('(mới)', '（新規）')}` })),
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
    const order = next
      .map((_, i) => i)
      .sort((a, b) => Number(next[b].p.kind === 'project_create') - Number(next[a].p.kind === 'project_create'));
    for (const i of order) {
      const row = next[i];
      if (!row.selected || row.result === 'ok') continue;
      let p = row.p;
      if (p.newProject && p.kind !== 'project_create') {
        const real = created.get(p.projectId);
        if (!real) {
          next[i] = {
            ...row,
            result: l(
              'Dự án mới chưa được tạo — chọn cả đề xuất "Tạo dự án mới"',
              '新規プロジェクトが作成されていません — 「新規プロジェクト作成」の提案も選択してください',
            ),
          };
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
        const error = r.p.badProject ? undefined : r.p.error;
        return {
          ...r,
          p: {
            ...r.p,
            projectId: id,
            projectName: fresh ? fresh.p.projectName : projects.find((x) => x.id === id)?.name,
            newProject: fresh ? true : undefined,
            needsProject: !id || undefined,
            badProject: undefined,
            error,
          },
          selected: !!id && !error,
        };
      }),
    );
  const toggle = (i: number) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, selected: !r.selected } : r)));
  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;
  const savedCount = rows?.filter((r) => r.result === 'ok').length ?? 0;

  return (
    <div className="stack">
      <form className="card form" onSubmit={parse}>
        <label>
          {l(
            'Viết như nhắn tin — AI tách thành cập nhật, vấn đề / sự kiện / mốc, sửa mục, tạo hoặc sửa dự án để bạn duyệt trước khi ghi',
            'チャットのように書くだけで、AI が状況報告・課題 / イベント / マイルストーン・項目の編集・プロジェクトの作成 / 編集に分けます。登録前に内容を確認できます',
          )}
          <textarea rows={6} required maxLength={4000} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} />
        </label>
        <label>
          {l('Dự án mặc định', 'デフォルトプロジェクト')}{' '}
          <small className="muted">{l('(dùng khi ghi chú không nêu dự án)', '（メモにプロジェクトがない場合に使用）')}</small>
          <select value={defaultProject} onChange={(e) => setDefaultProject(e.target.value)}>
            <option value="">{l('— AI tự nhận diện —', '— AI が自動判別 —')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <ErrorBox error={error} />
        <div className="actions gap">
          <VoiceButton value={text} onChange={setText} disabled={!!busy} />
          {!text && (
            <button type="button" className="btn" onClick={() => setText(EXAMPLE)}>
              {l('Dùng ví dụ', '例を使う')}
            </button>
          )}
          <button className="btn btn-primary" disabled={!!busy}>
            {busy === 'parse' ? l('AI đang đọc…', 'AI が解析中…') : l('Phân tích', '解析')}
          </button>
        </div>
      </form>

      {questions.length > 0 && (
        <div className="info-box">
          <b>{l('AI cần làm rõ:', 'AI からの確認事項:')}</b>
          <ul>
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {rows && (
        <Section title={`${l('Đề xuất', '提案')} (${rows.length})`}>
          {rows.length === 0 && <p className="muted">{l('Không có gì để ghi.', '登録する内容はありません。')}</p>}
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
              {savedCount > 0 && <span className="muted">{l(`Đã ghi ${savedCount} mục.`, `${savedCount} 件登録しました。`)}</span>}
              <button className="btn btn-primary" disabled={!!busy || selectedCount === 0} onClick={save}>
                {busy === 'save' ? l('Đang ghi…', '登録中…') : l(`Ghi ${selectedCount} mục đã chọn`, `選択した ${selectedCount} 件を登録`)}
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
  { key: 'name', label: l('Tên dự án', 'プロジェクト名'), kind: 'text' },
  { key: 'customer', label: l('Khách hàng', '顧客'), kind: 'text' },
  { key: 'pl', label: 'PL', kind: 'user' },
  { key: 'gl', label: 'GL', kind: 'user' },
  { key: 'supporters', label: l('Người hỗ trợ', 'サポーター'), kind: 'users' },
  { key: 'startDate', label: l('Bắt đầu', '開始日'), kind: 'date' },
  { key: 'endDate', label: l('Kết thúc', '終了日'), kind: 'date' },
  { key: 'state', label: l('Trạng thái dự án', 'プロジェクトの状況'), kind: 'select', options: STATE_LABEL },
  { key: 'updateFrequencyHours', label: l('Tần suất cập nhật (giờ)', '報告頻度（時間）'), kind: 'number' },
];
const NEW_PROJECT_KEYS = ['name', 'customer', 'pl', 'gl', 'supporters', 'startDate', 'endDate'];

const ITEM_FIELDS: FieldDef[] = [
  { key: 'title', label: l('Nội dung', '内容'), kind: 'text' },
  { key: 'type', label: l('Loại', '種類'), kind: 'select', options: TYPE_LABEL },
  { key: 'date', label: l('Ngày / hạn xử lý', '日付 / 対応期限'), kind: 'date' },
  { key: 'priority', label: l('Ưu tiên', '優先度'), kind: 'select', options: PRIORITY_LABEL },
  { key: 'owner', label: l('Phụ trách', '担当者'), kind: 'user' },
  { key: 'status', label: l('Trạng thái', 'ステータス'), kind: 'select', options: ITEM_STATUS_LABEL },
  { key: 'note', label: l('Ghi chú', 'メモ'), kind: 'text' },
];
const NEW_ITEM_KEYS = ['title', 'type', 'date', 'priority', 'owner'];

function display(f: FieldDef, v: unknown, users: User[]): string {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  if (f.kind === 'user') return userName(String(v));
  if (f.kind === 'users') return (v as string[]).map(userName).join(', ');
  if (f.kind === 'select') return f.options?.[String(v)] ?? String(v);
  if (f.kind === 'date') return lang === 'ja' ? String(v).replaceAll('-', '/') : String(v).split('-').reverse().join('/');
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
              <option value="">{l('— không —', '— なし —')}</option>
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
            {before && (
              <small className="muted">
                {l('Hiện tại', '現在')}: {display(f, before[f.key], users)}
              </small>
            )}
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
  const title =
    p.kind === 'item' ? l(`Thêm ${TYPE_LABEL[p.body.type].toLowerCase()}`, `${TYPE_LABEL[p.body.type]}を追加`) : KIND_TITLE[p.kind];

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
                `${p.projectName ?? ''} ${l('(mới)', '（新規）')}`
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
        {done && <span className="ok-text">{l('✓ Đã ghi', '✓ 登録済み')}</span>}
      </label>
      {movable && (
        <label className="proposal-project">
          {l('Dự án', 'プロジェクト')}
          <select value={p.projectId} onChange={(e) => onProject(e.target.value)}>
            <option value="">{l('— Chọn dự án —', '— プロジェクトを選択 —')}</option>
            {projectOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          {p.needsProject && (
            <small className="warn-text">
              {l('Ghi chú không nêu dự án — chọn dự án để ghi.', 'メモにプロジェクトが書かれていません — 登録先を選んでください。')}
            </small>
          )}
        </label>
      )}

      {p.kind === 'update' && (
        <div className="form">
          <label>
            {l('Trạng thái', '状態')}
            <select
              disabled={done}
              value={p.body.health ?? ''}
              onChange={(e) => onChange({ ...p, body: { ...p.body, health: (e.target.value || undefined) as typeof p.body.health } })}
            >
              <option value="">{l('— không đổi —', '— 変更なし —')}</option>
              {(['green', 'yellow', 'red'] as const).map((h) => (
                <option key={h} value={h}>
                  {HEALTH_LABEL[h]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {l('Tình hình', '状況')}
            <textarea
              rows={2}
              disabled={done}
              value={p.body.summary}
              onChange={(e) => onChange({ ...p, body: { ...p.body, summary: e.target.value } })}
            />
          </label>
          <label>
            {l('Cần hỗ trợ', '支援依頼')}
            <input
              disabled={done}
              value={p.body.needHelp ?? ''}
              onChange={(e) => onChange({ ...p, body: { ...p.body, needHelp: e.target.value || undefined } })}
            />
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
            {l('Trạng thái mới', '新しいステータス')}
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
          {p.body.note && (
            <small className="muted">
              {l('Ghi chú', 'メモ')}: {p.body.note}
            </small>
          )}
        </div>
      )}

      {p.warnings?.map((w) => (
        <small key={w} className="warn-text proposal-warning">
          ⚠ {w}
        </small>
      ))}
      {p.error && <ErrorBox error={`${l('Không ghi được', '登録できません')}: ${p.error}`} />}
      {row.result && row.result !== 'ok' && <ErrorBox error={row.result} />}
    </div>
  );
}
