// Notes by chat: a linked PL+ writes free text in the private chat, the bot shows the AI proposals
// (same context and validation as POST /ai/parse) and writes them only when the person confirms,
// through the same code paths as the web (projectOps.ts).
import { randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { AiError } from '../ai/assistant.js';
import { buildContext, toProposals, type Proposal } from '../ai/proposals.js';
import { can } from '../auth.js';
import { l } from '../i18n.js';
import type { Message, MessageLine } from '../notify/message.js';
import { clip, dm, HEALTH, TYPE } from '../notify/render.js';
import { addUpdate, createItem, createProject, patchItem, patchProject, type OpContext } from '../projectOps.js';
import {
  aiParseSchema,
  checkBody,
  createItemSchema,
  createProjectSchema,
  createUpdateSchema,
  patchItemSchema,
  patchProjectSchema,
} from '../schemas.js';
import type { User } from '../types.js';
import type { BotDeps } from './who.js';

/** Proposals wait this long for Confirm / Cancel. */
export const PENDING_TTL_SECONDS = 30 * 60;
export const pendingKey = (id: string) => `tgai#${id}`;

export interface PendingNote {
  userId: string;
  chatId: string;
  text: string;
  proposals: Proposal[];
}

const STATUS = (s: string) =>
  ({
    open: l('Mở', '未着手'),
    in_progress: l('Đang xử lý', '対応中'),
    done: l('Xong', '完了'),
    postponed: l('Hoãn', '延期'),
  })[s] ?? s;

const fields = (body: object) =>
  Object.entries(body)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');

/** One proposal as a chat line. */
export function describe(p: Proposal): string {
  const where = p.newProject ? `${p.projectName ?? p.projectId} (${l('dự án mới', '新規')})` : p.projectId || '?';
  switch (p.kind) {
    case 'update':
      return `📝 **${where}** ${l('cập nhật', '報告')}${p.body.health ? ` [${HEALTH(p.body.health)}]` : ''}: ${clip(p.body.summary, 300)}${
        p.body.needHelp ? `\n   🙋 ${clip(p.body.needHelp, 200)}` : ''
      }`;
    case 'item':
      return `➕ **${where}** ${TYPE(p.body.type)} "${clip(p.body.title, 150)}" · ${dm(p.body.date)}${p.body.owner ? ` · ${p.body.owner}` : ''}`;
    case 'item_status':
      return `✔ **${where}** ${p.itemId}${p.itemTitle ? ` "${clip(p.itemTitle, 100)}"` : ''} → ${STATUS(p.body.status)}${
        p.body.note ? ` (${clip(p.body.note, 150)})` : ''
      }`;
    case 'item_update':
      return `✎ **${where}** ${p.itemId}${p.itemTitle ? ` "${clip(p.itemTitle, 100)}"` : ''}: ${clip(fields(p.body), 300)}`;
    case 'project_create':
      return `🆕 ${l('Dự án mới', '新規プロジェクト')} "${clip(p.body.name, 100)}"${p.body.pl ? ` · PL ${p.body.pl}` : ''}`;
    case 'project_update':
      return `✎ **${where}**: ${clip(fields(p.body), 300)}`;
  }
}

/** Free text from a linked person: proposals with Confirm / Cancel, or why there are none. */
export async function proposeFromNote(deps: BotDeps, user: User, chatId: string, raw: string): Promise<Message> {
  if (!can.createProject(user))
    return { title: l('Chỉ PL trở lên mới dùng nhập bằng AI', 'AI入力は PL 以上のみ利用できます'), lines: [helpHint()] };
  const config = await deps.store.getAiConfig();
  if (!config)
    return {
      title: l('Chưa nhập được ghi chú bằng chat', 'チャットからのメモ入力はまだ使えません'),
      lines: [
        {
          text: l(
            'Quản trị hệ thống chưa cài API key AI (Cài đặt → AI). Bạn vẫn dùng được /mine, /status, /late, hoặc cập nhật trên web.',
            'システム管理者が AI の API キーを未設定です（設定 → AI）。/mine・/status・/late や Web での更新は使えます。',
          ),
        },
      ],
    };
  const { text } = checkBody(aiParseSchema, { text: raw });
  const snap = await deps.store.snapshot({ now: deps.now });
  let out;
  try {
    out = toProposals(await deps.ai.extract(config.apiKey, buildContext(snap, deps.now, user), text), snap, user);
  } catch (e) {
    if (e instanceof AiError)
      return { title: l('AI chưa xử lý được ghi chú', 'AI がメモを処理できませんでした'), lines: [{ text: e.message }] };
    throw e;
  }
  // In the chat there is no project picker: a proposal without a project is shown as a problem.
  const ok = out.proposals.filter((p) => !p.error && !p.needsProject);
  const problems = out.proposals.filter((p) => p.error || p.needsProject);
  const lines: MessageLine[] = [];
  for (const p of ok) {
    lines.push({ text: describe(p) });
    for (const w of p.warnings ?? []) lines.push({ text: `  ▲ ${w}`, subtle: true });
  }
  for (const p of problems)
    lines.push({
      text: `✗ ${describe(p)}\n   ${p.error ?? l('Không rõ dự án nào — ghi rõ mã dự án (vd. P03)', 'どのプロジェクトか不明です — コード（例: P03）を書いてください')}`,
      tone: 'attention',
    });
  for (const q of out.questions) lines.push({ text: `❓ ${q}`, subtle: true });
  if (!ok.length)
    return {
      title: l('AI không tìm thấy thay đổi nào để ghi', 'AI は保存できる変更を見つけられませんでした'),
      lines: lines.length ? lines : [helpHint()],
    };
  const id = randomBytes(6).toString('hex');
  const pending: PendingNote = { userId: user.id, chatId, text, proposals: ok };
  await deps.store.putTemp(pendingKey(id), pending, PENDING_TTL_SECONDS);
  lines.push({
    text: l('Bấm Xác nhận để ghi (trong 30 phút), hoặc Huỷ.', '30 分以内に「確定」を押すと保存されます。やめる場合は「取消」。'),
    subtle: true,
  });
  return {
    title: l(`✦ AI đề xuất ${ok.length} thay đổi`, `✦ AI の提案: ${ok.length} 件の変更`),
    lines,
    actions: [
      { label: l(`✓ Xác nhận (${ok.length})`, `✓ 確定 (${ok.length})`), data: `a:${id}` },
      { label: l('✗ Huỷ', '✗ 取消'), data: `x:${id}` },
    ],
  };
}

function helpHint(): MessageLine {
  return { text: l('Gõ /help để xem các lệnh.', '/help でコマンド一覧を表示します。'), subtle: true };
}

/** Writes the confirmed proposals in the web's order: new projects first, so the rest can use their real id. */
export async function applyPending(deps: BotDeps, user: User, pending: PendingNote): Promise<Message> {
  const ctx: OpContext = { store: deps.store, notify: deps.notify, now: deps.now, user };
  const created = new Map<string, { id: string; name: string }>();
  const order = [...pending.proposals].sort((a, b) => Number(b.kind === 'project_create') - Number(a.kind === 'project_create'));
  const lines: MessageLine[] = [];
  let saved = 0;
  for (let p of order) {
    try {
      if (p.newProject && p.kind !== 'project_create') {
        const real = created.get(p.projectId);
        if (!real) throw new HTTPException(400, { message: l('Dự án mới chưa được tạo', '新規プロジェクトが作成されていません') });
        p = { ...p, projectId: real.id, projectName: real.name, newProject: undefined };
      }
      switch (p.kind) {
        case 'project_create': {
          const project = await createProject(ctx, checkBody(createProjectSchema, p.body));
          created.set(p.projectId, { id: project.id, name: project.name });
          p = { ...p, projectId: project.id, newProject: undefined };
          break;
        }
        case 'project_update':
          await patchProject(ctx, p.projectId, checkBody(patchProjectSchema, p.body));
          break;
        case 'update':
          await addUpdate(ctx, p.projectId, checkBody(createUpdateSchema, { ...p.body, rawText: pending.text }));
          break;
        case 'item':
          await createItem(ctx, p.projectId, checkBody(createItemSchema, p.body));
          break;
        default:
          await patchItem(ctx, p.projectId, p.itemId, checkBody(patchItemSchema, p.body));
      }
      saved++;
      lines.push({ text: `✓ ${describe(p)}`, tone: 'good' });
    } catch (e) {
      if (!(e instanceof HTTPException)) throw e;
      lines.push({ text: `✗ ${describe(p)}\n   ${e.message}`, tone: 'attention' });
    }
  }
  return {
    title:
      saved === order.length
        ? l(`✓ Đã ghi ${saved} thay đổi`, `✓ ${saved} 件の変更を保存しました`)
        : l(`Đã ghi ${saved}/${order.length} thay đổi`, `${order.length} 件中 ${saved} 件を保存しました`),
    tone: saved === order.length ? 'good' : 'warning',
    lines,
  };
}
