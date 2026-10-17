// Track F: OTHER only sees the projects they take part in (PL / GL / PMO / supporter) or own an item of.
import { beforeEach, describe, expect, it } from 'vitest';
import { blankAction, type AiClient, type AiOutput } from '../src/ai/assistant.js';
import { buildAskContext } from '../src/ai/ask.js';
import { buildContext, toProposals } from '../src/ai/proposals.js';
import { createApp } from '../src/app.js';
import { can } from '../src/auth.js';
import type { Message } from '../src/notify/message.js';
import { emit, flushDue, runHourly } from '../src/notify/pipeline.js';
import { buildProjectView } from '../src/rules.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import type { Channel, Item, User } from '../src/types.js';
import { buildPublic, visibleProjects } from '../src/views.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
const KEY = 'sk-ant-api03-test-key-0123456789abcdef';
const URL_A = 'https://prod-01.southeastasia.logic.azure.com:443/workflows/a/triggers/manual/paths/invoke?sig=SECRET_A';

// In the sample, phuc (OTHER) supports P01 and P04; quang (OTHER) supports P03 and P06.
const PHUC = ['P01', 'P04'];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

let store: MemoryStore;
let sent: { channel: string; msg: Message }[];
let asked: string[];
const send = async (ch: Channel, msg: Message) => void sent.push({ channel: ch.id, msg });
const ai: AiClient = {
  async verifyKey() {},
  async extract() {
    return { actions: [], questions: [] };
  },
  async ask(_key, context) {
    asked.push(context);
    return { answer: 'ok', truncated: false };
  },
};
const deps = () => ({ store, send, webUrl: 'https://web.example' });

const call = (method: string, path: string, as: string, body?: unknown) =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send, ai, webUrl: 'https://web.example' }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = async (path: string, as: string) => (await call('GET', path, as)).json();
const user = async (id: string) => (await store.getUser(`${id}@example.com`)) as User;

/** quang owns a closed item of P05, where he has no role. */
async function giveItem(): Promise<Item> {
  const item: Item = {
    id: 'I9001',
    projectId: 'P05',
    type: 'issue',
    title: 'Việc của Quang',
    priority: 'low',
    date: '2026-10-01',
    owner: 'quang@example.com',
    status: 'done',
    createdBy: 'lan@example.com',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.putItem(item);
  return item;
}

async function addChannel(over: Partial<Channel> = {}) {
  const ch: Channel = {
    id: 'C1',
    name: 'Kênh của Phúc',
    kind: 'teams',
    webhookUrl: URL_A,
    scope: { type: 'all' },
    events: ['became_red', 'high_issue', 'late_update', 'overdue', 'milestone_soon'],
    quietHours: false,
    enabled: true,
    createdBy: 'phuc@example.com',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...over,
  };
  await store.putChannel(ch);
  return ch;
}

const text = (m: Message) => [m.title, ...m.lines.map((x) => x.text)].join('\n');

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
  sent = [];
  asked = [];
});

describe('can.viewProject / visibleProjects', () => {
  it('OTHER sees projects they take part in or own an item of; other roles see all', async () => {
    const snap = await store.snapshot();
    expect(ids(visibleProjects(await user('phuc'), snap))).toEqual(PHUC);
    expect(visibleProjects(await user('an'), snap)).toHaveLength(snap.projects.length);
    expect(visibleProjects(await user('mng'), snap)).toHaveLength(snap.projects.length);

    const item = await giveItem();
    const quang = await user('quang');
    const p05 = (await store.getProject('P05'))!;
    expect(can.viewProject(quang, p05)).toBe(false);
    expect(can.viewProject(quang, p05, [item])).toBe(true);
    expect(can.viewProject(quang, p05, [{ ...item, deletedAt: now.toISOString() }])).toBe(false);
    expect(can.viewProject(quang, p05, [{ ...item, projectId: 'P02' }])).toBe(false);
    // A project view uses its open items when none are given.
    const view = buildProjectView(p05, [], [{ ...item, status: 'open' }], snap.settings, now);
    expect(can.viewProject(quang, view)).toBe(true);
    expect(ids(visibleProjects(quang, await store.snapshot()))).toEqual(['P03', 'P05', 'P06']);
  });
});

