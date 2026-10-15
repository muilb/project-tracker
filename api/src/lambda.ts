import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { DynamoStore } from './store/dynamo.js';

const app = createApp({
  store: new DynamoStore(process.env.TABLE_NAME!),
  auth: { mode: 'jwt', adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',') },
});

export const handler = handle(app);
