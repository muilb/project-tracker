import { handle } from 'hono/aws-lambda';
import { CognitoAccounts } from './accounts.js';
import { createApp } from './app.js';
import { sendTeams } from './notify/teams.js';
import { DynamoStore } from './store/dynamo.js';

const app = createApp({
  store: new DynamoStore(process.env.TABLE_NAME!),
  auth: { mode: 'jwt', adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',') },
  send: sendTeams,
  webUrl: process.env.WEB_URL,
  accounts: new CognitoAccounts(process.env.USER_POOL_ID!),
});

export const handler = handle(app);
