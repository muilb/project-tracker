import { App } from 'aws-cdk-lib';
import { parseInitialRoles } from '../../api/src/auth.js';
import { TrackerStack } from '../lib/stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? 'prod';
const adminEmails = String(process.env.ADMIN_EMAILS ?? app.node.tryGetContext('adminEmails') ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
// Fail the deploy (not the running API) when ADMIN_EMAILS has a typo in a role.
parseInitialRoles(adminEmails);

new TrackerStack(app, `ProjectTracker-${stage}`, {
  adminEmails,
  env:
    process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_REGION
      ? { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
      : undefined,
  tags: { app: 'project-tracker', stage },
});
