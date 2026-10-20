import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { DynamoStore, itemKind, KIND_INDEX, monthsSince } from '../src/store/dynamo.js';
import { updateCursor } from '../src/store/store.js';
import type { Comment, Item, Update } from '../src/types.js';
import { activeProjectViews } from '../src/views.js';

type Row = Record<string, unknown>;

/**
 * A document client over rows in memory: the byKind index, table queries, scans, gets, conditional
 * puts, deletes and the item re-filing update, with DynamoDB's paging (Limit counts rows read before
 * the filter). Counts reads, and which kinds were queried.
 */
function fakeDb(initial: Row[], { indexMissing = false } = {}) {
  const rows = [...initial];
  const calls = { query: 0, tableQuery: 0, scan: 0, scannedRows: 0, pinsPut: 0, kinds: [] as string[] };
  const bySk = (a: Row, b: Row) => String(a.sk).localeCompare(String(b.sk));
  const find = (pk: unknown, sk: unknown) => rows.findIndex((r) => r.pk === pk && r.sk === sk);
  const page = (matched: Row[], input: QueryCommand['input']) => {
    let list = input.ScanIndexForward === false ? [...matched].reverse() : matched;
    if (input.ExclusiveStartKey) list = list.slice(list.findIndex((r) => r.sk === input.ExclusiveStartKey!.sk) + 1);
    const read = input.Limit ? list.slice(0, input.Limit) : list;
    const more = read.length < list.length;
    const f = input.FilterExpression;
    const items = read.filter((r) =>
      f === 'attribute_exists(deletedAt)' ? !!r.deletedAt : f === 'attribute_not_exists(deletedAt)' ? !r.deletedAt : true,
    );
    return { Items: structuredClone(items), LastEvaluatedKey: more ? { pk: read.at(-1)!.pk, sk: read.at(-1)!.sk } : undefined };
  };
  const send = async (cmd: unknown) => {
    if (cmd instanceof QueryCommand && cmd.input.IndexName === KIND_INDEX) {
      calls.query++;
      if (indexMissing) throw Object.assign(new Error('The table does not have the specified index: byKind'), { name: 'ValidationException' });
      const v = cmd.input.ExpressionAttributeValues!;
      calls.kinds.push(String(v[':k']));
      return page(rows.filter((r) => r.kind === v[':k'] && (!v[':from'] || String(r.sk) >= String(v[':from']))).sort(bySk), cmd.input);
    }
    if (cmd instanceof QueryCommand) {
      calls.tableQuery++;
      const v = cmd.input.ExpressionAttributeValues!;
      const key = cmd.input.KeyConditionExpression!;
      const inRange = (sk: string) =>
        key.includes('begins_with')
          ? sk.startsWith(String(v[':sk']))
          : key.includes('BETWEEN')
            ? sk >= String(v[':lo']) && sk <= String(v[':hi'])
            : true;
      return page(rows.filter((r) => r.pk === v[':pk'] && inRange(String(r.sk))).sort(bySk), cmd.input);
    }
    if (cmd instanceof ScanCommand) {
      calls.scan++;
      calls.scannedRows += rows.length;
      return { Items: rows };
    }
    if (cmd instanceof GetCommand) {
      const { pk, sk } = cmd.input.Key as { pk: string; sk: string };
      return { Item: structuredClone(rows[find(pk, sk)]) };
    }
    if (cmd instanceof PutCommand) {
      const item = cmd.input.Item as Row;
      const i = find(item.pk, item.sk);
      const cond = cmd.input.ConditionExpression;
      if (
        (cond === 'attribute_not_exists(pk)' && i >= 0) ||
        (cond === 'version = :v' && (i < 0 || rows[i].version !== cmd.input.ExpressionAttributeValues![':v']))
      )
        throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
      if (item.sk === 'PINS') calls.pinsPut++;
      if (i >= 0) rows[i] = item;
      else rows.push(item);
      return {};
    }
    if (cmd instanceof UpdateCommand && cmd.input.UpdateExpression === 'SET kind = :k') {
      const { pk, sk } = cmd.input.Key as { pk: string; sk: string };
      const v = cmd.input.ExpressionAttributeValues!;
      const r = rows[find(pk, sk)];
      if (!r || r.kind !== v[':old'] || r.updatedAt !== v[':u'])
        throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
      r.kind = v[':k'];
      return {};
    }
    if (cmd instanceof DeleteCommand) {
      const { pk, sk } = cmd.input.Key as { pk: string; sk: string };
      const i = find(pk, sk);
      if (i >= 0) rows.splice(i, 1);
      return {};
    }
    throw new Error(`unexpected command ${(cmd as object).constructor.name}`);
  };
  return { db: { send } as never, calls, rows };
}

