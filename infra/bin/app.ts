import { App } from 'aws-cdk-lib';
import { TrackerStack } from '../lib/stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? 'prod';
const adminEmails = String(process.env.ADMIN_EMAILS ?? app.node.tryGetContext('adminEmails') ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

new TrackerStack(app, `ProjectTracker-${stage}`, {
  adminEmails,
  env:
    process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_REGION
      ? { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
      : undefined,
  tags: { app: 'project-tracker', stage },
});
