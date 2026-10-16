import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { TEST_SAMPLES } from './notify/alerts.js';
import { l, LANGS } from './i18n.js';
import { isDate } from './time.js';
import {
  ALERT_EVENTS,
  CHANNEL_KINDS,
  HEALTHS,
  ITEM_STATUSES,
  ITEM_TYPES,
  PRIORITIES,
  PROJECT_STATES,
  ROLES,
  SCOPE_TYPES,
} from './types.js';

/** A message evaluated per request, so it follows the caller's language. */
const msg = (vi: string, ja: string) => ({ error: () => l(vi, ja) });

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email(msg('Email không hợp lệ', 'メールアドレスが正しくありません')));
const date = z.string().refine(isDate, msg('Ngày phải có dạng YYYY-MM-DD', '日付は YYYY-MM-DD 形式で入力してください'));
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).optional();

const projectFields = {
  name: text(200).min(1, msg('Tên dự án không được trống', 'プロジェクト名を入力してください')),
  customer: optText(200),
  gl: email.optional(),
  pl: email.optional(),
  supporters: z.array(email).max(20).optional(),
  pmo: email.optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  updateFrequencyHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .nullable()
    .optional(),
  publicVisible: z.boolean().optional(),
  publicName: optText(200),
};

export const createProjectSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9_-]{2,20}$/,
      msg('Mã dự án chỉ gồm chữ, số, - và _ (2–20 ký tự)', 'プロジェクトコードは英数字・-・_ の 2〜20 文字です'),
    )
    .transform((s) => s.toUpperCase())
    .optional(),
  ...projectFields,
});

export const patchProjectSchema = z.object({ ...projectFields, state: z.enum(PROJECT_STATES).optional() }).partial();

export const createUpdateSchema = z.object({
  health: z.enum(HEALTHS).optional(),
  summary: text(4000).min(1, msg('Nội dung tình hình không được trống', '状況の内容を入力してください')),
  needHelp: optText(2000),
  rawText: optText(8000),
  at: z.iso.datetime({ offset: true }).optional(),
});

const itemFields = {
  type: z.enum(ITEM_TYPES),
  title: text(500).min(1, msg('Nội dung không được trống', '内容を入力してください')),
  priority: z.enum(PRIORITIES).default('medium'),
  date,
  owner: email.optional(),
  status: z.enum(ITEM_STATUSES).default('open'),
  note: optText(2000),
};

export const createItemSchema = z.object(itemFields);

export const patchItemSchema = z
  .object({
    ...itemFields,
    priority: z.enum(PRIORITIES),
    status: z.enum(ITEM_STATUSES),
  })
  .partial();

export const createUserSchema = z.object({
  id: email,
  name: text(100).min(1),
  role: z.enum(ROLES).default('PL'),
});

export const approveAccountSchema = z.object({ role: z.enum(ROLES).optional() });

export const patchUserSchema = z.object({ name: text(100).min(1), role: z.enum(ROLES) }).partial();

export const settingsSchema = z.object({
  frequencyHours: z.object({
    green: z.number().int().min(1),
    yellow: z.number().int().min(1),
    red: z.number().int().min(1),
  }),
  soonDays: z.number().int().min(0).max(60),
  nearEventFrequencyHours: z.number().int().min(1),
  upcomingDays: z.number().int().min(1).max(60),
});

const channelFields = {
  name: text(100).min(1, msg('Tên kênh không được trống', 'チャネル名を入力してください')),
  webhookUrl: z.string().trim().url(msg('URL webhook không hợp lệ', 'Webhook URL が正しくありません')).max(2000).optional(),
  scope: z
    .object({
      type: z.enum(SCOPE_TYPES),
      gl: email.optional(),
      projects: z.array(z.string().trim().toUpperCase()).max(100).optional(),
    })
    .refine((s) => s.type !== 'gl' || !!s.gl, msg('Chọn GL cho phạm vi theo nhóm', 'GL別の対象範囲では GL を選択してください'))
    .refine((s) => s.type !== 'projects' || !!s.projects?.length, msg('Chọn ít nhất một dự án', 'プロジェクトを 1 つ以上選択してください')),
  events: z.array(z.enum(ALERT_EVENTS)).min(1, msg('Chọn ít nhất một loại thông báo', '通知の種類を 1 つ以上選択してください')),
  quietHours: z.boolean().default(true),
  /** Language of the messages sent to this channel. */
  lang: z.enum(LANGS).optional(),
};

export const createChannelSchema = z
  .object({
    ...channelFields,
    kind: z.enum(CHANNEL_KINDS).default('teams'),
    /** Telegram: code the user sent to the bot, used to find the chat. */
    connectCode: z.string().trim().max(40).optional(),
  })
  .refine((b) => b.kind !== 'teams' || !!b.webhookUrl, {
    ...msg('Nhập URL webhook của Teams', 'Teams の Webhook URL を入力してください'),
    path: ['webhookUrl'],
  })
  .refine((b) => b.kind !== 'telegram' || !!b.connectCode, {
    ...msg('Thiếu mã kết nối Telegram', 'Telegram の接続コードがありません'),
    path: ['connectCode'],
  });

export const aiKeySchema = z.object({
  apiKey: z.string().trim().min(20, msg('API key không hợp lệ', 'API キーが正しくありません')).max(300),
});
export const aiParseSchema = z.object({
  text: text(4000).min(1, msg('Nhập nội dung cần ghi', '入力する内容を書いてください')),
  /** Used when the note does not name a project. */
  projectId: z.string().trim().toUpperCase().max(20).optional(),
});

export const aiAskSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: text(8000).min(1) }))
    .min(1)
    .max(20)
    .refine((m) => m.every((x, i) => x.role === (i % 2 ? 'assistant' : 'user')) && m.length % 2 === 1, {
      ...msg(
        'Hội thoại phải xen kẽ câu hỏi / trả lời và kết thúc bằng câu hỏi',
        '会話は質問と回答が交互で、最後は質問である必要があります',
      ),
    }),
});

export const testSampleSchema = z.object({ sample: z.enum(TEST_SAMPLES).default('connect') });

export const telegramBotSchema = z.object({ token: z.string().trim().min(10).max(200) });
export const patchChannelSchema = z.object({ ...channelFields, quietHours: z.boolean(), enabled: z.boolean() }).partial();

export async function parseBody<T extends z.ZodType>(req: { json(): Promise<unknown> }, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HTTPException(400, { message: l('Body phải là JSON', 'Body は JSON である必要があります') });
  }
  const res = schema.safeParse(body);
  if (!res.success) {
    const msg = res.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HTTPException(400, { message: msg });
  }
  return res.data;
}