const rows: Row[] = [
  { pk: 'USER#an@x', sk: 'USER', kind: 'USER', id: 'an@x', name: 'An', role: 'PL', createdAt: '2026-01-01T00:00:00Z' },
  { pk: 'PROJECT#P01', sk: 'PROJECT', kind: 'PROJECT', id: 'P01', name: 'Kho', state: 'active', supporters: [] },
  { pk: 'PROJECT#P01', sk: 'UPDATE#2026-10-01T00:00:00Z#u1', kind: 'UPDATE', id: 'u1', projectId: 'P01', summary: 'ok' },
  { pk: 'PROJECT#P01', sk: 'ITEM#I0001', kind: 'ITEM', id: 'I0001', projectId: 'P01', title: 'Mốc' },
  { pk: 'CHANNEL#C001', sk: 'CHANNEL', kind: 'CHANNEL', id: 'C001', name: 'Nhóm', channelKind: 'slack' },
  { pk: 'CONFIG', sk: 'SETTINGS', kind: 'CONFIG', value: { soonDays: 5 } },
  // Rows the snapshot must not read: inbox, delivery log, de-dup.
  ...Array.from({ length: 50 }, (_, i) => ({ pk: 'INBOX#an@x', sk: `2026-10-01T00:00:${i}#m${i}`, kind: 'INBOX' })),
  { pk: 'DELIVERY#C001', sk: '2026-10-01#d1', kind: 'DELIVERY' },
  { pk: 'SENT#k', sk: 'SENT', kind: 'SENT' },
];

describe('DynamoStore reads by kind', () => {
  it('builds the snapshot, users and channels from the byKind index without scanning', async () => {
    const { db, calls } = fakeDb(rows);
    const store = new DynamoStore('T', undefined, db);
    const snap = await store.snapshot({ now: new Date('2026-10-09T00:00:00Z') });
    expect(snap.users.map((u) => u.id)).toEqual(['an@x']);
    expect(snap.projects.map((p) => p.id)).toEqual(['P01']);
    expect(snap.updates).toHaveLength(1);
    expect(snap.items).toHaveLength(1);
    expect(snap.settings.soonDays).toBe(5);
    expect(snap.users[0]).not.toHaveProperty('pk');

    expect((await store.listUsers()).map((u) => u.name)).toEqual(['An']);
    expect(await store.listChannels()).toMatchObject([{ id: 'C001', kind: 'slack' }]);
    expect(calls.scan).toBe(0);
  });

  it('falls back to a scan while the index is not there yet', async () => {
    const { db, calls } = fakeDb(rows, { indexMissing: true });
    const store = new DynamoStore('T', undefined, db);
    const snap = await store.snapshot();
    expect(snap.projects.map((p) => p.id)).toEqual(['P01']);
    expect(snap.settings.soonDays).toBe(5);
    expect(await store.listChannels()).toMatchObject([{ id: 'C001', kind: 'slack' }]);
    expect(calls.scan).toBe(2);
    // After the first failure the index is not retried on every call.
    const queries = calls.query;
    await store.listUsers();
    expect(calls.query).toBe(queries);
  });
});