describe('read paths', () => {
  it('GET /projects lists only visible projects for OTHER, whatever the scope', async () => {
    expect(ids((await get('/projects', 'phuc')).projects)).toEqual(PHUC);
    expect(ids((await get('/projects?state=all', 'phuc')).projects)).toEqual(PHUC);
    expect(ids((await get('/projects?scope=mine', 'phuc')).projects)).toEqual(PHUC);
    expect((await get('/projects', 'an')).projects.length).toBe(7);
    await giveItem();
    expect(ids((await get('/projects', 'quang')).projects)).toEqual(['P03', 'P05', 'P06']);
  });

  it('a project OTHER cannot see answers 404 on every path', async () => {
    for (const path of ['/projects/P02', '/projects/P02/updates', '/projects/P02/items']) {
      expect((await call('GET', path, 'phuc')).status).toBe(404);
      expect((await call('GET', path, 'an')).status).toBe(200);
    }
    expect((await call('GET', '/projects/P01', 'phuc')).status).toBe(200);
    expect((await call('GET', '/projects/p04/updates', 'phuc')).status).toBe(200);
    expect((await call('GET', '/projects/P04/items', 'phuc')).status).toBe(200);
    // Writes too: an invisible project looks missing.
    expect((await call('POST', '/projects/P02/updates', 'phuc', { summary: 'x' })).status).toBe(404);
    const item = { type: 'issue', title: 'x', priority: 'low', date: '2026-10-20', owner: 'phuc@example.com' };
    expect((await call('POST', '/projects/P02/items', 'phuc', item)).status).toBe(404);
  });

  it('owning an item opens the project page, even once the item is closed', async () => {
    expect((await call('GET', '/projects/P05', 'quang')).status).toBe(404);
    await giveItem();
    expect((await call('GET', '/projects/P05', 'quang')).status).toBe(200);
    expect((await call('GET', '/projects/P05/items', 'quang')).status).toBe(200);
  });

  it('GET /dashboard (KPIs, lists, GL statistics) counts only visible projects', async () => {
    const mine = await get('/dashboard?scope=all', 'phuc');
    expect(mine.kpis.active).toBe(2);
    const listed = new Set<string>([
      ...mine.attention.map((p: { id: string }) => p.id),
      ...mine.lateUpdates.map((p: { id: string }) => p.id),
      ...mine.priorityItems.map((i: { projectId: string }) => i.projectId),
      ...mine.upcoming.map((i: { projectId: string }) => i.projectId),
    ]);
    for (const id of listed) expect(PHUC).toContain(id);
    // P01 is GL hung's, P04 GL son's: one project each.
    expect(mine.byGl.map((r: { gl: string; total: number }) => [r.gl, r.total])).toEqual([
      ['hung@example.com', 1],
      ['son@example.com', 1],
    ]);
    const byHung = await get('/dashboard?scope=all&gl=hung@example.com', 'phuc');
    expect(byHung.kpis.active).toBe(1);
    expect((await get('/dashboard?scope=all', 'lan')).kpis.active).toBe(7);
  });

  it('the users list stays visible and the public page is unchanged', async () => {
    expect((await get('/users', 'phuc')).users.length).toBe((await store.listUsers()).length);
    const pub = await (await call('GET', '/public', 'phuc')).json();
    expect(pub).toEqual(JSON.parse(JSON.stringify(buildPublic(await store.snapshot(), now))));
  });
});

