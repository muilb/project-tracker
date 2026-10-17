import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { l, lang, withLang } from '../i18n.js';
import { deliver } from '../notify/deliver.js';
import { testMessage } from '../notify/render.js';
import { sampleMessage } from '../notify/samples.js';
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
      message: l(
        'URL phải là webhook của Teams Workflows (https://…logic.azure.com/… hoặc …powerplatform.com/…)',
        'URL は Teams Workflows の Webhook である必要があります（https://…logic.azure.com/… または …powerplatform.com/…）',
      ),
    });
}

/** The chat (group or private) where the bot received `connectCode`, with an explanation when it did not. */
async function findTelegramChat(c: Context<AppEnv>, connectCode: string) {
  const bot = await c.get('store').getTelegramBot();
  if (!bot)
    throw new HTTPException(400, {
      message: l('Quản trị hệ thống chưa cài bot Telegram (Cài đặt → Telegram)', 'システム管理者が Telegram ボットを未設定です（設定 → Telegram）'),
    });
  let chat, seen: string[];
  try {
    ({ chat, seen } = await c.get('telegram').findChatByText(bot.token, connectCode));
  } catch (e) {
    throw new HTTPException(502, {
      message: l('Không đọc được tin nhắn của bot: ', 'ボットのメッセージを読み込めません: ') + (e as Error).message,
    });
  }
  if (!chat)
    throw new HTTPException(400, {
      message:
        l(
          `Bot chưa nhận được mã ${connectCode}. Kiểm tra đã thêm @${bot.username} vào nhóm (xem danh sách thành viên) ` +
            `rồi mới gửi dòng /connect@${bot.username} ${connectCode}, sau đó thử lại. `,
          `ボットはコード ${connectCode} を受信していません。@${bot.username} をグループに追加したこと（メンバー一覧で確認）を確かめてから ` +
            `/connect@${bot.username} ${connectCode} を送信し、もう一度お試しください。`,
        ) +
        (seen.length
          ? l(`Trong 24 giờ qua bot chỉ nhận được tin từ: `, `過去 24 時間にボットが受信したのは次のチャットだけです: `) +
            `${seen.slice(0, 5).join(', ')}.`
          : l(
              `Trong 24 giờ qua bot chưa nhận được tin nào — bot chưa ở trong nhóm, hoặc tin được gửi trước khi thêm bot.`,
              `過去 24 時間にボットは何も受信していません。ボットがグループにいないか、ボット追加前に送信された可能性があります。`,
            )),
    });
  return chat;
}

async function load(c: { get: (k: 'store') => AppEnv['Variables']['store'] }, id: string) {
  const ch = await c.get('store').getChannel(id);
  if (!ch) throw new HTTPException(404, { message: l('Không tìm thấy kênh', 'チャネルが見つかりません') });
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
    lang: body.lang ?? lang(),
    detail: body.detail,
    schedule: body.schedule,
    pausedUntil: body.pausedUntil ?? undefined,
    enabled: true,
    createdBy: c.get('user').id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  let target: Pick<Channel, 'kind' | 'webhookUrl' | 'telegramChatId' | 'telegramChatTitle'>;
  // track E: Slack channels (kind exists, delivery not implemented yet).
  if (body.kind === 'slack')
    throw new HTTPException(400, { message: l('Chưa hỗ trợ kênh Slack', 'Slack チャネルはまだ利用できません') });
  if (body.kind === 'telegram') {
    const chat = await findTelegramChat(c, connectCode!);
    target = { kind: 'telegram', telegramChatId: chat.id, telegramChatTitle: chat.title };
  } else {
    checkUrl(body.webhookUrl!);
    target = { kind: 'teams', webhookUrl: body.webhookUrl };
  }

  const channel: Channel = { id: `C${String(await store.nextSeq('channel')).padStart(3, '0')}`, ...base, ...target };
  // Verify delivery with a test message before saving.
  try {
    await notify.send(
      channel,
      withLang(channel.lang, () => testMessage(channel, notify.webUrl)),
    );
  } catch (e) {
    throw new HTTPException(400, { message: l('Không gửi được tin thử: ', 'テストメッセージを送信できません: ') + (e as Error).message });
  }
  channel.lastSentAt = now.toISOString();
  await store.putChannel(channel);
  return c.json({ channel: publicChannel(channel) }, 201);
});

channels.patch('/:id', async (c) => {
  const ch = await load(c, c.req.param('id'));
  ensure(
    canEdit(c.get('user'), ch),
    l('Chỉ người tạo kênh hoặc PMO / quản lý mới được sửa', 'チャネルの作成者または PMO / 管理者のみ編集できます'),
  );
  const { connectCode, ...body } = await parseBody(c.req, patchChannelSchema);
  let target: Partial<Channel> = {};
  if (connectCode) {
    // Move a Telegram channel to another group / chat: same connect-code flow as creating it.
    if (ch.kind !== 'telegram')
      throw new HTTPException(400, {
        message: l('Chỉ kênh Telegram mới đổi nhóm được', 'グループを変更できるのは Telegram チャネルのみです'),
      });
    const chat = await findTelegramChat(c, connectCode);
    target = { telegramChatId: chat.id, telegramChatTitle: chat.title };
  }
  if (body.webhookUrl) {
    if (ch.kind !== 'teams')
      throw new HTTPException(400, { message: l('Kênh Telegram không có URL webhook', 'Telegram チャネルには Webhook URL がありません') });
    checkUrl(body.webhookUrl);
  }
  const updated: Channel = {
    ...ch,
    ...body,
    ...target,
    pausedUntil: body.pausedUntil === undefined ? ch.pausedUntil : (body.pausedUntil ?? undefined),
    updatedAt: c.get('now').toISOString(),
  };
  if (connectCode) {
    const notify = c.get('notify');
    try {
      await notify.send(
        updated,
        withLang(updated.lang, () => testMessage(updated, notify.webUrl)),
      );
    } catch (e) {
      throw new HTTPException(400, { message: l('Không gửi được tin thử: ', 'テストメッセージを送信できません: ') + (e as Error).message });
    }
    updated.lastSentAt = c.get('now').toISOString();
    updated.lastError = undefined;
  }
  await c.get('store').putChannel(updated);
  return c.json({ channel: publicChannel(updated) });
});

channels.delete('/:id', async (c) => {
  const ch = await load(c, c.req.param('id'));
  ensure(
    canEdit(c.get('user'), ch),
    l('Chỉ người tạo kênh hoặc PMO / quản lý mới được xoá', 'チャネルの作成者または PMO / 管理者のみ削除できます'),
  );
  await c.get('store').deleteChannel(ch.id);
  return c.json({ ok: true });
});

channels.post('/:id/test', async (c) => {
  const ch = await load(c, c.req.param('id'));
  ensure(
    canEdit(c.get('user'), ch),
    l('Chỉ người tạo kênh hoặc PMO / quản lý mới được gửi thử', 'チャネルの作成者または PMO / 管理者のみテスト送信できます'),
  );
  const notify = c.get('notify');
  const parsed = testSampleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: l('Mẫu tin không hợp lệ', 'サンプルの種類が正しくありません') });
  const msg = await sampleMessage(notify, ch, parsed.data.sample, c.get('now'));
  const ok = await deliver(notify, ch, msg, c.get('now'));
  const saved = (await c.get('store').getChannel(ch.id))!;
  if (!ok) throw new HTTPException(502, { message: l('Gửi thử thất bại: ', 'テスト送信に失敗しました: ') + saved.lastError });
  return c.json({ channel: publicChannel(saved) });
});
