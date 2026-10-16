import { beforeEach, describe, expect, it } from 'vitest';
import type { AiClient, AiOutput, AiRawAction } from '../src/ai/assistant.js';
import { AiError } from '../src/ai/assistant.js';
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
const ai: AiClient = {
  async verifyKey(key) {
    if (key !== KEY) throw new AiError('API key Claude không hợp lệ', 400);
  },
  async extract(key, context, text) {
    calls.push({ key, context, text });
    return output;
  },
};

const app = () =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: async () => {}, ai });
const call = (method: string, path: string, as: string, body?: unknown) =>
  app().request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const action = (a: Partial<AiRawAction>): AiRawAction => ({
  kind: 'update',
  projectId: 'P01',
  health: null,
  summary: null,
  needHelp: null,
  itemType: null,
  title: null,
  priority: null,
  date: null,
  owner: null,
  itemId: null,
  status: null,
  note: null,
  ...a,
});

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  calls = [];
  output = { actions: [], questions: [] };
});

describe('AI key setting', () => {
  it('only admins set it; it is verified and never returned', async () => {
    expect((await call('PUT', '/settings/ai', 'an', { apiKey: KEY })).status).toBe(403);
    expect((await call('PUT', '/settings/ai', 'lan', { apiKey: 'not-a-claude-key-xxxxxxxxxx' })).status).toBe(400);
    expect((await call('PUT', '/settings/ai', 'lan', { apiKey: 'sk-ant-wrong-key-0123456789' })).status).toBe(400);
    expect((await call('PUT', '/settings/ai', 'lan', { apiKey: KEY })).status).toBe(200);
    const text = await (await call('GET', '/settings/ai', 'an')).text();
    expect(JSON.parse(text)).toEqual({ configured: true, model: 'claude-haiku-5-5' });
    expect(text).not.toContain(KEY);
    await call('DELETE', '/settings/ai', 'lan');
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
