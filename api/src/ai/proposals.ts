import { can } from '../auth.js';
import { l, lang } from '../i18n.js';
import { createItemSchema, createProjectSchema, createUpdateSchema, patchItemSchema, patchProjectSchema } from '../schemas.js';
import type { Snapshot } from '../store/store.js';
import { vnDate } from '../time.js';
import type { Health, Item, ItemStatus, ItemType, Priority, Project, ProjectState, User } from '../types.js';
import type { AiOutput, AiRawAction } from './assistant.js';

export interface ProjectFields {
  name: string;
  customer?: string;
  pl?: string;
  gl?: string;
  supporters?: string[];
  startDate?: string;
  endDate?: string;
  state: ProjectState;
  updateFrequencyHours?: number;
}
export interface ItemFields {
  title: string;
  type: ItemType;
  date: string;
  priority: Priority;
  owner?: string;
  status: ItemStatus;
  note?: string;
}

/**
 * A change the AI suggests; the web sends `body` to the matching REST endpoint once the
 * user confirms. A project created in the same note is referred to by `NEW1`, `NEW2`…
 * until the web has created it and knows its real id.
 */
export type Proposal = {
  /** Empty when the note did not say which project; the user picks one on the web (`needsProject`). */
  projectId: string;
  projectName?: string;
  needsProject?: boolean;
  /** `error` is about the project (unknown id): picking another project clears it. */
  badProject?: boolean;
  /** The project is created by a `project_create` proposal of the same note. */
  newProject?: boolean;
  error?: string;
  /** Non-blocking notes, e.g. a person that was not found and left empty. */
  warnings?: string[];
} & (
  | { kind: 'update'; body: { health?: Health; summary: string; needHelp?: string } }
  | { kind: 'item'; body: { type: ItemType; title: string; priority: Priority; date: string; owner?: string } }
  | { kind: 'item_status'; itemId: string; itemTitle?: string; body: { status: ItemStatus; note?: string } }
  | { kind: 'item_update'; itemId: string; itemTitle?: string; body: Partial<ItemFields>; before: Partial<ItemFields> }
  | { kind: 'project_create'; body: Omit<ProjectFields, 'state'> }
  | { kind: 'project_update'; body: Partial<ProjectFields>; before: Partial<ProjectFields> }
);

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const MAX_ITEMS_PER_PROJECT = 30;
const NEW_REF = /^NEW\d*$/;

export const weekday = (date: string) => WEEKDAYS[new Date(date).getUTCDay()];

export function calendar(now: Date, days: number): string {
  const today = Date.parse(vnDate(now));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today + i * 86_400_000);
    return `${d.toISOString().slice(0, 10)} ${WEEKDAYS[d.getUTCDay()]}`;
  }).join('\n');
}

/** What the model needs to resolve names and relative dates: open projects, their open items, people, calendar. */
export function buildContext(snap: Snapshot, now: Date, me: User, defaultProjectId?: string): string {
  const projects = snap.projects.filter((p) => p.state !== 'closed').sort((a, b) => a.id.localeCompare(b.id));
  const mine = (p: Project) => p.pl === me.id || p.gl === me.id || p.pmo === me.id || p.supporters.includes(me.id);
  const def = projects.find((p) => p.id === defaultProjectId);
  const lines = [
    `Hôm nay: ${vnDate(now)} (${WEEKDAYS[new Date(vnDate(now)).getUTCDay()]}). Người viết ghi chú: ${me.name} <${me.id}>.`,
    def ? `Dự án mặc định (khi ghi chú không nêu dự án): ${def.id} ${def.name}` : 'Dự án mặc định: không có',
    `Ngôn ngữ giao diện của người viết: ${lang() === 'ja' ? 'tiếng Nhật' : 'tiếng Việt'}.`,
    '',
    '<lich_3_tuan>',
    calendar(now, 21),
    '</lich_3_tuan>',
    '',
    '<du_an>',
  ];
  for (const p of projects) {
    const info = [
      p.name,
      p.customer && `khách: ${p.customer}`,
      p.pl && `PL: ${p.pl}`,
      p.gl && `GL: ${p.gl}`,
      p.supporters.length && `hỗ trợ: ${p.supporters.join(', ')}`,
      (p.startDate || p.endDate) && `${p.startDate ?? '?'} → ${p.endDate ?? '?'}`,
      p.state !== 'active' && `trạng thái: ${p.state}`,
    ].filter(Boolean);
    lines.push(`${mine(p) ? '★ ' : ''}${p.id} | ${info.join(' | ')}`);
    const items = snap.items
      .filter((i) => i.projectId === p.id && i.status !== 'done' && i.status !== 'postponed')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, MAX_ITEMS_PER_PROJECT);
    for (const i of items)
      lines.push(`  - ${i.id} [${i.type}, ${i.status}, ${i.priority}, ${i.date}${i.owner ? `, ${i.owner}` : ''}] ${i.title}`);
  }
  lines.push('</du_an>', '', '<nguoi_dung>');
  for (const u of snap.users) lines.push(`${u.id} | ${u.name} | ${u.role}`);
  lines.push('</nguoi_dung>');
  return lines.join('\n');
}

