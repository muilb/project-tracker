import { beforeEach, describe, expect, it } from 'vitest';
import {
  AiError,
  blankAction,
  fromWire,
  OUTPUT_JSON_SCHEMA,
  wireOutputSchema,
  type AiClient,
  type AiOutput,
  type AiRawAction,
} from '../src/ai/assistant.js';
import { buildAskContext, type AskMessage } from '../src/ai/ask.js';
import { buildContext } from '../src/ai/proposals.js';
import { createApp } from '../src/app.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const KEY = 'sk-ant-api03-test-key-0123456789abcdef';

let store: MemoryStore;
let output: AiOutput;
let calls: { key: string; context: string; text: string }[];
let asked: { key: string; context: string; messages: AskMessage[] }[];
const ai: AiClient = {
  async verifyKey(key) {
    if (key !== KEY) throw new AiError('API key Claude không hợp lệ', 400);
  },
  async extract(key, context, text) {
    calls.push({ key, context, text });
    return output;
  },
  async ask(key, context, messages) {
    asked.push({ key, context, messages });
    return { answer: 'P03 đang Đỏ.', truncated: false };
  },
};

const app = () => createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: async () => {}, ai });
const call = (method: string, path: string, as: string, body?: unknown) =>
  app().request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const action = (a: Partial<AiRawAction>): AiRawAction => blankAction({ kind: 'update', projectId: 'P01', ...a });

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  calls = [];
  asked = [];
  output = { actions: [], questions: [] };
});

describe('AI key setting', () => {
  it('only the system admin sets it; it is verified and never returned', async () => {
    expect((await call('PUT', '/settings/ai', 'an', { apiKey: KEY })).status).toBe(403);
    expect((await call('PUT', '/settings/ai', 'lan', { apiKey: KEY })).status).toBe(403); // PMO
    expect((await call('PUT', '/settings/ai', 'admin', { apiKey: 'not-a-claude-key-xxxxxxxxxx' })).status).toBe(400);
    expect((await call('PUT', '/settings/ai', 'admin', { apiKey: 'sk-ant-wrong-key-0123456789' })).status).toBe(400);
    expect((await call('PUT', '/settings/ai', 'admin', { apiKey: KEY })).status).toBe(200);
    const text = await (await call('GET', '/settings/ai', 'an')).text();
    expect(JSON.parse(text)).toEqual({ configured: true, model: 'claude-haiku-5-5' });
    expect(text).not.toContain(KEY);
    expect((await call('DELETE', '/settings/ai', 'lan')).status).toBe(403);
    await call('DELETE', '/settings/ai', 'admin');
    expect(await store.getAiConfig()).toBeUndefined();
  });
});

