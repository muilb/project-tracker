import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { collectAlerts } from '../src/notify/events.js';
import type { Message } from '../src/notify/message.js';
import { becameRedMessage, compact, digestMessage, highIssueMessage, hourlyMessage, testMessage } from '../src/notify/render.js';
import { createSender } from '../src/notify/sender.js';
import { isSlackWebhookUrl, maskSlackUrl, MAX_BLOCKS, MAX_TEXT, slackPayload } from '../src/notify/slack.js';
import { activeProjectViews } from '../src/views.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel, Item, Update } from '../src/types.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
// Placeholder, not a real webhook; assembled at runtime so secret scanners do not flag the literal.
const SLACK_URL = ['https://hooks.slack.com/services', 'TFAKE0000', 'BFAKE0000', `SECRET${'x'.repeat(18)}`].join('/');

let store: MemoryStore;
let sent: { channel: Channel; msg: Message }[];
const send = async (ch: Channel, msg: Message) => void sent.push({ channel: ch, msg });
const deps = () => ({ store, send, webUrl: 'https://web.example' });

const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send, webUrl: 'https://web.example' }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const slackChannel = (over: Partial<Channel> = {}): Channel => ({
  id: 'C1',
  name: 'Slack',
  kind: 'slack',
  webhookUrl: SLACK_URL,
  scope: { type: 'all' },
  events: ['became_red'],
  quietHours: true,
  enabled: true,
  createdBy: 'lan@example.com',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  ...over,
});

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('slack: Block Kit', () => {
  it('escapes & < >, converts **bold**, and keeps a plain fallback text', () => {
    const p = slackPayload({
      title: 'A & B <x>',
      lines: [{ text: '**Cần chú ý** <!channel> & <https://evil|click>' }, { text: 'nhỏ', subtle: true }],
      link: { title: 'Mở', url: 'https://web.example/p' },
    });
    expect(p.blocks[0]).toEqual({ type: 'header', text: { type: 'plain_text', text: 'A & B <x>', emoji: true } });
    expect(p.blocks[1]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Cần chú ý* &lt;!channel&gt; &amp; &lt;https://evil|click&gt;' },
    });
    expect(p.blocks[2]).toEqual({ type: 'context', elements: [{ type: 'mrkdwn', text: 'nhỏ' }] });
    expect(p.blocks[3]).toMatchObject({ type: 'actions', elements: [{ type: 'button', url: 'https://web.example/p' }] });
    expect(p.text).toBe('A &amp; B &lt;x&gt;\nCần chú ý &lt;!channel&gt; &amp; &lt;https://evil|click&gt;\nnhỏ');
    expect(JSON.stringify(p)).not.toContain('<!channel>');
  });

  it('cuts long text to 3000 characters and stays within 50 blocks', () => {
    const long = slackPayload({ title: 'T'.repeat(400), lines: [{ text: 'x'.repeat(5000) }] });
    const section = long.blocks[1] as { text: { text: string } };
    expect(section.text.text.length).toBe(MAX_TEXT);
    expect(section.text.text.endsWith('…')).toBe(true);
    expect((long.blocks[0] as { text: { text: string } }).text.text.length).toBeLessThanOrEqual(150);
    expect(long.text.length).toBeLessThanOrEqual(MAX_TEXT);

    // Alternating kinds cannot be merged: one block each, capped.
    const many = slackPayload({
      title: 'T',
      lines: Array.from({ length: 120 }, (_, i) => ({ text: `l${i}`, subtle: i % 2 === 1 })),
      link: { title: 'Mở', url: 'https://web.example' },
    });
    expect(many.blocks).toHaveLength(MAX_BLOCKS);
    expect(many.blocks.at(-1)).toMatchObject({ type: 'actions' });
    expect(many.blocks.at(-2)).toEqual({ type: 'context', elements: [{ type: 'mrkdwn', text: '…' }] });

    // Lines of the same kind share a block.
    const merged = slackPayload({ title: 'T', lines: [{ text: 'a' }, { text: 'b' }] });
    expect(merged.blocks[1]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: 'a\nb' } });
  });
});

describe('slack: URL check and masking', () => {
  it('accepts only https://hooks.slack.com/services/…', () => {
    expect(isSlackWebhookUrl(SLACK_URL)).toBe(true);
    for (const bad of [
      'http://hooks.slack.com/services/T/B/X',
      'https://hooks.slack.com.evil.com/services/T/B/X',
      'https://evil.com/hooks.slack.com/services/T/B/X',
      'https://hooks.slack.com/workflows/T/B/X',
      'https://hooks.slack.com/services/T/B',
      'https://hooks.slack.com:8443/services/T/B/X',
      'https://user@hooks.slack.com/services/T/B/X',
      'not a url',
    ])
      expect(isSlackWebhookUrl(bad), bad).toBe(false);
  });

  it('never shows the channel or secret part', () => {
    expect(maskSlackUrl(SLACK_URL)).toBe('https://hooks.slack.com/services/TFAKE0000/…');
    expect(maskSlackUrl('https://hooks.slack.com/services/T/B/X')).not.toContain('X');
  });
});