const firstIssue = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
const opt = (s: string | null | undefined) => (s?.trim() ? s.trim() : undefined);
/** Copies the defined values only. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

interface Ctx {
  snap: Snapshot;
  me: User;
  users: Set<string>;
  /** Model ref (e.g. "NEW1") → name of the project created in this note. */
  newProjects: Map<string, string>;
  defaultProjectId?: string;
}

const NO_CHANGE = () => l('Không có thay đổi nào', '変更はありません');

/** Unknown people would make the POST fail: leave them out and say so. */
function person(ctx: Ctx, raw: string | null, label: string, warnings: string[]) {
  const id = opt(raw)?.toLowerCase();
  if (!id) return undefined;
  if (ctx.users.has(id)) return id;
  warnings.push(l(`Không có người dùng "${raw}" — để trống ${label}`, `ユーザー「${raw}」が存在しません — ${label}は空欄にします`));
  return undefined;
}

function projectFields(a: AiRawAction, ctx: Ctx, warnings: string[]) {
  const supporters = a.supporters?.map((s) => person(ctx, s, l('người hỗ trợ', 'サポーター'), warnings)).filter((s): s is string => !!s);
  return defined({
    name: opt(a.name),
    customer: opt(a.customer),
    pl: person(ctx, a.pl, 'PL', warnings),
    gl: person(ctx, a.gl, 'GL', warnings),
    supporters: a.supporters ? supporters : undefined,
    startDate: opt(a.startDate),
    endDate: opt(a.endDate),
    state: a.state ?? undefined,
    updateFrequencyHours: a.frequencyHours == null ? undefined : Math.round(a.frequencyHours),
  });
}

function itemChanges(a: AiRawAction, ctx: Ctx, warnings: string[]) {
  return defined({
    title: opt(a.title),
    type: a.itemType ?? undefined,
    date: opt(a.date),
    priority: a.priority ?? undefined,
    owner: person(ctx, a.owner, l('người phụ trách', '担当者'), warnings),
    status: a.status ?? undefined,
    note: opt(a.note),
  });
}

const pick = <T extends object>(o: T, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k]])) as Partial<T>;

/** Drops the fields the note "changes" to the value they already have. */
function changesOnly<T extends object>(body: Partial<T>, current: object | undefined): Partial<T> {
  if (!current) return body;
  const cur = current as Record<string, unknown>;
  return Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(cur[k]))) as Partial<T>;
}

