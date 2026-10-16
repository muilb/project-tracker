// Natural-language entry: Claude reads a free-text note and proposes project
// updates, new / changed items, and new / changed projects. Nothing is written here —
// the web shows the proposals and, once confirmed, posts them through the normal
// REST endpoints (same validation, permissions and alerts as manual entry).
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { HEALTHS, ITEM_STATUSES, ITEM_TYPES, PRIORITIES, PROJECT_STATES } from '../types.js';

export const AI_ACTION_KINDS = ['update', 'item', 'item_status', 'item_update', 'project_create', 'project_update'] as const;

export const AI_MODEL = 'claude-haiku-5-5';

/** Raw model output. One flat shape per action keeps the schema simple; unused fields are null. */
export const aiOutputSchema = z.object({
  actions: z.array(
    z.object({
      kind: z.enum(AI_ACTION_KINDS),
      projectId: z.string(),
      health: z.enum(HEALTHS).nullable(),
      summary: z.string().nullable(),
      needHelp: z.string().nullable(),
      itemType: z.enum(ITEM_TYPES).nullable(),
      title: z.string().nullable(),
      priority: z.enum(PRIORITIES).nullable(),
      date: z.string().nullable(),
      owner: z.string().nullable(),
      itemId: z.string().nullable(),
      status: z.enum(ITEM_STATUSES).nullable(),
      note: z.string().nullable(),
      name: z.string().nullable(),
      customer: z.string().nullable(),
      pl: z.string().nullable(),
      gl: z.string().nullable(),
      supporters: z.array(z.string()).nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      state: z.enum(PROJECT_STATES).nullable(),
      frequencyHours: z.number().nullable(), // no .int(): it adds min/max, which structured output rejects
    }),
  ),
  questions: z.array(z.string()),
});
export type AiOutput = z.infer<typeof aiOutputSchema>;

// Built with zod's own converter: the SDK's zod helper turns `enum` into a description,
// and the enums are what keep health / type / status values valid.
const { $schema: _ignored, ...OUTPUT_JSON_SCHEMA } = z.toJSONSchema(aiOutputSchema) as Record<string, unknown>;
export type AiRawAction = AiOutput['actions'][number];

/** An action with every field null (fakes and tests fill in what they need). */
export function blankAction(over: Partial<AiRawAction> & Pick<AiRawAction, 'kind'>): AiRawAction {
  const blank = Object.fromEntries(Object.keys(aiOutputSchema.shape.actions.element.shape).map((k) => [k, null]));
  return { ...blank, projectId: '', ...over } as AiRawAction;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 502 | 503 = 502,
  ) {
    super(message);
  }
}

/** Boundary to the Claude API so tests can inject a fake. */
export interface AiClient {
  /** Throws AiError when the key is rejected. */
  verifyKey(apiKey: string): Promise<void>;
  extract(apiKey: string, context: string, text: string): Promise<AiOutput>;
}