describe('POST /ai/parse', () => {
  it('needs the key first', async () => {
    const res = await call('POST', '/ai/parse', 'an', { text: 'P01 ổn' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('chưa cài API key');
  });

  it('turns the model output into validated proposals without saving anything', async () => {
    await store.putAiConfig({ apiKey: KEY });
    const items = await store.listItems('P01');
    const before = (await store.listUpdates('P01')).length;
    output = {
      actions: [
        action({ kind: 'update', projectId: 'p01', health: 'yellow', summary: '  Khách đổi yêu cầu  ', needHelp: '' }),
        action({ kind: 'item', itemType: 'event', title: 'Demo', priority: 'high', date: '2026-10-16', owner: 'ghost@example.com' }),
        action({ kind: 'item', title: 'Thiếu ngày', date: 'thứ 6' }),
        action({ kind: 'item_status', itemId: items[0].id, status: 'done' }),
        action({ kind: 'update', projectId: 'P99', summary: 'x' }),
      ],
      questions: ['Dự án "kho" là P01 hay P03?', ' '],
    };
    const res = await call('POST', '/ai/parse', 'an', { text: 'P01 vàng…' });
    expect(res.status).toBe(200);
    const { proposals, questions } = await res.json();
    expect(proposals[0]).toEqual({
      kind: 'update',
      projectId: 'P01',
      projectName: expect.any(String),
      body: { health: 'yellow', summary: 'Khách đổi yêu cầu' },
    });
    expect(proposals[1].body).toEqual({ type: 'event', title: 'Demo', priority: 'high', date: '2026-10-16' });
    expect(proposals[1].error).toBeUndefined();
    expect(proposals[2].error).toContain('YYYY-MM-DD');
    expect(proposals[3]).toMatchObject({ itemId: items[0].id, itemTitle: items[0].title, body: { status: 'done' } });
    expect(proposals[4].error).toContain('Không tìm thấy dự án P99');
    expect(questions).toEqual(['Dự án "kho" là P01 hay P03?']);
    expect((await store.listUpdates('P01')).length).toBe(before);
    expect(calls[0].key).toBe(KEY);
    expect(calls[0].context).toContain('Hôm nay: 2026-10-09 (Thứ 6)');
  });

  it('OTHER cannot use it; AI errors are reported', async () => {
    await store.putAiConfig({ apiKey: KEY });
    await store.putUser({ id: 'sp@example.com', name: 'Sp', role: 'OTHER', createdAt: now.toISOString() });
    expect((await call('POST', '/ai/parse', 'sp', { text: 'x' })).status).toBe(403);
    const extract = ai.extract;
    ai.extract = async () => {
      throw new AiError('AI đang quá tải', 503);
    };
    const res = await call('POST', '/ai/parse', 'an', { text: 'x' });
    ai.extract = extract;
    expect(res.status).toBe(503);
  });
});

describe('context', () => {
  it('lists open projects, open items and people', async () => {
    const snap = await store.snapshot();
    const ctx = buildContext(snap, now, snap.users[0]);
    expect(ctx).toContain('P01 |');
    expect(ctx).toContain('2026-10-12 Thứ 2');
    const done = snap.items.find((i) => i.status === 'done');
    if (done) expect(ctx).not.toContain(done.id + ' [');
  });
});

describe('notes without a project', () => {
  beforeEach(() => store.putAiConfig({ apiKey: KEY }));

  it('keeps the action and asks the user to pick the project', async () => {
    output = { actions: [action({ kind: 'update', projectId: '', summary: 'Khách đổi yêu cầu' })], questions: [] };
    const { proposals } = await (await call('POST', '/ai/parse', 'an', { text: 'khách đổi yêu cầu' })).json();
    expect(proposals[0]).toMatchObject({ projectId: '', needsProject: true, body: { summary: 'Khách đổi yêu cầu' } });
    expect(proposals[0].error).toBeUndefined();
  });

  it('uses the default project chosen on the page', async () => {
    output = { actions: [action({ kind: 'item', projectId: '', itemType: 'event', title: 'Demo', date: '2026-10-16' })], questions: [] };
    const res = await call('POST', '/ai/parse', 'an', { text: 'thứ 6 demo', projectId: 'p03' });
    const { proposals } = await res.json();
    expect(proposals[0]).toMatchObject({ projectId: 'P03', projectName: expect.any(String) });
    expect(proposals[0].needsProject).toBeUndefined();
    expect(calls[0].context).toContain('Dự án mặc định (khi ghi chú không nêu dự án): P03');
  });

  it('finds the project of a status change from the item id', async () => {
    const item = (await store.listItems('P01'))[0];
    output = { actions: [action({ kind: 'item_status', projectId: '', itemId: item.id, status: 'done' })], questions: [] };
    const { proposals } = await (await call('POST', '/ai/parse', 'an', { text: 'xong rồi' })).json();
    expect(proposals[0]).toMatchObject({ projectId: 'P01', itemTitle: item.title });
    expect(proposals[0].error).toBeUndefined();
  });

  it("marks the writer's own projects in the context", async () => {
    const snap = await store.snapshot();
    const me = snap.users.find((u) => u.id === 'an@example.com')!;
    const own = snap.projects.find((p) => p.pl === me.id || p.gl === me.id)!;
    expect(buildContext(snap, now, me)).toContain(`★ ${own.id} |`);
  });
});

describe('projects and item edits', () => {
  beforeEach(() => store.putAiConfig({ apiKey: KEY }));
  const parse = async (as = 'an', text = 'x') => (await call('POST', '/ai/parse', as, { text })).json();

  it('creates a new project and links its milestone, created first', async () => {
    output = {
      actions: [
        action({ kind: 'item', projectId: 'NEW1', itemType: 'milestone', title: 'Release', date: '2026-12-15' }),
        action({
          kind: 'project_create',
          projectId: 'NEW1',
          name: 'Web bán hàng',
          customer: 'KH ABC',
          pl: 'an@example.com',
          gl: 'ghost@example.com',
          startDate: '2026-11-01',
          endDate: '2026-12-31',
        }),
      ],
      questions: [],
    };
    const { proposals } = await parse();
    expect(proposals[0]).toMatchObject({
      kind: 'project_create',
      projectId: 'NEW1',
      newProject: true,
      body: { name: 'Web bán hàng', customer: 'KH ABC', pl: 'an@example.com', startDate: '2026-11-01', endDate: '2026-12-31' },
    });
    expect(proposals[0].body.gl).toBeUndefined();
    expect(proposals[0].warnings[0]).toContain('ghost@example.com');
    expect(proposals[1]).toMatchObject({ kind: 'item', projectId: 'NEW1', newProject: true, projectName: 'Web bán hàng' });
    expect(proposals[1].error).toBeUndefined();
  });

  it('a project without a name cannot be created', async () => {
    output = { actions: [action({ kind: 'project_create', projectId: '' })], questions: [] };
    const { proposals } = await parse();
    expect(proposals[0].projectId).toBe('NEW1');
    expect(proposals[0].error).toContain('Tên dự án');
  });

  it('edits project info with before values, only for allowed people', async () => {
    output = {
      actions: [action({ kind: 'project_update', projectId: 'P03', pl: 'long@example.com', endDate: '2026-12-20', state: 'paused' })],
      questions: [],
    };
    let { proposals } = await parse('cuong');
    expect(proposals[0]).toMatchObject({
      kind: 'project_update',
      body: { pl: 'long@example.com', endDate: '2026-12-20', state: 'paused' },
      before: { pl: 'cuong@example.com', endDate: '2026-11-15', state: 'active' },
    });
    expect(proposals[0].error).toBeUndefined();
    ({ proposals } = await parse('an'));
    expect(proposals[0].error).toContain('không có quyền');
  });

  it('a project edit with no real change is flagged', async () => {
    output = { actions: [action({ kind: 'project_update', projectId: 'P03' })], questions: [] };
    expect((await parse('cuong')).proposals[0].error).toContain('Không có thay đổi');
    output = {
      actions: [action({ kind: 'project_update', projectId: 'P03', pl: 'cuong@example.com', endDate: '2026-12-01' })],
      questions: [],
    };
    expect((await parse('cuong')).proposals[0].body).toEqual({ endDate: '2026-12-01' });
  });

  it('edits an item: only the changed fields, with before values', async () => {
    const item = (await store.listItems('P01'))[0];
    const priority = item.priority === 'high' ? 'low' : 'high';
    const owner = item.owner === 'hung@example.com' ? 'son@example.com' : 'hung@example.com';
    output = {
      actions: [action({ kind: 'item_update', projectId: '', itemId: item.id, date: '2099-01-20', priority, owner, title: item.title })],
      questions: [],
    };
    const { proposals } = await parse();
    expect(proposals[0]).toMatchObject({
      kind: 'item_update',
      projectId: 'P01',
      itemId: item.id,
      body: { date: '2099-01-20', priority, owner },
      before: { date: item.date, priority: item.priority, owner: item.owner },
    });
    expect(Object.keys(proposals[0].body)).toEqual(['date', 'priority', 'owner']);
    expect(proposals[0].error).toBeUndefined();
  });

  it('flags a bad date on an item edit', async () => {
    const item = (await store.listItems('P01'))[0];
    output = { actions: [action({ kind: 'item_update', itemId: item.id, date: 'thứ 3' })], questions: [] };
    expect((await parse()).proposals[0].error).toContain('YYYY-MM-DD');
  });
});

describe('structured output schema', () => {
  // The API rejects schemas with more than 16 nullable / union fields, and numeric or length constraints.
  it('has no union types or unsupported constraints', () => {
    const bad: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if ('anyOf' in n || 'oneOf' in n || Array.isArray(n.type)) bad.push(`${path}: union`);
      for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems'])
        if (k in n) bad.push(`${path}: ${k}`);
      for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
    };
    walk(OUTPUT_JSON_SCHEMA, '$');
    expect(bad).toEqual([]);
  });

  it('maps empty wire values to null', () => {
    const wire = {
      questions: [],
      actions: [
        {
          ...Object.fromEntries(Object.keys(wireOutputSchema.shape.actions.element.shape).map((k) => [k, ''])),
          kind: 'item',
          projectId: 'P01',
          itemType: 'issue',
          title: 'Lỗi',
          supporters: [],
          frequencyHours: 0,
        },
      ],
    } as unknown as Parameters<typeof fromWire>[0];
    const [a] = fromWire(wire).actions;
    expect(a).toMatchObject({
      kind: 'item',
      projectId: 'P01',
      itemType: 'issue',
      title: 'Lỗi',
      health: null,
      supporters: null,
      frequencyHours: null,
    });
  });
});

describe('AI questions (read-only)', () => {
  const ask = (as: string, messages: AskMessage[], language?: string) =>
    app().request('/ai/ask', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dev-user': `${as}@example.com`,
        ...(language ? { 'accept-language': language } : {}),
      },
      body: JSON.stringify({ messages }),
    });

  it('needs the AI key', async () => {
    const res = await ask('an', [{ role: 'user', content: 'Dự án nào đang đỏ?' }]);
    expect(res.status).toBe(400);
    expect(asked).toHaveLength(0);
  });

  it('answers with the data as context, for any signed-in user', async () => {
    await store.putAiConfig({ apiKey: KEY });
    const before = JSON.stringify(await store.snapshot());
    const res = await ask('newcomer', [{ role: 'user', content: 'Dự án nào đang đỏ?' }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: 'P03 đang Đỏ.', truncated: false });
    const { key, context, messages } = asked[0];
    expect(key).toBe(KEY);
    expect(messages).toEqual([{ role: 'user', content: 'Dự án nào đang đỏ?' }]);
    expect(context).toContain('### P03 · Nâng cấp ERP');
    expect(context).toContain('Trạng thái: Đỏ');
    expect(context).toContain('UAT chưa bắt đầu'); // latest update summary
    expect(context).toContain('Cần thêm 1 dev Java'); // needHelp
    expect(context).toMatch(/TRỄ cập nhật|cập nhật đúng hạn/);
    expect(context).toContain('Ngôn ngữ giao diện của người hỏi: tiếng Việt');
    // Read-only: only the new user's own record appears.
    const after = await store.snapshot();
    expect(JSON.stringify({ ...after, users: [] })).toBe(JSON.stringify({ ...JSON.parse(before), users: [] }));
  });

  it('keeps follow-up questions and tells the model the UI language', async () => {
    await store.putAiConfig({ apiKey: KEY });
    const messages: AskMessage[] = [
      { role: 'user', content: 'P03 thế nào?' },
      { role: 'assistant', content: 'P03 đang Đỏ.' },
      { role: 'user', content: 'Còn P05?' },
    ];
    expect((await ask('an', messages, 'ja')).status).toBe(200);
    expect(asked[0].messages).toEqual(messages);
    expect(asked[0].context).toContain('tiếng Nhật');
  });

  it('rejects a conversation that does not end with a question', async () => {
    await store.putAiConfig({ apiKey: KEY });
    const res = await ask('an', [
      { role: 'user', content: 'P03?' },
      { role: 'assistant', content: 'Đỏ.' },
    ]);
    expect(res.status).toBe(400);
  });

  it('leaves out old updates and keeps closed projects to one line', async () => {
    const snap = await store.snapshot();
    const old = { ...snap.updates[0], id: 'old', at: new Date(now.getTime() - 90 * 86_400_000).toISOString(), summary: 'Cập nhật rất cũ' };
    const closed = { ...snap.projects[0], id: 'P99', name: 'Dự án đã đóng', state: 'closed' as const };
    const context = buildAskContext({ ...snap, updates: [...snap.updates, old], projects: [...snap.projects, closed] }, now, snap.users[0]);
    expect(context).not.toContain('Cập nhật rất cũ');
    const block = context.split('\n### ').find((b) => b.startsWith('P99'))!;
    expect(block.trim().split('\n')).toHaveLength(1);
  });
});
