import type { Store } from '../store/store.js';
import type { PushSender } from './push.js';
import type { Sender } from './sender.js';

export interface NotifyDeps {
  store: Store;
  send: Sender;
  /** Base URL of the web app, used for "open project" links. */
  webUrl?: string;
  // track H: Web Push to browsers / phones (default: the web-push library; tests pass a fake).
  push?: PushSender;
}