const SYSTEM = `Bạn là trợ lý nhập liệu cho hệ thống theo dõi dự án của một công ty phần mềm Việt Nam.
Người dùng viết ghi chú tự do (tiếng Việt, có thể lẫn tiếng Anh/Nhật) về tình hình dự án. Hãy chuyển ghi chú thành các thao tác:

- kind "update": báo cáo tình hình dự án. summary = tóm tắt ngắn gọn, rõ ràng tình hình (giữ ý chính, không bịa thêm). health = "green" (tốt) / "yellow" (cần chú ý, có rủi ro) / "red" (nghiêm trọng, trễ, khách phàn nàn nặng) — chỉ điền khi ghi chú nói rõ hoặc suy ra chắc chắn, nếu không thì null. needHelp = việc cần hỗ trợ / nhờ cấp trên, nếu có.
- kind "item": thêm vấn đề hoặc sự kiện mới. itemType = "issue" (vấn đề, rủi ro, sự cố cần xử lý — date là hạn xử lý), "event" (sự kiện: họp, demo, đi khách hàng, phỏng vấn — date là ngày diễn ra), "milestone" (mốc: release, nghiệm thu, bàn giao — date là ngày mốc). title ngắn gọn. priority "high"/"medium"/"low" (mặc định "medium"; sự cố khách hàng, chặn tiến độ là "high"). date dạng YYYY-MM-DD; tính ngày tương đối ("thứ 6", "tuần sau", "cuối tháng") theo ngày hôm nay đã cho; với issue không có hạn thì đặt hạn 7 ngày sau hôm nay. owner = email người phụ trách nếu ghi chú nêu tên khớp danh sách người dùng, ngược lại null.
- kind "item_status": chỉ đổi trạng thái một vấn đề/sự kiện ĐANG CÓ trong danh sách (itemId lấy từ danh sách). status = "open" / "in_progress" / "done" / "postponed". note = ghi chú ngắn nếu có.
- kind "item_update": sửa mục ĐANG CÓ khi ghi chú nói dời ngày, đổi ưu tiên, đổi người phụ trách, đổi nội dung (itemId lấy từ danh sách). Chỉ điền các trường thay đổi: title, date, priority, owner, itemType, status, note; trường không đổi để null. Chỉ đổi trạng thái thì dùng "item_status".
- kind "project_create": tạo dự án MỚI (ghi chú nói rõ là dự án mới / bắt đầu dự án chưa có trong danh sách). projectId = "NEW1" (dự án mới thứ hai là "NEW2"…). name = tên dự án (bắt buộc), customer = khách hàng, pl / gl = email trong danh sách người dùng, supporters = danh sách email người hỗ trợ, startDate / endDate dạng YYYY-MM-DD, frequencyHours = tần suất cập nhật (giờ) nếu ghi chú nêu. Các mốc, sự kiện, vấn đề, cập nhật của dự án mới là các thao tác riêng với projectId = "NEW1".
- kind "project_update": sửa thông tin dự án ĐANG CÓ: name, customer, pl, gl, supporters (danh sách mới đầy đủ), startDate, endDate, state ("active" đang chạy / "paused" tạm dừng / "closed" đóng), frequencyHours. Chỉ điền trường thay đổi, còn lại null.

Quy tắc:
- projectId phải là mã dự án trong danh sách (hoặc NEW1, NEW2… cho dự án mới tạo trong cùng ghi chú). Nhận diện dự án qua mã, tên, tên khách hàng.
- Khi ghi chú không nêu dự án: dùng "Dự án mặc định" nếu có; nếu không có thì dùng dự án đánh dấu ★ (dự án của người viết) khi người viết chỉ có đúng một dự án ★; nếu vẫn không chắc thì VẪN tạo thao tác với projectId = "" (người dùng sẽ tự chọn dự án), không bỏ thao tác.
- Một ghi chú có thể tạo nhiều thao tác, cho nhiều dự án. Mỗi dự án tối đa một "update".
- Nếu ghi chú nói một vấn đề đã có "xong", "đã xử lý", "hoãn"… thì dùng item_status, không tạo item mới trùng.
- Người (owner, pl, gl, supporters) phải là email trong danh sách người dùng; không khớp thì để null và nêu trong questions.
- Các trường không dùng cho loại thao tác đó đặt null.
- Viết summary, title, note, name, questions bằng tiếng Việt (giữ nguyên tên riêng).
- Không có gì để ghi thì trả actions rỗng và giải thích trong questions.`;

function mapApiError(e: unknown): never {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    throw new AiError('API key Claude không hợp lệ hoặc không có quyền (Cài đặt → AI)', 400);
  if (e instanceof Anthropic.NotFoundError) throw new AiError(`Tài khoản không dùng được model ${AI_MODEL}`, 400);
  if (e instanceof Anthropic.RateLimitError) throw new AiError('AI đang quá tải hoặc hết hạn mức, thử lại sau ít phút', 503);
  if (e instanceof Anthropic.APIConnectionError) throw new AiError('Không kết nối được tới Claude API, thử lại sau', 503);
  if (e instanceof Anthropic.APIError) throw new AiError(`Claude API lỗi ${e.status ?? ''}: ${e.message}`, 502);
  throw e;
}

export const claudeClient: AiClient = {
  async verifyKey(apiKey) {
    try {
      await new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 }).models.retrieve(AI_MODEL);
    } catch (e) {
      mapApiError(e);
    }
  },

  async extract(apiKey, context, text) {
    // API Gateway cuts requests at 30 s, so keep the whole call well under that.
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 12_000 });
    let response;
    try {
      response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: `${context}\n\n<ghi_chu>\n${text}\n</ghi_chu>` }],
      });
    } catch (e) {
      mapApiError(e);
    }
    if (response.stop_reason === 'refusal') throw new AiError('AI từ chối xử lý nội dung này', 400);
    if (response.stop_reason === 'max_tokens') throw new AiError('Ghi chú quá dài, hãy chia nhỏ rồi thử lại', 400);
    const json = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed;
    try {
      parsed = aiOutputSchema.safeParse(JSON.parse(json));
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success) throw new AiError('AI trả về kết quả không đọc được, thử lại', 502);
    return parsed.data;
  },
};
