import { App } from 'aws-cdk-lib';
import { parseInitialRoles } from '../../api/src/auth.js';
import { TrackerStack } from '../lib/stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? 'prod';
const list = (env: string | undefined, context: string) =>
  String(env ?? app.node.tryGetContext(context) ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
const adminEmails = list(process.env.ADMIN_EMAILS, 'adminEmails');
// Optional: CloudWatch alarms by email too (administrators always get them in the app).
const alarmEmails = list(process.env.ALARM_EMAILS, 'alarmEmails');
// Fail the deploy (not the running API) when ADMIN_EMAILS has a typo in a role.
parseInitialRoles(adminEmails);

new TrackerStack(app, `ProjectTracker-${stage}`, {
  adminEmails,
  alarmEmails,
  env:
    process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_REGION
      ? { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
      : undefined,
  tags: { app: 'project-tracker', stage },
});