function toProposal(a: AiRawAction, ctx: Ctx): Proposal {
  const { snap } = ctx;
  const warnings: string[] = [];
  const done = <P extends Proposal>(p: P): P => (warnings.length ? { ...p, warnings } : p);

  if (a.kind === 'project_create') {
    const ref = a.projectId.trim().toUpperCase();
    const { state: _state, ...body } = { name: '', ...projectFields(a, ctx, warnings) };
    const res = createProjectSchema.safeParse(body);
    return done({
      kind: 'project_create',
      projectId: ref,
      projectName: body.name,
      newProject: true,
      body,
      error: res.success ? undefined : firstIssue(res.error),
    });
  }

  let projectId = a.projectId.trim().toUpperCase() || (ctx.defaultProjectId ?? '');
  let item: Item | undefined;
  if (a.kind === 'item_status' || a.kind === 'item_update') {
    // The item id is unique, so it also tells which project the note meant.
    item = snap.items.find((i) => i.id === (a.itemId ?? '').trim().toUpperCase());
    if (item) projectId = item.projectId;
  }
  const project = snap.projects.find((p) => p.id === projectId);
  const newName = ctx.newProjects.get(projectId);
  const onNew = newName !== undefined && (a.kind === 'update' || a.kind === 'item');
  const needsProject = !projectId && (a.kind === 'update' || a.kind === 'item');
  const badProject = !(project || needsProject || onNew);
  const base = {
    projectId,
    projectName: project?.name ?? (onNew ? newName : undefined),
    needsProject: needsProject || undefined,
    newProject: onNew || undefined,
    badProject: badProject || undefined,
    error: !badProject
      ? undefined
      : projectId
        ? l(`Không tìm thấy dự án ${projectId}`, `プロジェクト ${projectId} が見つかりません`)
        : l('Không xác định được dự án', 'プロジェクトを特定できません'),
  };
  const check = (res: { success: boolean; error?: Parameters<typeof firstIssue>[0] }, extra?: string) =>
    base.error ?? extra ?? (res.success ? undefined : firstIssue(res.error!));

  if (a.kind === 'update') {
    const body = { health: a.health ?? undefined, summary: a.summary?.trim() ?? '', needHelp: opt(a.needHelp) };
    return done({ ...base, kind: 'update', body, error: check(createUpdateSchema.safeParse(body)) });
  }
  if (a.kind === 'item') {
    const body = {
      type: a.itemType ?? 'issue',
      title: a.title?.trim() ?? '',
      priority: a.priority ?? 'medium',
      date: a.date ?? '',
      owner: person(ctx, a.owner, l('người phụ trách', '担当者'), warnings),
    };
    return done({ ...base, kind: 'item', body, error: check(createItemSchema.safeParse(body)) });
  }
  if (a.kind === 'project_update') {
    const body = changesOnly(projectFields(a, ctx, warnings), project);
    const keys = Object.keys(body);
    const allowed = project && can.editProject(ctx.me, project);
    return done({
      ...base,
      kind: 'project_update',
      body,
      before: project ? (pick(project, keys) as Partial<ProjectFields>) : {},
      error: check(
        patchProjectSchema.safeParse(body),
        !keys.length
          ? NO_CHANGE()
          : project && !allowed
            ? l(
                'Bạn không có quyền sửa dự án này (chỉ PMO, quản lý, GL / PL của dự án)',
                'このプロジェクトを編集する権限がありません（PMO・管理者・プロジェクトの GL / PL のみ）',
              )
            : undefined,
      ),
    });
  }

  const itemId = (a.itemId ?? '').trim().toUpperCase();
  const missing = item
    ? undefined
    : l(
        `Không tìm thấy mục ${itemId}${projectId ? ` trong ${projectId}` : ''}`,
        `${projectId ? `${projectId} に` : ''}項目 ${itemId} が見つかりません`,
      );
  if (a.kind === 'item_update') {
    const body = changesOnly(itemChanges(a, ctx, warnings), item);
    const keys = Object.keys(body);
    return done({
      ...base,
      kind: 'item_update',
      itemId,
      itemTitle: item?.title,
      body,
      before: item ? pick(item, keys) : {},
      error: check(patchItemSchema.safeParse(body), missing ?? (!keys.length ? NO_CHANGE() : undefined)),
    });
  }
  const body = { status: a.status ?? 'done', note: opt(a.note) };
  return done({
    ...base,
    kind: 'item_status',
    itemId,
    itemTitle: item?.title,
    body,
    error: check(patchItemSchema.safeParse(body), missing),
  });
}

export function toProposals(
  out: AiOutput,
  snap: Snapshot,
  me: User,
  defaultProjectId?: string,
): { proposals: Proposal[]; questions: string[] } {
  // Give every new project a NEW<n> ref the web can resolve once it is created.
  const newProjects = new Map<string, string>();
  const renamed = new Map<string, string>();
  const actions = out.actions.map((a) => {
    if (a.kind !== 'project_create') return a;
    const raw = a.projectId.trim().toUpperCase();
    const ref = NEW_REF.test(raw) && !newProjects.has(raw) ? raw : `NEW${newProjects.size + 1}`;
    if (raw) renamed.set(raw, ref);
    newProjects.set(ref, a.name?.trim() ?? '');
    return { ...a, projectId: ref };
  });
  const ctx: Ctx = {
    snap,
    me,
    users: new Set(snap.users.map((u) => u.id)),
    newProjects,
    defaultProjectId: snap.projects.some((p) => p.id === defaultProjectId) ? defaultProjectId : undefined,
  };
  const proposals = actions.map((a) => {
    const raw = a.projectId.trim().toUpperCase();
    const fixed = a.kind !== 'project_create' && renamed.has(raw) ? { ...a, projectId: renamed.get(raw)! } : a;
    return toProposal(fixed, ctx);
  });
  // Create projects first, so the actions on them can use the real id.
  proposals.sort((x, y) => Number(y.kind === 'project_create') - Number(x.kind === 'project_create'));
  return { proposals, questions: out.questions.filter((q) => q.trim()) };
}
