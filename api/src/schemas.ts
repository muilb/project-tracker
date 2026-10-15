import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { isDate } from './time.js';
import { HEALTHS, ITEM_STATUSES, ITEM_TYPES, PRIORITIES, PROJECT_STATES, ROLES } from './types.js';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Email không hợp lệ' }));
const date = z.string().refine(isDate, 'Ngày phải có dạng YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).optional();

const projectFields = {
  name: text(200).min(1, 'Tên dự án không được trống'),
  customer: optText(200),
  gl: email.optional(),
  pl: email.optional(),
  supporters: z.array(email).max(20).optional(),
  pmo: email.optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  updateFrequencyHours: z.number().int().min(1).max(24 * 60).nullable().optional(),
  publicVisible: z.boolean().optional(),
  publicName: optText(200),
};

export const createProjectSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,20}$/, 'Mã dự án chỉ gồm chữ, số, - và _ (2–20 ký tự)')
    .transform((s) => s.toUpperCase())
    .optional(),
  ...projectFields,
});

export const patchProjectSchema = z
  .object({ ...projectFields, state: z.enum(PROJECT_STATES).optional() })
  .partial();

export const createUpdateSchema = z.object({
  health: z.enum(HEALTHS).optional(),
  summary: text(4000).min(1, 'Nội dung tình hình không được trống'),
  needHelp: optText(2000),
  rawText: optText(8000),
  at: z.iso.datetime({ offset: true }).optional(),
});

const itemFields = {
  type: z.enum(ITEM_TYPES),
  title: text(500).min(1, 'Nội dung không được trống'),
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

export async function parseBody<T extends z.ZodType>(req: { json(): Promise<unknown> }, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HTTPException(400, { message: 'Body phải là JSON' });
  }
  const res = schema.safeParse(body);
  if (!res.success) {
    const msg = res.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HTTPException(400, { message: msg });
  }
  return res.data;
}