describe('DynamoStore update history', () => {
  const now = new Date('2026-10-09T00:00:00.000Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const update = (id: string, days: number, over: Partial<Update> = {}): Update => ({
    id,
    projectId: 'P01',
    at: ago(days),
    author: 'an@x',
    authorRole: 'PL',
    summary: id,
    ...over,
  });
  const row = (u: Update): Row => ({ ...u, pk: `PROJECT#${u.projectId}`, sk: `UPDATE#${u.at}#${u.id}`, kind: 'UPDATE' });
  const project: Row = {
    pk: 'PROJECT#P01',
    sk: 'PROJECT',
    kind: 'PROJECT',
    id: 'P01',
    name: 'Kho',
    state: 'active',
    pl: 'an@x',
    supporters: [],
    createdAt: ago(400),
  };
  // A red declared long ago, then 100 plain notes every 3 days.
  const history = [update('red', 300, { health: 'red' }), ...Array.from({ length: 100 }, (_, i) => update(`n${i}`, i * 3))];
  const ids = (us: Update[]) => us.map((u) => u.id);

  it('reads recent updates plus the pinned ones; pins are built once for older data', async () => {
    const { db, calls, rows } = fakeDb([project, ...history.map(row)]);
    const store = new DynamoStore('T', undefined, db);
    const first = await store.snapshot({ now });
    expect(calls.tableQuery).toBe(1); // the project's history, once, to build its pins
    expect(rows.filter((r) => r.sk === 'PINS')).toHaveLength(1);
    const second = await store.snapshot({ now });
    expect(calls.tableQuery).toBe(1);
    for (const snap of [first, second]) {
      expect(snap.updates).toHaveLength(22); // n0..n20 (60 days) + the red one
      expect(activeProjectViews(snap, now)[0]).toMatchObject({ declaredHealth: 'red', lastOwnerUpdate: { id: 'n0' } });
    }
  });

  it('keeps the pins current on writes without reading the history', async () => {
    const { db, calls } = fakeDb([project, ...history.map(row)]);
    const store = new DynamoStore('T', undefined, db);
    await store.listPinnedUpdates('P01'); // built from the history once
    calls.tableQuery = 0;
    const yellow = update('yellow', 0, { health: 'yellow' });
    await store.putUpdate(yellow);
    await store.putUpdate({ ...update('n50', 150), deletedAt: now.toISOString() }); // decides nothing
    expect(calls.tableQuery).toBe(0);
    expect(ids(await store.listPinnedUpdates('P01'))).toEqual(['yellow']);
    // Deleting a pinned update reads the history again: the red one counts again.
    await store.putUpdate({ ...yellow, deletedAt: now.toISOString() });
    expect(calls.tableQuery).toBe(1);
    expect(ids(await store.listPinnedUpdates('P01'))).toEqual(['n0', 'red']);
  });

  it('drops the pins when another writer changed them meanwhile; the next reader rebuilds them', async () => {
    const { db, rows } = fakeDb([project, ...history.map(row)]);
    const plain = new DynamoStore('T', undefined, db);
    await plain.listPinnedUpdates('P01');
    const send = (db as { send: (c: unknown) => Promise<unknown> }).send;
    const racing = {
      send: async (cmd: unknown) => {
        const res = await send(cmd);
        if (cmd instanceof GetCommand && cmd.input.Key?.sk === 'PINS') rows.find((r) => r.sk === 'PINS')!.version = 99;
        return res;
      },
    };
    await new DynamoStore('T', undefined, racing as never).putUpdate(update('late', 0, { health: 'green' }));
    expect(rows.some((r) => r.sk === 'PINS')).toBe(false);
    expect(ids(await plain.listPinnedUpdates('P01'))).toEqual(['n0', 'late']); // same time: higher id first
  });

  it('pages the history newest first, without deleted updates or the other rows of the project', async () => {
    const deleted = { ...update('n5', 15), deletedAt: now.toISOString() };
    const others: Row[] = [
      { pk: 'PROJECT#P01', sk: 'ITEM#I0001', kind: 'ITEM', id: 'I0001' },
      { pk: 'PROJECT#P01', sk: 'PINS', kind: 'PINS', updates: [] },
    ];
    const { db } = fakeDb([project, ...others, ...history.filter((u) => u.id !== 'n5').map(row), row(deleted)]);
    const store = new DynamoStore('T', undefined, db);
    const seen: string[] = [];
    let before: string | undefined;
    do {
      const page = await store.pageUpdates('P01', 7, before);
      seen.push(...ids(page));
      before = page.length === 7 ? updateCursor(page.at(-1)!) : undefined;
    } while (before);
    expect(seen).toEqual([...Array.from({ length: 100 }, (_, i) => `n${i}`).filter((id) => id !== 'n5'), 'red']);
    expect(ids(await store.listDeletedUpdates())).toEqual(['n5']);
  });

  it('reads every update while the index is not there yet', async () => {
    const { db } = fakeDb([project, ...history.map(row)], { indexMissing: true });
    expect((await new DynamoStore('T', undefined, db).snapshot({ now })).updates).toHaveLength(101);
  });
});

