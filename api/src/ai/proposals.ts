import { createItemSchema, createUpdateSchema, patchItemSchema } from '../schemas.js';
import type { Snapshot } from '../store/store.js';
import { vnDate } from '../time.js';
import type { Health, ItemStatus, ItemType, Priority, User } from '../types.js';
import type { AiOutput, AiRawAction } from './assistant.js';

/** A change the AI suggests; the web posts `body` to the matching REST endpoint once the user confirms. */
export type Proposal = { projectId: string; projectName?: string; error?: string } & (
  | { kind: 'update'; body: { health?: Health; summary: string; needHelp?: string } }
  | { kind: 'item'; body: { type: ItemType; title: string; priority: Priority; date: string; owner?: string } }
  | { kind: 'item_status'; itemId: string; itemTitle?: string; body: { status: ItemStatus; note?: string } }
);

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const MAX_ITEMS_PER_PROJECT = 30;

function calendar(now: Date, days: number): string {
  const today = Date.parse(vnDate(now));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today + i * 86_400_000);
    return `${d.toISOString().slice(0, 10)} ${WEEKDAYS[d.getUTCDay()]}`;
  }).join('\n');
}

/** What the model needs to resolve names and relative dates: open projects, their open items, people, calendar. */
export function buildContext(snap: Snapshot, now: Date, me: User): string {
  const projects = snap.projects.filter((p) => p.state !== 'closed').sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    `Hôm nay: ${vnDate(now)} (${WEEKDAYS[new Date(vnDate(now)).getUTCDay()]}). Người viết ghi chú: ${me.name} <${me.id}>.`,
    '',
    '<lich_3_tuan>',
    calendar(now, 21),
    '</lich_3_tuan>',
    '',
    '<du_an>',
  ];
  for (const p of projects) {
    lines.push(`${p.id} | ${p.name}${p.customer ? ` | khách: ${p.customer}` : ''}${p.pl ? ` | PL: ${p.pl}` : ''}${p.gl ? ` | GL: ${p.gl}` : ''}`);
    const items = snap.items
      .filter((i) => i.projectId === p.id && i.status !== 'done' && i.status !== 'postponed')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, MAX_ITEMS_PER_PROJECT);
    for (const i of items) lines.push(`  - ${i.id} [${i.type}, ${i.status}, ${i.date}] ${i.title}`);
  }
  lines.push('</du_an>', '', '<nguoi_dung>');
  for (const u of snap.users) lines.push(`${u.id} | ${u.name} | ${u.role}`);
  lines.push('</nguoi_dung>');
  return lines.join('\n');
}

const firstIssue = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');

function toProposal(a: AiRawAction, snap: Snapshot): Proposal {
  const projectId = a.projectId.trim().toUpperCase();
  const project = snap.projects.find((p) => p.id === projectId);
  const base = { projectId, projectName: project?.name, error: project ? undefined : `Không tìm thấy dự án ${projectId}` };
  const users = new Set(snap.users.map((u) => u.id));
  const opt = (s: string | null) => (s?.trim() ? s.trim() : undefined);

  if (a.kind === 'update') {
    const body = { health: a.health ?? undefined, summary: a.summary?.trim() ?? '', needHelp: opt(a.needHelp) };
    const res = createUpdateSchema.safeParse(body);
    return { ...base, kind: 'update', body, error: base.error ?? (res.success ? undefined : firstIssue(res.error)) };
  }
  if (a.kind === 'item') {
    const owner = opt(a.owner)?.toLowerCase();
    const body = {
      type: a.itemType ?? 'issue',
      title: a.title?.trim() ?? '',
      priority: a.priority ?? 'medium',
      date: a.date ?? '',
      // An unknown person would make the POST fail; leave the owner empty instead.
      owner: owner && users.has(owner) ? owner : undefined,
    };
    const res = createItemSchema.safeParse(body);
    return { ...base, kind: 'item', body, error: base.error ?? (res.success ? undefined : firstIssue(res.error)) };
  }
  const itemId = (a.itemId ?? '').trim().toUpperCase();
  const item = snap.items.find((i) => i.projectId === projectId && i.id === itemId);
  const body = { status: a.status ?? 'done', note: opt(a.note) };
  const res = patchItemSchema.safeParse(body);
  return {
    ...base,
    kind: 'item_status',
    itemId,
    itemTitle: item?.title,
    body,
    error: base.error ?? (item ? undefined : `Không tìm thấy mục ${itemId} trong ${projectId}`) ?? (res.success ? undefined : firstIssue(res.error)),
  };
}

export function toProposals(out: AiOutput, snap: Snapshot): { proposals: Proposal[]; questions: string[] } {
  return { proposals: out.actions.map((a) => toProposal(a, snap)), questions: out.questions.filter((q) => q.trim()) };
}
