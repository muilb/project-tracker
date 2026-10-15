import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { Accounts } from './accounts.js';
import type { NotifyDeps } from './notify/alerts.js';
import type { Store } from './store/store.js';
import type { Role, User } from './types.js';

export type AppEnv = {
  Bindings: { event?: APIGatewayProxyEventV2WithJWTAuthorizer };
  Variables: { store: Store; now: Date; user: User; notify: NotifyDeps; accounts: Accounts; initialRoles: Map<string, Role> };
};
