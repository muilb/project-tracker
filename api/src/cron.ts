// Hourly Lambda (EventBridge rule): Teams alerts for late updates, overdue items,
// tomorrow's events/milestones, and the 08:00 daily digest.
import { runHourly } from './notify/alerts.js';
import { sendTeams } from './notify/teams.js';
import { DynamoStore } from './store/dynamo.js';

const deps = { store: new DynamoStore(process.env.TABLE_NAME!), send: sendTeams, webUrl: process.env.WEB_URL };

export const handler = async () => {
  const result = await runHourly(deps, new Date());
  console.log('hourly alerts', result);
  return result;
};
