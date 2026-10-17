import { GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { DynamoStore, KIND_INDEX } from '../src/store/dynamo.js';

type Row = Record<string, unknown>;

/** A document client over fixed rows: the byKind index, scans and gets; counts what is read. */
function fakeDb(rows: Row[], { indexMissing = false } = {}) {
  const calls = { query: 0, scan: 0, scannedRows: 0 };
  const send = async (cmd: unknown) => {
    if (cmd instanceof QueryCommand && cmd.input.IndexName === KIND_INDEX) {
      calls.query++;
      if (indexMissing) throw Object.assign(new Error('The table does not have the specified index: byKind'), { name: 'ValidationException' });
      const kind = cmd.input.ExpressionAttributeValues?.[':k'];
      return { Items: rows.filter((r) => r.kind === kind) };
    }
    if (cmd instanceof ScanCommand) {
      calls.scan++;
      calls.scannedRows += rows.length;
      return { Items: rows };
    }
    if (cmd instanceof GetCommand) {
      const { pk, sk } = cmd.input.Key as { pk: string; sk: string };
      return { Item: rows.find((r) => r.pk === pk && r.sk === sk) };
    }
    throw new Error(`unexpected command ${(cmd as object).constructor.name}`);
  };
  return { db: { send } as never, calls };
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
