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
  type Item,
  type Project,
  type Settings,
  type TelegramBot,
  type Update,
  type User,
} from '../types.js';
import { AUDIT_DAYS, ConflictError, liveRows, liveSnapshot, type ListOptions, type Snapshot, type Store } from './store.js';

/*
 * Single-table layout (pk / sk):
 *   USER#<email>      USER
 *   PROJECT#<id>      PROJECT
 *   PROJECT#<id>      UPDATE#<iso time>#<id>
 *   PROJECT#<id>      ITEM#<id>
 *   CHANNEL#<id>      CHANNEL
 *   SENT#<key>        SENT              (alert de-duplication, expires via the `ttl` attribute)
 *   AUDIT             <iso time>#<id>   (administrative log, expires via `ttl` after AUDIT_DAYS)
 *   CONFIG            SETTINGS | TELEGRAM | SEQ#project | SEQ#item | SEQ#channel
 * Every row also has `kind` so a full scan can be grouped cheaply.
 */
type Kind = 'USER' | 'PROJECT' | 'UPDATE' | 'ITEM' | 'CHANNEL' | 'SENT' | 'AUDIT';

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
  async listAudit(limit: number) {
    const res = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'AUDIT' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((row) => {
      const { ttl: _ttl, ...entry } = strip<AuditEntry & { ttl?: number }>(row);
      return entry as AuditEntry;
    });
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
