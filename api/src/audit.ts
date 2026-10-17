// Administrative log: account and secret changes, deletes and restores. Read by ADMIN in Settings.
import { randomUUID } from 'node:crypto';
import type { Store } from './store/store.js';
import type { AuditAction } from './types.js';

/** Records one entry; a failure is logged and never fails the change itself. */
export async function audit(store: Store, now: Date, actor: string, action: AuditAction, target?: string, detail?: string) {
  try {
    await store.addAudit({ id: randomUUID().slice(0, 8), at: now.toISOString(), actor, action, target, detail });
  } catch (e) {
    console.error('audit failed', e);
  }
}
