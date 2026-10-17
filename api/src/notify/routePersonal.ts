// Which people get a personal message (inbox, personal Telegram). Track A fills this in.
import type { ProjectView } from '../rules.js';
import type { Snapshot } from '../store/store.js';
import type { NotifyDeps } from './deps.js';
import type { Outgoing } from './deliver.js';
import type { NotifyEvent } from './events.js';
import type { RouteContext } from './routeChannels.js';

/** Personal messages for one saved change. */
export async function personalMessages(_deps: NotifyDeps, _event: NotifyEvent, _now: Date, _ctx: RouteContext): Promise<Outgoing[]> {
  return [];
}

/** Personal time-based messages from the hourly run. */
export async function hourlyPersonalMessages(
  _deps: NotifyDeps,
  _snap: Snapshot,
  _views: ProjectView[],
  _now: Date,
  _ctx: RouteContext,
): Promise<Outgoing[]> {
  return [];
}
