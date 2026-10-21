import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DEFAULT_SETTINGS,
  type AiConfig,
  type AuditEntry,
  type Channel,
  type ChannelKind,
  type Comment,
  type DeliveryLog,
  type HealthDay,
  type InboxEntry,
  type Item,
  type NotifyPrefs,
  type OutboxEntry,
  type Project,
  type PushConfig,
  type PushSubscriptionRecord,
  type Settings,
  type TelegramBot,
  type Update,
  type User,
} from '../types.js';
import { pinUpdates } from '../rules.js';
import {
  AUDIT_DAYS,
  ConflictError,
  DELIVERY_LOG_DAYS,
  INBOX_DAYS,
  inboxCursor,
  itemClosed,
  keepItem,
  liveRows,
  liveSnapshot,
  OUTBOX_DAYS,
  outboxKey,
  snapshotSince,
  uniqueUpdates,
  type ListOptions,
  type Snapshot,
  type SnapshotOptions,
  type Store,
} from './store.js';

/*
 * Single-table layout (pk / sk):
 *   USER#<email>      USER
 *   PROJECT#<id>      PROJECT
 *   PROJECT#<id>      UPDATE#<iso time>#<id>
 *   PROJECT#<id>      ITEM#<id>
 *   PROJECT#<id>      PINS              (pinned updates, see rules.pinUpdates: enough for the views)
 *   PROJECT#<id>      COMMENT#<id>      (comments under updates / items; ids are time-ordered)
 *   CHANNEL#<id>      CHANNEL
 *   SENT#<key>        SENT              (alert de-duplication, expires via the `ttl` attribute)
 *   AUDIT             <iso time>#<id>   (administrative log, expires via `ttl` after AUDIT_DAYS)
 *   NOTIFY            <email>           (personal notification settings)
 *   INBOX#<email>     <iso time>#<id>   (web inbox, expires via `ttl` after INBOX_DAYS)
 *   OUTBOX            <iso due>#<id>    (messages waiting for delivery, expire after OUTBOX_DAYS)
 *   DELIVERY#<chan>   <iso time>#<id>   (delivery attempts, expire after DELIVERY_LOG_DAYS)
 *   CONFIG            SETTINGS | TELEGRAM | AI | PUSH | SEQ#project | SEQ#item | SEQ#channel
 *   PUSH#<email>      <subscription id> (Web Push browsers / phones, track H)
 *   TEMP#<key>        TEMP              (track G: Telegram bot state and counters, expire via `ttl`)
 *   HEALTH            <YYYY-MM-DD>      (every project's colour at the end of a Vietnam day, trend.ts)
 * Every row also has `kind`. The `byKind` index (partition `kind`, sort `sk`) lets the snapshot,
 * users and channels be read by kind, so the inbox / logs / de-dup rows are never scanned. Its sort
 * key starts with the update time for updates, so the snapshot reads only recent ones (plus PINS).
 * Items are split by `kind` the same way (`itemKind`): open ones are `ITEM`, closed ones
 * `ITEM_CLOSED#<month of their last change>` and deleted ones `ITEM_DELETED`, so the snapshot reads
 * the open items and the last few months of closed ones, and only the trash reads deleted ones.
 */
type Kind =
  | 'USER'
  | 'PROJECT'
  | 'UPDATE'
  | 'ITEM'
  | `ITEM_CLOSED#${string}`
  | 'ITEM_DELETED'
  | 'PINS'
  | 'COMMENT'
  | 'COMMENT_DELETED'
  | 'CHANNEL'
  | 'SENT'
  | 'AUDIT'
  | 'NOTIFY'
  | 'INBOX'
  | 'OUTBOX'
  | 'DELIVERY'
  | 'PUSH'
  | 'TEMP'
  | 'HEALTH';

/** Global secondary index on `kind` (see infra/lib/stack.ts). */
export const KIND_INDEX = 'byKind';

/** A project's pinned updates; `version` guards concurrent writers. */
type PinsRow = { updates: Update[]; version: number };

