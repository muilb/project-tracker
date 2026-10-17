import type { Store } from '../store/store.js';
import type { Sender } from './sender.js';

export interface NotifyDeps {
  store: Store;
  send: Sender;
  /** Base URL of the web app, used for "open project" links. */
  webUrl?: string;
}
