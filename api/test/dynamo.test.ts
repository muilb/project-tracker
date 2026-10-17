import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { DynamoStore, KIND_INDEX } from '../src/store/dynamo.js';
import { updateCursor } from '../src/store/store.js';
import type { Update } from '../src/types.js';
import { activeProjectViews } from '../src/views.js';

type Row = Record<string, unknown>;

/**
 * A document client over rows in memory: the byKind index, table queries, scans, gets, conditional
 * puts and deletes, with DynamoDB's paging (Limit counts rows read before the filter). Counts reads.
 */
function fakeDb(initial: Row[], { indexMissing = false } = {}) {
  const rows = [...initial];
  const calls = { query: 0, tableQuery: 0, scan: 0, scannedRows: 0, pinsPut: 0 };
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
    const snap = await store.snapshot();
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