describe('DynamoStore items', () => {
  const now = new Date('2026-10-09T00:00:00.000Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const item = (id: string, over: Partial<Item> = {}): Item => ({
    id,
    projectId: 'P01',
    type: 'issue',
    title: id,
    priority: 'medium',
    date: '2026-10-01',
    status: 'open',
    createdBy: 'an@x',
    createdAt: ago(500),
    updatedAt: ago(1),
    ...over,
  });
  const row = (i: Item, kind = itemKind(i)): Row => ({ ...i, pk: `PROJECT#${i.projectId}`, sk: `ITEM#${i.id}`, kind });
  const project: Row = { pk: 'PROJECT#P01', sk: 'PROJECT', kind: 'PROJECT', id: 'P01', name: 'Kho', state: 'active', supporters: [] };
  const items = [
    item('open-old', { updatedAt: ago(400) }),
    item('done-recent', { status: 'done', updatedAt: ago(10) }),
    item('postponed-recent', { status: 'postponed', updatedAt: ago(59) }),
    item('done-old', { status: 'done', updatedAt: ago(61) }),
    item('done-ancient', { status: 'done', updatedAt: ago(700) }),
    item('deleted', { status: 'done', updatedAt: ago(800), deletedAt: ago(700) }),
  ];
  const ids = (list: Item[]) => list.map((i) => i.id).sort();

  it('files items by kind: open, closed by the month of their last change, deleted', () => {
    expect(items.map((i) => itemKind(i))).toEqual([
      'ITEM',
      'ITEM_CLOSED#2026-09',
      'ITEM_CLOSED#2026-08',
      'ITEM_CLOSED#2026-08',
      'ITEM_CLOSED#2024-11',
      'ITEM_DELETED',
    ]);
    expect(monthsSince('2026-08-10T00:00:00Z', now)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(monthsSince('2025-12-31T23:00:00Z', new Date('2026-02-01T00:00:00Z'))).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('the snapshot reads open items and the closed ones of the last months only; the trash also deleted ones', async () => {
    const { db, calls } = fakeDb([project, ...items.map((i) => row(i))]);
    const store = new DynamoStore('T', undefined, db);
    expect(ids((await store.snapshot({ now })).items)).toEqual(['done-recent', 'open-old', 'postponed-recent']);
    expect(calls.kinds.filter((k) => k.startsWith('ITEM')).sort()).toEqual([
      'ITEM',
      'ITEM_CLOSED#2026-08',
      'ITEM_CLOSED#2026-09',
      'ITEM_CLOSED#2026-10',
    ]);
    expect(calls.scan).toBe(0);
    const trash = await store.snapshot({ now, includeDeleted: true });
    expect(ids(trash.items)).toEqual(['deleted', 'done-recent', 'open-old', 'postponed-recent']);
    // A project page still has every item of its project.
    expect(ids(await store.listItems('P01'))).toEqual(ids(items.filter((i) => !i.deletedAt)));
  });

  it('writes move an item between kinds', async () => {
    const { db, rows } = fakeDb([project]);
    const store = new DynamoStore('T', undefined, db);
    const kind = () => rows.find((r) => r.sk === 'ITEM#I1')!.kind;
    await store.putItem(item('I1'));
    expect(kind()).toBe('ITEM');
    await store.putItem(item('I1', { status: 'done', updatedAt: ago(0) }));
    expect(kind()).toBe('ITEM_CLOSED#2026-10');
    await store.putItem(item('I1', { status: 'in_progress', updatedAt: ago(0) }));
    expect(kind()).toBe('ITEM');
    await store.putItem(item('I1', { deletedAt: ago(0) }));
    expect(kind()).toBe('ITEM_DELETED');
  });

  it('older rows (all ITEM) are filed once; one changed meanwhile is left to its writer', async () => {
    const { db, rows } = fakeDb([project, ...items.map((i) => row(i, 'ITEM'))]);
    const store = new DynamoStore('T', undefined, db);
    // Someone edits "done-old" while the snapshot reads: its re-filing must not undo that edit.
    const real = db as unknown as { send: (cmd: unknown) => Promise<unknown> };
    const send = real.send;
    real.send = async (cmd) => {
      if (cmd instanceof UpdateCommand && (cmd.input.Key as Row).sk === 'ITEM#done-old') rows.find((r) => r.sk === 'ITEM#done-old')!.updatedAt = ago(0);
      return send(cmd);
    };
    // Same answer as with filed rows.
    expect(ids((await store.snapshot({ now })).items)).toEqual(['done-recent', 'open-old', 'postponed-recent']);
    const kinds = Object.fromEntries(rows.filter((r) => String(r.sk).startsWith('ITEM#')).map((r) => [r.id, r.kind]));
    expect(kinds).toEqual({
      'open-old': 'ITEM',
      'done-recent': 'ITEM_CLOSED#2026-09',
      'postponed-recent': 'ITEM_CLOSED#2026-08',
      'done-old': 'ITEM',
      'done-ancient': 'ITEM_CLOSED#2024-11',
      deleted: 'ITEM_DELETED',
    });
  });

  it('an item closed while the snapshot reads comes back once, as its newest copy', async () => {
    const open = item('I1');
    const closed = item('I1', { status: 'done', updatedAt: ago(0) });
    const { db } = fakeDb([project, row(open), row(closed)]);
    expect((await new DynamoStore('T', undefined, db).snapshot({ now })).items).toEqual([closed]);
  });

  it('a snapshot without `now` (scripts) has every item; while the index is missing, a scan', async () => {
    const all = [project, ...items.map((i) => row(i))];
    expect(ids((await new DynamoStore('T', undefined, fakeDb(all).db).snapshot({ includeDeleted: true })).items)).toEqual(ids(items));
    const missing = fakeDb(all, { indexMissing: true });
    expect(ids((await new DynamoStore('T', undefined, missing.db).snapshot({ now })).items)).toEqual([
      'done-recent',
      'open-old',
      'postponed-recent',
    ]);
    expect(missing.calls.scan).toBe(1);
  });
});

describe('DynamoStore health days', () => {
  const mark = (health: 'green' | 'red') => ({ state: 'active' as const, health, overdueItems: 0, lateHours: 0 });
  const day = (date: string, health: 'green' | 'red' = 'green') => ({ date, at: `${date}T16:00:00.000Z`, projects: { P01: mark(health) } });

  it('one row per day under HEALTH, read by a date range of the table (no index, no scan)', async () => {
    const { db, calls, rows } = fakeDb([]);
    const store = new DynamoStore('T', undefined, db);
    for (const d of ['2026-10-07', '2026-10-08', '2026-10-09']) await store.putHealthDay(day(d));
    await store.putHealthDay(day('2026-10-08', 'red')); // a later check the same day replaces it
    expect(rows.map((r) => [r.pk, r.sk, r.kind])).toEqual([
      ['HEALTH', '2026-10-07', 'HEALTH'],
      ['HEALTH', '2026-10-08', 'HEALTH'],
      ['HEALTH', '2026-10-09', 'HEALTH'],
    ]);
    const read = await store.listHealthDays('2026-10-08', '2026-10-09');
    expect(read).toEqual([day('2026-10-08', 'red'), day('2026-10-09')]);
    expect(calls).toMatchObject({ query: 0, tableQuery: 1, scan: 0 });
  });

  it('the snapshot leaves them out, also when it scans', async () => {
    const all = [...rows, { pk: 'HEALTH', sk: '2026-10-08', kind: 'HEALTH', ...day('2026-10-08') }];
    for (const indexMissing of [false, true]) {
      const { db, calls } = fakeDb(all, { indexMissing });
      const snap = await new DynamoStore('T', undefined, db).snapshot({ now: new Date('2026-10-09T00:00:00Z') });
      expect(snap.projects.map((p) => p.id)).toEqual(['P01']);
      expect(calls.kinds).not.toContain('HEALTH');
    }
  });
});

describe('DynamoStore comments', () => {
  const comment = (id: string, over: Partial<Comment> = {}): Comment => ({
    id,
    projectId: 'P01',
    target: 'update',
    targetId: 'u1',
    updateAt: '2026-10-01T00:00:00Z',
    at: '2026-10-02T00:00:00Z',
    author: 'an@x',
    authorRole: 'PL',
    text: 'ok',
    mentions: [],
    ...over,
  });

  it("live ones in the project's partition, oldest first; deleted ones have their own kind for the trash", async () => {
    const { db, calls, rows: table } = fakeDb(rows);
    const store = new DynamoStore('T', undefined, db);
    await store.putComment(comment('c2'));
    await store.putComment(comment('c1'));
    await store.putComment(comment('c3', { deletedAt: '2026-10-03T00:00:00Z', deletedBy: 'an@x' }));
    expect(table.filter((r) => String(r.sk).startsWith('COMMENT#')).map((r) => [r.pk, r.sk, r.kind])).toEqual([
      ['PROJECT#P01', 'COMMENT#c2', 'COMMENT'],
      ['PROJECT#P01', 'COMMENT#c1', 'COMMENT'],
      ['PROJECT#P01', 'COMMENT#c3', 'COMMENT_DELETED'],
    ]);
    expect((await store.listComments('P01')).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect((await store.listDeletedComments()).map((c) => c.id)).toEqual(['c3']);
    expect(await store.getComment('P01', 'c2')).toEqual(comment('c2'));
    // Restoring files it back as live; the update history does not see comments.
    await store.putComment(comment('c3'));
    expect((await store.listComments('P01')).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect((await store.listUpdates('P01')).map((u) => u.id)).toEqual(['u1']);
    expect(calls.scan).toBe(0);
  });

  it('finds an update by its time and id', async () => {
    const store = new DynamoStore('T', undefined, fakeDb(rows).db);
    expect((await store.getUpdate('P01', '2026-10-01T00:00:00Z', 'u1'))?.summary).toBe('ok');
    expect(await store.getUpdate('P01', '2026-10-01T00:00:01Z', 'u1')).toBeUndefined();
  });
});