describe('AI context', () => {
  it('ask only sends visible projects', async () => {
    const snap = await store.snapshot();
    const phuc = await user('phuc');
    const context = buildAskContext(snap, now, phuc);
    for (const p of snap.projects) expect(context.includes(p.name)).toBe(PHUC.includes(p.id));
    expect(context).toContain('Quang'); // users stay, for names
    expect(buildAskContext(snap, now, await user('an'))).toContain('Nâng cấp ERP');

    await store.putAiConfig({ apiKey: KEY });
    expect((await call('POST', '/ai/ask', 'phuc', { messages: [{ role: 'user', content: 'P03 sao rồi?' }] })).status).toBe(200);
    expect(asked[0]).not.toContain('Nâng cấp ERP');
    expect(asked[0]).toContain('Portal nội bộ');
  });

  it('proposals never target invisible projects or their items', async () => {
    const snap = await store.snapshot();
    const phuc = await user('phuc');
    const context = buildContext(snap, now, phuc);
    expect(context).toContain('Portal nội bộ');
    expect(context).not.toContain('Nâng cấp ERP');

    const p03Item = snap.items.find((i) => i.projectId === 'P03')!;
    const out: AiOutput = {
      actions: [
        blankAction({ kind: 'update', projectId: 'P03', summary: 'Ổn' }),
        blankAction({ kind: 'item_status', projectId: '', itemId: p03Item.id, status: 'done' }),
        blankAction({ kind: 'update', projectId: 'P04', summary: 'Ổn' }),
      ],
      questions: [],
    };
    const [p03, item, p04] = toProposals(out, snap, phuc).proposals;
    expect(p03.badProject).toBe(true);
    expect(p03.error).toBeTruthy();
    expect(item.error).toBeTruthy();
    expect(p04.error).toBeUndefined();
    // The same note from a PL is accepted.
    expect(toProposals(out, snap, await user('an')).proposals[0].error).toBeUndefined();
  });
});

describe('group channels follow the creator', () => {
  it('immediate alerts only for projects the creator sees', async () => {
    await addChannel();
    const project = (await store.getProject('P02'))!;
    const later = new Date(now.getTime() + 120_000);
    const high: Item = { ...(await giveItem()), id: 'I9002', projectId: 'P02', status: 'open', priority: 'high', owner: undefined };
    await emit(deps(), now, { type: 'item_saved', project, item: high, actor: 'lan@example.com' });
    await flushDue(deps(), later); // high-priority issues wait 2 minutes (track D)
    expect(sent).toHaveLength(0);
    await emit(deps(), now, { type: 'item_saved', project: (await store.getProject('P01'))!, item: { ...high, projectId: 'P01' }, actor: 'lan@example.com' });
    await flushDue(deps(), later); // high-priority issues wait 2 minutes (track D)
    expect(sent).toHaveLength(1);
    // Owning the new item is enough.
    sent = [];
    await emit(deps(), now, { type: 'item_saved', project, item: { ...high, owner: 'phuc@example.com' }, actor: 'lan@example.com' });
    await flushDue(deps(), later); // high-priority issues wait 2 minutes (track D)
    expect(sent).toHaveLength(1);
  });

  it('hourly alerts and the digest leave out invisible projects', async () => {
    await addChannel({ events: ['late_update', 'overdue', 'milestone_soon', 'daily_digest'] });
    await addChannel({ id: 'C2', createdBy: 'lan@example.com', events: ['late_update', 'overdue', 'milestone_soon'] });
    await runHourly(deps(), now);
    const mine = sent.filter((s) => s.channel === 'C1').map((s) => text(s.msg)).join('\n');
    const pmo = sent.filter((s) => s.channel === 'C2').map((s) => text(s.msg)).join('\n');
    expect(mine).toContain('P04');
    for (const id of ['P02', 'P03', 'P05', 'P06', 'P07']) expect(mine).not.toContain(id);
    expect(pmo).toContain('P03');
  });

  it('test samples use the same projects', async () => {
    const ch = await addChannel();
    for (const sample of ['became_red', 'high_issue', 'hourly', 'daily_digest']) {
      sent = [];
      expect((await call('POST', `/channels/${ch.id}/test`, 'phuc', { sample })).status).toBe(200);
      const body = text(sent[0].msg);
      for (const id of ['P02', 'P03', 'P05', 'P06', 'P07']) expect(body).not.toContain(id);
    }
    // P03 is the worst project; a PMO channel's sample picks it.
    const pmo = await addChannel({ id: 'C2', createdBy: 'lan@example.com' });
    sent = [];
    await call('POST', `/channels/${pmo.id}/test`, 'lan', { sample: 'became_red' });
    expect(text(sent[0].msg)).toContain('P03');
  });
});
