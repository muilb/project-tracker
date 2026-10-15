import { handle } from 'hono/aws-lambda';
import { CognitoAccounts } from './accounts.js';
import { createApp } from './app.js';
import { createSender } from './notify/sender.js';
import { DynamoStore } from './store/dynamo.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const app = createApp({
  store,
  auth: { mode: 'jwt', adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',') },
  send: createSender(store),
  webUrl: process.env.WEB_URL,
  accounts: new CognitoAccounts(process.env.USER_POOL_ID!),
});

export const handler = handle(app);
