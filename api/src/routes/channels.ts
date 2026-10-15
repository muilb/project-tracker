import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { deliver, testMessage } from '../notify/alerts.js';
import { isTeamsWebhookUrl, maskUrl } from '../notify/teams.js';
import { createChannelSchema, parseBody, patchChannelSchema } from '../schemas.js';
import type { Channel, User } from '../types.js';

export const channels = new Hono<AppEnv>();

/** The webhook URL works as a password for posting into the channel: never send it back. */
function publicChannel({ webhookUrl, ...rest }: Channel) {
  return { ...rest, webhookUrlMasked: maskUrl(webhookUrl) };
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
  const notify = c.get('notify');
  const body = await parseBody(c.req, createChannelSchema);
  checkUrl(body.webhookUrl);
  const now = c.get('now');
  const channel: Channel = {
    id: `C${String(await c.get('store').nextSeq('channel')).padStart(3, '0')}`,
    kind: 'teams',
    ...body,
    enabled: true,
    createdBy: c.get('user').id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  // Verify the URL by sending a test message before saving.
  try {
    await notify.send(channel.webhookUrl, testMessage(channel, notify.webUrl));
  } catch (e) {
    throw new HTTPException(400, { message: `Không gửi được tin thử tới Teams: ${(e as Error).message}` });
  }
  channel.lastSentAt = now.toISOString();
  await c.get('store').putChannel(channel);
  return c.json({ channel: publicChannel(channel) }, 201);
});

channels.patch('/:id', async (c) => {
  const ch = await load(c, c.req.param('id'));
  ensure(canEdit(c.get('user'), ch), 'Chỉ người tạo kênh hoặc PMO / quản lý mới được sửa');
  const body = await parseBody(c.req, patchChannelSchema);
  if (body.webhookUrl) checkUrl(body.webhookUrl);
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
  const ok = await deliver(notify, ch, testMessage(ch, notify.webUrl), c.get('now'));
  const saved = (await c.get('store').getChannel(ch.id))!;
  if (!ok) throw new HTTPException(502, { message: `Gửi thử thất bại: ${saved.lastError}` });
  return c.json({ channel: publicChannel(saved) });
});
