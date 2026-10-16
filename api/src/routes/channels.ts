import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { deliver, sampleMessage, testMessage } from '../notify/alerts.js';
import { isTeamsWebhookUrl, maskUrl } from '../notify/teams.js';
import { createChannelSchema, parseBody, patchChannelSchema, testSampleSchema } from '../schemas.js';
import type { Channel, User } from '../types.js';

export const channels = new Hono<AppEnv>();

/** The Teams webhook URL works as a password for posting into the channel: never send it back. */
function publicChannel({ webhookUrl, ...rest }: Channel) {
  return { ...rest, ...(webhookUrl ? { webhookUrlMasked: maskUrl(webhookUrl) } : {}) };
}

const canEdit = (u: User, ch: Channel) => can.admin(u) || ch.createdBy === u.id;

function checkUrl(url: string) {
  if (!isTeamsWebhookUrl(url))
    throw new HTTPException(400, {
      message: 'URL phải là webhook của Teams Workflows (https://…logic.azure.com/… hoặc …powerplatform.com/…)',
    });
}

async function load(c: { get: (k: 'store') => AppEnv['Variables']['store'] }, id: string) {
  const ch = await c.get('store').getChannel(id);
  if (!ch) throw new HTTPException(404, { message: 'Không tìm thấy kênh' });
  return ch;
}

channels.get('/', async (c) => {
  const me = c.get('user');
  const all = await c.get('store').listChannels();
  // Admins see every channel; others see the ones they registered.
  const list = all.filter((ch) => can.admin(me) || ch.createdBy === me.id).sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ channels: list.map(publicChannel) });
});

channels.post('/', async (c) => {
  const store = c.get('store');
  const notify = c.get('notify');
  const { connectCode, ...body } = await parseBody(c.req, createChannelSchema);
  const now = c.get('now');
  const base = {
    name: body.name,
    scope: body.scope,
    events: body.events,
    quietHours: body.quietHours,
    enabled: true,
    createdBy: c.get('user').id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  let target: Pick<Channel, 'kind' | 'webhookUrl' | 'telegramChatId' | 'telegramChatTitle'>;
  if (body.kind === 'telegram') {
    const bot = await store.getTelegramBot();
    if (!bot) throw new HTTPException(400, { message: 'PMO chưa cài bot Telegram (Cài đặt → Telegram)' });
    let chat, seen: string[];
    try {
      ({ chat, seen } = await c.get('telegram').findChatByText(bot.token, connectCode!));
    } catch (e) {
      throw new HTTPException(502, { message: `Không đọc được tin nhắn của bot: ${(e as Error).message}` });
    }
    if (!chat)
      throw new HTTPException(400, {
        message:
          `Bot chưa nhận được mã ${connectCode}. Kiểm tra đã thêm @${bot.username} vào nhóm (xem danh sách thành viên) ` +
          `rồi mới gửi dòng /connect@${bot.username} ${connectCode}, sau đó thử lại. ` +
          (seen.length
            ? `Trong 24 giờ qua bot chỉ nhận được tin từ: ${seen.slice(0, 5).join(', ')}.`
            : `Trong 24 giờ qua bot chưa nhận được tin nào — bot chưa ở trong nhóm, hoặc tin được gửi trước khi thêm bot.`),
      });
    target = { kind: 'telegram', telegramChatId: chat.id, telegramChatTitle: chat.title };
  } else {
    checkUrl(body.webhookUrl!);
    target = { kind: 'teams', webhookUrl: body.webhookUrl };
  }

  const channel: Channel = { id: `C${String(await store.nextSeq('channel')).padStart(3, '0')}`, ...base, ...target };
  // Verify delivery with a test message before saving.
  try {
    await notify.send(channel, testMessage(channel, notify.webUrl));
  } catch (e) {
    throw new HTTPException(400, { message: `Không gửi được tin thử: ${(e as Error).message}` });
  }
  channel.lastSentAt = now.toISOString();
  await store.putChannel(channel);
  return c.json({ channel: publicChannel(channel) }, 201);
});

channels.patch('/:id', async (c) => {
  const ch = await load(c, c.req.param('id'));
  ensure(canEdit(c.get('user'), ch), 'Chỉ người tạo kênh hoặc PMO / quản lý mới được sửa');
  const body = await parseBody(c.req, patchChannelSchema);
  if (body.webhookUrl) {
    if (ch.kind !== 'teams') throw new HTTPException(400, { message: 'Kênh Telegram không có URL webhook' });
    checkUrl(body.webhookUrl);
  }
  const updated: Channel = { ...ch, ...body, updatedAt: c.get('now').toISOString() };
  await c.get('store').putChannel(updated);
  return c.json({ channel: publicChannel(updated) });
});

channels.delete('/:id', async (c) => {
  const ch = await load(c, c.req.param('id'));
  ensure(canEdit(c.get('user'), ch), 'Chỉ người tạo kênh hoặc PMO / quản lý mới được xoá');
  await c.get('store').deleteChannel(ch.id);
  return c.json({ ok: true });
});

channels.post('/:id/test', async (c) => {
  const ch = await load(c, c.req.param('id'));
  ensure(canEdit(c.get('user'), ch), 'Chỉ người tạo kênh hoặc PMO / quản lý mới được gửi thử');
  const notify = c.get('notify');
  const parsed = testSampleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: 'Mẫu tin không hợp lệ' });
  const msg = await sampleMessage(notify, ch, parsed.data.sample, c.get('now'));
  const ok = await deliver(notify, ch, msg, c.get('now'));
  const saved = (await c.get('store').getChannel(ch.id))!;
  if (!ok) throw new HTTPException(502, { message: `Gửi thử thất bại: ${saved.lastError}` });
  return c.json({ channel: publicChannel(saved) });
});