/** Index partition of an item: open, closed in a month (YYYY-MM of its last change), or deleted. */
export function itemKind(item: Item): Kind {
  if (item.deletedAt) return 'ITEM_DELETED';
  return itemClosed(item) ? `ITEM_CLOSED#${item.updatedAt.slice(0, 7)}` : 'ITEM';
}

/** YYYY-MM of every month from `since` to `now` (the closed-item partitions a snapshot reads). */
export function monthsSince(since: string, now: Date): string[] {
  const months: string[] = [];
  const d = new Date(`${since.slice(0, 7)}-01T00:00:00Z`);
  const end = now.toISOString().slice(0, 7);
  for (let m = d.toISOString().slice(0, 7); m <= end; m = d.toISOString().slice(0, 7)) {
    months.push(m);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}

const ttlAfter = (iso: string, days: number) => Math.floor(Date.parse(iso) / 1000) + days * 86_400;

export class DynamoStore implements Store {
  private db: Pick<DynamoDBDocumentClient, 'send'>;
  /** False while the `byKind` index is missing or still being built (first deploy): fall back to scans. */
  private indexReady = true;

  constructor(
    private table: string,
    client = new DynamoDBClient({}),
    /** Tests pass a fake document client. */
    db?: Pick<DynamoDBDocumentClient, 'send'>,
  ) {
    this.db = db ?? DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  /**
   * Every row of one kind (with a sort key from `from`, matching `filter`), from the `byKind` index;
   * undefined when the index cannot be used yet.
   */
  private async byKind(
    kind: Kind | 'CONFIG',
    opts: { from?: string; filter?: string } = {},
  ): Promise<Record<string, unknown>[] | undefined> {
    if (!this.indexReady) return undefined;
    const out: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    try {
      do {
        const res = await this.db.send(
          new QueryCommand({
            TableName: this.table,
            IndexName: KIND_INDEX,
            KeyConditionExpression: opts.from ? 'kind = :k AND sk >= :from' : 'kind = :k',
            ExpressionAttributeValues: { ':k': kind, ...(opts.from ? { ':from': opts.from } : {}) },
            ...(opts.filter ? { FilterExpression: opts.filter } : {}),
            ExclusiveStartKey: start,
          }),
        );
        out.push(...(res.Items ?? []));
        start = res.LastEvaluatedKey;
      } while (start);
    } catch (e) {
      // "The table does not have the specified index" (not deployed / still backfilling).
      if ((e as Error).name !== 'ValidationException') throw e;
      console.warn(`index ${KIND_INDEX} not usable yet, scanning instead`);
      this.indexReady = false;
      setTimeout(() => (this.indexReady = true), 60_000).unref?.();
      return undefined;
    }
    return out;
  }

  /** Full-table scan: only the fallback while the index is not ready. */
  private async scanAll(): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(new ScanCommand({ TableName: this.table, ExclusiveStartKey: start }));
      out.push(...(res.Items ?? []));
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  private async get<T>(pk: string, sk: string): Promise<T | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk, sk } }));
    return res.Item ? strip<T>(res.Item) : undefined;
  }

  private async put(pk: string, sk: string, kind: Kind | 'CONFIG', data: object, ifNew = false) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { ...data, pk, sk, kind },
          ...(ifNew ? { ConditionExpression: 'attribute_not_exists(pk)' } : {}),
        }),
      );
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new ConflictError(`${pk} already exists`);
      throw e;
    }
  }

  /** Newest first (descending sk), up to `limit`, optionally below the `before` sort key. */
  private async latest<T>(pk: string, limit: number, before?: string, filter?: { expr: string; values: Record<string, unknown> }) {
    const out: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: before ? 'pk = :pk AND sk < :before' : 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk, ...(before ? { ':before': before } : {}), ...filter?.values },
          ...(filter ? { FilterExpression: filter.expr } : {}),
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: start,
        }),
      );
      for (const row of res.Items ?? []) {
        const { ttl: _ttl, ...rest } = strip<Record<string, unknown>>(row);
        out.push(rest as T);
      }
      start = res.LastEvaluatedKey;
    } while (start && out.length < limit);
    return out.slice(0, limit);
  }

  private async query<T>(pk: string, skPrefix: string): Promise<T[]> {
    const out: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(res.Items ?? []).map((i) => strip<T>(i)));
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  getUser(id: string) {
    return this.get<User>(`USER#${id}`, 'USER');
  }
  putUser(user: User) {
    return this.put(`USER#${user.id}`, 'USER', 'USER', user);
  }
  async listUsers() {
    const rows = await this.byKind('USER');
    return rows ? rows.map((r) => strip<User>(r)) : (await this.snapshot()).users;
  }

  getProject(id: string) {
    return this.get<Project>(`PROJECT#${id}`, 'PROJECT');
  }
  createProject(project: Project) {
    return this.put(`PROJECT#${project.id}`, 'PROJECT', 'PROJECT', project, true);
  }
  putProject(project: Project) {
    return this.put(`PROJECT#${project.id}`, 'PROJECT', 'PROJECT', project);
  }

  async putUpdate(update: Update) {
    await this.put(`PROJECT#${update.projectId}`, `UPDATE#${update.at}#${update.id}`, 'UPDATE', update);
    const row = await this.get<PinsRow>(`PROJECT#${update.projectId}`, 'PINS');
    const pinned = row?.updates.some((u) => u.id === update.id);
    if (row && !pinned && update.deletedAt) return; // deleting an update that decides nothing
    // A new / restored update is merged in; a pinned one that changed needs the whole history again
    // (with this write applied: the query may not see it yet).
    const history = async () =>
      (await this.listUpdates(update.projectId, { includeDeleted: true })).filter((u) => u.id !== update.id);
    const updates = pinUpdates([...(row && !pinned ? row.updates : await history()), update]);
    // Someone else changed the pins meanwhile: drop them, the next reader rebuilds them from the history.
    if (!(await this.savePins(update.projectId, updates, row?.version)))
      await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: `PROJECT#${update.projectId}`, sk: 'PINS' } }));
  }
  async listUpdates(projectId: string, opts?: ListOptions) {
    return liveRows(await this.query<Update>(`PROJECT#${projectId}`, 'UPDATE#'), opts);
  }
  async pageUpdates(projectId: string, limit: number, before?: string) {
    // BETWEEN includes its ends: the row at the cursor itself is skipped.
    const hi = before ? `UPDATE#${before}` : 'UPDATE$';
    const out: Update[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :lo AND :hi',
          ExpressionAttributeValues: { ':pk': `PROJECT#${projectId}`, ':lo': 'UPDATE#', ':hi': hi },
          FilterExpression: 'attribute_not_exists(deletedAt)',
          ScanIndexForward: false,
          Limit: limit + 1,
          ExclusiveStartKey: start,
        }),
      );
      for (const row of res.Items ?? []) if (row.sk !== hi) out.push(strip<Update>(row));
      start = res.LastEvaluatedKey;
    } while (start && out.length < limit);
    return out.slice(0, limit);
  }
  async listPinnedUpdates(projectId: string) {
    return (await this.get<PinsRow>(`PROJECT#${projectId}`, 'PINS'))?.updates ?? (await this.rebuildPins(projectId));
  }
  async listDeletedUpdates() {
    const rows =
      (await this.byKind('UPDATE', { filter: 'attribute_exists(deletedAt)' })) ??
      (await this.scanAll()).filter((r) => r.kind === 'UPDATE' && r.deletedAt);
    return rows.map((r) => strip<Update>(r));
  }

  /** Saves a project's pinned updates; false when another writer saved them since `version` was read. */
  private async savePins(projectId: string, updates: Update[], version?: number) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: `PROJECT#${projectId}`, sk: 'PINS', kind: 'PINS', updates, version: (version ?? 0) + 1 },
          ...(version === undefined
            ? { ConditionExpression: 'attribute_not_exists(pk)' }
            : { ConditionExpression: 'version = :v', ExpressionAttributeValues: { ':v': version } }),
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }
  /** Pins from the whole history, for a project that has none saved (data from before pins, or dropped). */
  private async rebuildPins(projectId: string) {
    const updates = pinUpdates(await this.listUpdates(projectId));
    await this.savePins(projectId, updates); // false: another writer saved them first, theirs stay
    return updates;
  }

  getUpdate(projectId: string, at: string, id: string) {
    return this.get<Update>(`PROJECT#${projectId}`, `UPDATE#${at}#${id}`);
  }

  getItem(projectId: string, id: string) {
    return this.get<Item>(`PROJECT#${projectId}`, `ITEM#${id}`);
  }

  getComment(projectId: string, id: string) {
    return this.get<Comment>(`PROJECT#${projectId}`, `COMMENT#${id}`);
  }
  putComment(comment: Comment) {
    // Deleted ones have their own kind, so only the trash reads them.
    return this.put(`PROJECT#${comment.projectId}`, `COMMENT#${comment.id}`, comment.deletedAt ? 'COMMENT_DELETED' : 'COMMENT', comment);
  }
  async listComments(projectId: string) {
    return liveRows(await this.query<Comment>(`PROJECT#${projectId}`, 'COMMENT#'));
  }
  async listDeletedComments() {
    const rows = (await this.byKind('COMMENT_DELETED')) ?? (await this.scanAll()).filter((r) => r.kind === 'COMMENT_DELETED');
    return rows.map((r) => strip<Comment>(r));
  }
  putItem(item: Item) {
    return this.put(`PROJECT#${item.projectId}`, `ITEM#${item.id}`, itemKind(item), item);
  }

  /**
   * The items a snapshot carries (`keepItem`). With `since`: the open ones, the closed ones of the
   * months since then and, for the trash, the deleted ones; without: all of them (a scan, scripts only).
   * Undefined when the index cannot be used yet.
   */
  private async snapshotItems(since: string | undefined, now: Date | undefined, includeDeleted?: boolean) {
    let rows: Record<string, unknown>[] | undefined;
    if (since && now) {
      const parts = await Promise.all([
        this.byKind('ITEM'),
        ...monthsSince(since, now).map((m) => this.byKind(`ITEM_CLOSED#${m}`)),
        includeDeleted ? this.byKind('ITEM_DELETED') : [],
      ]);
      if (parts.some((p) => !p)) return undefined;
      rows = parts.flat() as Record<string, unknown>[];
      await this.fileOldItems(parts[0]!);
    } else {
      if (!(await this.byKind('ITEM'))) return undefined;
      rows = (await this.scanAll()).filter((r) => String(r.kind).startsWith('ITEM'));
    }
    // An item closed or reopened while the kinds were read can come back from two of them: keep its newest copy.
    const newest = new Map<string, Item>();
    for (const i of rows.map((r) => strip<Item>(r))) {
      const key = `${i.projectId}#${i.id}`;
      if (!newest.has(key) || i.updatedAt > newest.get(key)!.updatedAt) newest.set(key, i);
    }
    const items = [...newest.values()];
    return since ? items.filter((i) => keepItem(i, since, includeDeleted)) : items;
  }

  /**
   * Rows written before items were split by kind are all `ITEM`: move the closed / deleted ones to
   * their own kind once (only if unchanged since they were read; a newer write sets the kind itself).
   */
  private async fileOldItems(rows: Record<string, unknown>[]) {
    const stale = rows.filter((r) => itemKind(r as unknown as Item) !== 'ITEM');
    await Promise.all(
      stale.map(async (r) => {
        try {
          await this.db.send(
            new UpdateCommand({
              TableName: this.table,
              Key: { pk: r.pk, sk: r.sk },
              UpdateExpression: 'SET kind = :k',
              ConditionExpression: 'kind = :old AND updatedAt = :u',
              ExpressionAttributeValues: { ':k': itemKind(r as unknown as Item), ':old': 'ITEM', ':u': r.updatedAt },
            }),
          );
        } catch (e) {
          if (!(e instanceof ConditionalCheckFailedException)) throw e;
        }
      }),
    );
  }
  async listItems(projectId: string, opts?: ListOptions) {
    return liveRows(await this.query<Item>(`PROJECT#${projectId}`, 'ITEM#'), opts);
  }

  async getSettings() {
    const s = await this.get<{ value: Settings }>('CONFIG', 'SETTINGS');
    return { ...DEFAULT_SETTINGS, ...s?.value };
  }
  putSettings(settings: Settings) {
    return this.put('CONFIG', 'SETTINGS', 'CONFIG', { value: settings });
  }

  async listChannels() {
    const rows = (await this.byKind('CHANNEL')) ?? (await this.scanAll()).filter((r) => r.kind === 'CHANNEL');
    return rows.map((r) => channelFromRow(r));
  }
  async getChannel(id: string) {
    const row = await this.get<Record<string, unknown>>(`CHANNEL#${id}`, 'CHANNEL');
    return row && channelFromRow(row);
  }
  putChannel(channel: Channel) {
    return this.put(`CHANNEL#${channel.id}`, 'CHANNEL', 'CHANNEL', channelToRow(channel));
  }
  async deleteChannel(id: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: `CHANNEL#${id}`, sk: 'CHANNEL' } }));
  }

  async getTelegramBot() {
    return (await this.get<{ value: TelegramBot }>('CONFIG', 'TELEGRAM'))?.value;
  }
  async putTelegramBot(bot: TelegramBot | undefined) {
    if (bot) await this.put('CONFIG', 'TELEGRAM', 'CONFIG', { value: bot });
    else await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: 'CONFIG', sk: 'TELEGRAM' } }));
  }

  async getAiConfig() {
    return (await this.get<{ value: AiConfig }>('CONFIG', 'AI'))?.value;
  }
  async putAiConfig(config: AiConfig | undefined) {
    if (config) await this.put('CONFIG', 'AI', 'CONFIG', { value: config });
    else await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: 'CONFIG', sk: 'AI' } }));
  }

  async hasSent(key: string) {
    const row = await this.get<{ ttl: number }>(`SENT#${key}`, 'SENT');
    // DynamoDB deletes expired rows lazily, so also check the expiry here.
    return !!row && row.ttl * 1000 > Date.now();
  }
  markSent(key: string, ttlDays: number) {
    return this.put(`SENT#${key}`, 'SENT', 'SENT', { ttl: Math.floor(Date.now() / 1000) + ttlDays * 86_400 });
  }

  addAudit(entry: AuditEntry) {
    return this.put('AUDIT', `${entry.at}#${entry.id}`, 'AUDIT', {
      ...entry,
      ttl: Math.floor(Date.parse(entry.at) / 1000) + AUDIT_DAYS * 86_400,
    });
  }
  async listAudit(limit: number, before?: string) {
    const res = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: before ? 'pk = :pk AND sk < :before' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'AUDIT', ...(before ? { ':before': before } : {}) },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((row) => {
      const { ttl: _ttl, ...entry } = strip<AuditEntry & { ttl?: number }>(row);
      return entry as AuditEntry;
    });
  }

  getNotifyPrefs(userId: string) {
    return this.get<NotifyPrefs>('NOTIFY', userId);
  }
  putNotifyPrefs(prefs: NotifyPrefs) {
    return this.put('NOTIFY', prefs.userId, 'NOTIFY', prefs);
  }
  async listNotifyPrefs() {
    return this.latest<NotifyPrefs>('NOTIFY', 10_000);
  }

  addInbox(entry: InboxEntry) {
    return this.put(`INBOX#${entry.userId}`, inboxCursor(entry), 'INBOX', { ...entry, ttl: ttlAfter(entry.at, INBOX_DAYS) });
  }
  listInbox(userId: string, limit: number, before?: string) {
    return this.latest<InboxEntry>(`INBOX#${userId}`, limit, before);
  }
  async markInboxRead(userId: string, ids: string[] | 'all', at: string) {
    const unread = await this.latest<InboxEntry>(`INBOX#${userId}`, 1000, undefined, {
      expr: 'attribute_not_exists(readAt)',
      values: {},
    });
    const pick = ids === 'all' ? unread : unread.filter((e) => ids.includes(e.id));
    await Promise.all(
      pick.map((e) =>
        this.db.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { pk: `INBOX#${userId}`, sk: inboxCursor(e) },
            UpdateExpression: 'SET readAt = :at',
            ExpressionAttributeValues: { ':at': at },
          }),
        ),
      ),
    );
  }
  async countUnread(userId: string) {
    return (await this.latest<InboxEntry>(`INBOX#${userId}`, 1000, undefined, { expr: 'attribute_not_exists(readAt)', values: {} }))
      .length;
  }

  enqueue(entry: OutboxEntry) {
    return this.put('OUTBOX', outboxKey(entry), 'OUTBOX', { ...entry, ttl: ttlAfter(entry.createdAt, OUTBOX_DAYS) });
  }
  async listDue(now: Date, limit: number) {
    const res = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        // '~' sorts after '#', so every entry due at or before now is included.
        KeyConditionExpression: 'pk = :pk AND sk <= :now',
        ExpressionAttributeValues: { ':pk': 'OUTBOX', ':now': `${now.toISOString()}~` },
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((row) => {
      const { ttl: _ttl, ...entry } = strip<OutboxEntry & { ttl?: number }>(row);
      return entry as OutboxEntry;
    });
  }
  async claimOutbox(entry: OutboxEntry) {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { pk: 'OUTBOX', sk: outboxKey(entry) },
          ConditionExpression: 'attribute_exists(pk)',
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }

  addDeliveryLog(entry: DeliveryLog) {
    return this.put(`DELIVERY#${entry.channelId}`, `${entry.at}#${entry.id}`, 'DELIVERY', {
      ...entry,
      ttl: ttlAfter(entry.at, DELIVERY_LOG_DAYS),
    });
  }
  listDeliveryLog(channelId: string, limit: number) {
    return this.latest<DeliveryLog>(`DELIVERY#${channelId}`, limit);
  }

  async nextSeq(name: 'project' | 'item' | 'channel') {
    const res = await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: 'CONFIG', sk: `SEQ#${name}` },
        UpdateExpression: 'ADD #v :one SET kind = :kind',
        ExpressionAttributeNames: { '#v': 'value' },
        ExpressionAttributeValues: { ':one': 1, ':kind': 'CONFIG' },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.value);
  }

  // track G
  async getTemp<T>(key: string) {
    const row = await this.get<{ value: T; ttl: number }>(`TEMP#${key}`, 'TEMP');
    // DynamoDB deletes expired rows lazily, so also check the expiry here.
    return row && row.ttl * 1000 > Date.now() ? row.value : undefined;
  }
  putTemp(key: string, value: unknown, ttlSeconds: number) {
    return this.put(`TEMP#${key}`, 'TEMP', 'TEMP', { value, ttl: Math.floor(Date.now() / 1000) + ttlSeconds });
  }
  async takeTemp<T>(key: string) {
    const res = await this.db.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: `TEMP#${key}`, sk: 'TEMP' }, ReturnValues: 'ALL_OLD' }),
    );
    const row = res.Attributes as { value: T; ttl: number } | undefined;
    return row && row.ttl * 1000 > Date.now() ? row.value : undefined;
  }
  async bumpCounter(key: string, ttlSeconds: number) {
    const res = await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: `TEMP#${key}`, sk: 'TEMP' },
        UpdateExpression: 'ADD #v :one SET kind = :kind, #ttl = if_not_exists(#ttl, :ttl)',
        ExpressionAttributeNames: { '#v': 'value', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':kind': 'TEMP', ':ttl': Math.floor(Date.now() / 1000) + ttlSeconds },
        ReturnValues: 'ALL_NEW',
      }),
    );
    // An expired counter DynamoDB has not deleted yet counts from 1 again.
    if (Number(res.Attributes?.ttl) * 1000 <= Date.now()) {
      await this.putTemp(key, 1, ttlSeconds);
      return 1;
    }
    return Number(res.Attributes?.value);
  }

  putHealthDay(day: HealthDay) {
    return this.put('HEALTH', day.date, 'HEALTH', day);
  }
  async listHealthDays(from: string, to: string) {
    const out: HealthDay[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :lo AND :hi',
          ExpressionAttributeValues: { ':pk': 'HEALTH', ':lo': from, ':hi': to },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(res.Items ?? []).map((r) => strip<HealthDay>(r)));
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  async snapshot(opts?: SnapshotOptions): Promise<Snapshot> {
    const snap: Snapshot = { users: [], projects: [], updates: [], items: [], settings: DEFAULT_SETTINGS };
    const since = opts?.now && snapshotSince(opts.now);
    const [users, projects, updates, items, pins] = await Promise.all([
      this.byKind('USER'),
      this.byKind('PROJECT'),
      this.byKind('UPDATE', since ? { from: `UPDATE#${since}` } : {}),
      this.snapshotItems(since, opts?.now, opts?.includeDeleted),
      since ? this.byKind('PINS') : [],
    ]);
    let settingsRow: Record<string, unknown> | undefined;
    if (users && projects && updates && items && pins) {
      snap.users = users.map((r) => strip<User>(r));
      snap.projects = projects.map((r) => strip<Project>(r));
      snap.updates = updates.map((r) => strip<Update>(r));
      snap.items = items;
      if (since) {
        // Pins saved per project; a project without them yet (older data) gets them from its history once.
        const saved = new Map(pins.map((r) => [String(r.pk).slice('PROJECT#'.length), (r as unknown as PinsRow).updates]));
        const pinned = await Promise.all(snap.projects.map(async (p) => saved.get(p.id) ?? (await this.rebuildPins(p.id))));
        snap.updates = uniqueUpdates([...snap.updates, ...pinned.flat()]);
      }
      settingsRow = await this.get<Record<string, unknown>>('CONFIG', 'SETTINGS');
    } else {
      for (const row of await this.scanAll()) {
        const kind = row.kind as Kind | 'CONFIG';
        if (kind === 'USER') snap.users.push(strip(row));
        else if (kind === 'PROJECT') snap.projects.push(strip(row));
        else if (kind === 'UPDATE') snap.updates.push(strip(row));
        else if (String(kind).startsWith('ITEM')) {
          const item = strip<Item>(row);
          if (!since || keepItem(item, since, opts?.includeDeleted)) snap.items.push(item);
        }
        else if (row.sk === 'SETTINGS') settingsRow = strip(row);
      }
    }
    if (settingsRow) snap.settings = { ...DEFAULT_SETTINGS, ...(settingsRow.value as Settings) };
    return opts?.includeDeleted ? snap : liveSnapshot(snap);
  }

  // track H: Web Push.
  async getPushConfig() {
    return (await this.get<{ value: PushConfig }>('CONFIG', 'PUSH'))?.value;
  }
  async initPushConfig(config: PushConfig) {
    try {
      await this.put('CONFIG', 'PUSH', 'CONFIG', { value: config }, true);
      return config;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      return (await this.getPushConfig())!;
    }
  }
  putPushSubscription(sub: PushSubscriptionRecord) {
    return this.put(`PUSH#${sub.userId}`, sub.id, 'PUSH', sub);
  }
  getPushSubscription(userId: string, id: string) {
    return this.get<PushSubscriptionRecord>(`PUSH#${userId}`, id);
  }
  async listPushSubscriptions(userId: string) {
    const subs = await this.latest<PushSubscriptionRecord>(`PUSH#${userId}`, 100);
    return subs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async deletePushSubscription(userId: string, id: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: `PUSH#${userId}`, sk: id } }));
  }
}

// Every row has a `kind` attribute (row type), so Channel.kind is stored as `channelKind`.
export function channelToRow({ kind, ...rest }: Channel): Record<string, unknown> {
  return { ...rest, channelKind: kind };
}
export function channelFromRow(row: Record<string, unknown>): Channel {
  const { channelKind, ...rest } = strip<Record<string, unknown>>(row);
  // Rows saved before the fix lost their kind; a Telegram channel always has a chat id.
  const kind = (channelKind as ChannelKind | undefined) ?? (rest.telegramChatId ? 'telegram' : 'teams');
  return { ...rest, kind } as Channel;
}

function strip<T>(row: Record<string, unknown>): T {
  const { pk: _pk, sk: _sk, kind: _kind, ...rest } = row;
  return rest as T;
}
