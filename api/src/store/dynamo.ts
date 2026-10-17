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
  type DeliveryLog,
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
import {
  AUDIT_DAYS,
  ConflictError,
  DELIVERY_LOG_DAYS,
  INBOX_DAYS,
  inboxCursor,
  liveRows,
  liveSnapshot,
  OUTBOX_DAYS,
  outboxKey,
  type ListOptions,
  type Snapshot,
  type Store,
} from './store.js';

/*
 * Single-table layout (pk / sk):
 *   USER#<email>      USER
 *   PROJECT#<id>      PROJECT
 *   PROJECT#<id>      UPDATE#<iso time>#<id>
 *   PROJECT#<id>      ITEM#<id>
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
 * Every row also has `kind` so a full scan can be grouped cheaply.
 */
type Kind = 'USER' | 'PROJECT' | 'UPDATE' | 'ITEM' | 'CHANNEL' | 'SENT' | 'AUDIT' | 'NOTIFY' | 'INBOX' | 'OUTBOX' | 'DELIVERY' | 'PUSH' | 'TEMP';

const ttlAfter = (iso: string, days: number) => Math.floor(Date.parse(iso) / 1000) + days * 86_400;

export class DynamoStore implements Store {
  private db: DynamoDBDocumentClient;

  constructor(
    private table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
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
    return (await this.snapshot()).users;
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

  putUpdate(update: Update) {
    return this.put(`PROJECT#${update.projectId}`, `UPDATE#${update.at}#${update.id}`, 'UPDATE', update);
  }
  async listUpdates(projectId: string, opts?: ListOptions) {
    return liveRows(await this.query<Update>(`PROJECT#${projectId}`, 'UPDATE#'), opts);
  }

  getItem(projectId: string, id: string) {
    return this.get<Item>(`PROJECT#${projectId}`, `ITEM#${id}`);
  }
  putItem(item: Item) {
    return this.put(`PROJECT#${item.projectId}`, `ITEM#${item.id}`, 'ITEM', item);
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
    const out: Channel[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new ScanCommand({
          TableName: this.table,
          FilterExpression: 'kind = :k',
          ExpressionAttributeValues: { ':k': 'CHANNEL' },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(res.Items ?? []).map((i) => channelFromRow(i)));
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
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

  async snapshot(opts?: ListOptions): Promise<Snapshot> {
    const snap: Snapshot = { users: [], projects: [], updates: [], items: [], settings: DEFAULT_SETTINGS };
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(new ScanCommand({ TableName: this.table, ExclusiveStartKey: start }));
      for (const row of res.Items ?? []) {
        const kind = row.kind as Kind | 'CONFIG';
        if (kind === 'USER') snap.users.push(strip(row));
        else if (kind === 'PROJECT') snap.projects.push(strip(row));
        else if (kind === 'UPDATE') snap.updates.push(strip(row));
        else if (kind === 'ITEM') snap.items.push(strip(row));
        else if (row.sk === 'SETTINGS') snap.settings = { ...DEFAULT_SETTINGS, ...(row.value as Settings) };
      }
      start = res.LastEvaluatedKey;
    } while (start);
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
