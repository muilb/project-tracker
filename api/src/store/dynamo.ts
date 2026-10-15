import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DEFAULT_SETTINGS, type Item, type Project, type Settings, type Update, type User } from '../types.js';
import { ConflictError, type Snapshot, type Store } from './store.js';

/*
 * Single-table layout (pk / sk):
 *   USER#<email>      USER
 *   PROJECT#<id>      PROJECT
 *   PROJECT#<id>      UPDATE#<iso time>#<id>
 *   PROJECT#<id>      ITEM#<id>
 *   CONFIG            SETTINGS | SEQ#project | SEQ#item
 * Every row also has `kind` so a full scan can be grouped cheaply.
 */
type Kind = 'USER' | 'PROJECT' | 'UPDATE' | 'ITEM';

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

  addUpdate(update: Update) {
    return this.put(`PROJECT#${update.projectId}`, `UPDATE#${update.at}#${update.id}`, 'UPDATE', update);
  }
  listUpdates(projectId: string) {
    return this.query<Update>(`PROJECT#${projectId}`, 'UPDATE#');
  }

  getItem(projectId: string, id: string) {
    return this.get<Item>(`PROJECT#${projectId}`, `ITEM#${id}`);
  }
  putItem(item: Item) {
    return this.put(`PROJECT#${item.projectId}`, `ITEM#${item.id}`, 'ITEM', item);
  }
  listItems(projectId: string) {
    return this.query<Item>(`PROJECT#${projectId}`, 'ITEM#');
  }

  async getSettings() {
    const s = await this.get<{ value: Settings }>('CONFIG', 'SETTINGS');
    return { ...DEFAULT_SETTINGS, ...s?.value };
  }
  putSettings(settings: Settings) {
    return this.put('CONFIG', 'SETTINGS', 'CONFIG', { value: settings });
  }

  async nextSeq(name: 'project' | 'item') {
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

  async snapshot(): Promise<Snapshot> {
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
    return snap;
  }
}

function strip<T>(row: Record<string, unknown>): T {
  const { pk: _pk, sk: _sk, kind: _kind, ...rest } = row;
  return rest as T;
}
