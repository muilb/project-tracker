// Loads the Excel sample data into a DynamoDB table — for dev/test environments only.
//   npm run seed -- --table <TableName>
// Uses the normal AWS credential chain (AWS_PROFILE, AWS_REGION, ...).
import { loadSample } from '../src/seed/sample.js';
import { DynamoStore } from '../src/store/dynamo.js';

const args = process.argv.slice(2);
const table = args[args.indexOf('--table') + 1];
if (!args.includes('--table') || !table) {
  console.error('Usage: npm run seed -- --table <TableName>');
  process.exit(1);
}

const store = new DynamoStore(table);
const existing = (await store.snapshot()).projects.length;
if (existing > 0) {
  console.error(`Table ${table} already has ${existing} projects; the sample is only loaded into an empty table.`);
  process.exit(1);
}
await loadSample(store, new Date());
console.log(`Sample data loaded into ${table}.`);