describe('slack channels: API', () => {
  const create = (webhookUrl: string) =>
    call('POST', '/channels', 'lan', { kind: 'slack', name: 'S', webhookUrl, scope: { type: 'all' }, events: ['became_red'] });

  it('creates a Slack channel after a test message and returns only the masked URL', async () => {
    const res = await create(SLACK_URL);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('BFAKE0000');
    expect(JSON.parse(text).channel).toMatchObject({ kind: 'slack', webhookUrlMasked: 'https://hooks.slack.com/services/TFAKE0000/…' });
    expect(sent).toHaveLength(1);
    expect((await store.listChannels())[0].webhookUrl).toBe(SLACK_URL);

    const list = await call('GET', '/channels', 'lan');
    expect(await list.text()).not.toContain('SECRET');
  });

  it('rejects other URLs and a missing URL', async () => {
    expect((await create('https://prod-01.southeastasia.logic.azure.com/workflows/a')).status).toBe(400);
    const missing = await call('POST', '/channels', 'lan', { kind: 'slack', name: 'S', scope: { type: 'all' }, events: ['became_red'] });
    expect(missing.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('verifies a changed URL with a test message', async () => {
    await store.putChannel(slackChannel());
    const other = SLACK_URL.replace('SECRET', 'OTHER');
    expect((await call('PATCH', '/channels/C1', 'lan', { webhookUrl: 'https://example.com/x' })).status).toBe(400);
    const res = await call('PATCH', '/channels/C1', 'lan', { webhookUrl: other });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect((await store.getChannel('C1'))?.webhookUrl).toBe(other);
  });
});

describe('compact messages', () => {
  const SECRET = 'NỘI-DUNG-RIÊNG';
  const name = (id?: string) => (id ? `Người ${id.split('@')[0]}` : '—');

  /** Every message builder, fed with user-entered text that must not survive compact(). */
  async function allMessages(): Promise<Message[]> {
    const snap = await store.snapshot();
    const views = activeProjectViews(snap, now);
    const v = views[0];
    for (const x of views) {
      if (x.latestUpdate) x.latestUpdate = { ...x.latestUpdate, summary: SECRET };
      x.openItems = x.openItems.map((i) => ({ ...i, title: SECRET }));
    }
    const update = { id: 'U1', projectId: v.id, author: 'an@example.com', health: 'red', summary: SECRET, needHelp: SECRET } as Update;
    const project = snap.projects.find((p) => p.id === v.id)!;
    const item = { id: 'I1', projectId: v.id, type: 'issue', title: SECRET, note: SECRET, date: '2026-10-20', owner: 'an@example.com' } as Item;
    const ch = slackChannel({ events: ['overdue', 'late_update', 'milestone_soon'] });
    const pending = collectAlerts(ch, views, now, name);
    expect(pending.length).toBeGreaterThan(0);
    return [
      becameRedMessage(deps(), v, update, name),
      highIssueMessage(deps(), project, item, name),
      hourlyMessage(deps(), pending),
      digestMessage(deps(), ch, views, now, name),
    ];
  }

  it('drops user-entered text and names, keeps codes, counts and links', async () => {
    for (const full of await allMessages()) {
      expect(JSON.stringify(full)).toContain(SECRET);
      const c = compact(full);
      const out = JSON.stringify(c);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain('Người ');
      expect(c.title).toBe(full.title);
      expect(c.link).toEqual(full.link);
      for (const line of c.lines) expect(line).not.toHaveProperty('compact');
    }
    const [red, issue, hourly, digest] = (await allMessages()).map(compact);
    expect(red.lines.map((x) => x.text)).toEqual(['🙋 Cần hỗ trợ']);
    expect(issue.lines.map((x) => x.text)).toEqual(['Hạn xử lý 20/10']);
    expect(hourly.lines.length).toBeGreaterThan(0);
    expect(hourly.lines.every((x) => /P\d\d/.test(x.text) || x.text.startsWith('…'))).toBe(true);
    expect(digest.lines[0].text).toMatch(/^Đang chạy \d+/);
  });

  it('keeps the connection message', () => {
    expect(compact(testMessage({ name: 'K' })).lines).toHaveLength(1);
  });

  it('the sender applies the channel setting and the PMO maximum, never to personal chats', async () => {
    const bodies: { blocks: { text?: { text: string } }[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body));
        return new Response('ok');
      }),
    );
    const sender = createSender(store);
    const msg: Message = { title: 'T', lines: [{ text: SECRET }, { text: 'giữ', compact: true }] };
    const texts = () => JSON.stringify(bodies.pop());

    await sender(slackChannel(), msg);
    expect(texts()).toContain(SECRET);
    await sender(slackChannel({ detail: 'compact' }), msg);
    expect(texts()).not.toContain(SECRET);

    await store.putSettings({ ...(await store.getSettings()), maxChannelDetail: 'compact' });
    await sender(slackChannel({ detail: 'full' }), msg);
    const forced = texts();
    expect(forced).not.toContain(SECRET);
    expect(forced).toContain('giữ');

    const telegram = { sendMessage: vi.fn(async () => {}), findChatByText: vi.fn() };
    await store.putTelegramBot({ token: 'x', username: 'bot' } as never);
    const personal = createSender(store, telegram as never);
    await personal({ id: 'U:an@example.com', kind: 'telegram', telegramChatId: '1' } as Channel, msg);
    expect(JSON.stringify(telegram.sendMessage.mock.calls[0])).toContain(SECRET);
  });
});
