// Microsoft Teams delivery through a Workflows "post to a channel when a webhook request is received" URL.
import { l } from '../i18n.js';
import { PermanentDeliveryError } from './errors.js';
import type { Message } from './message.js';

/** Hosts used by Teams Workflows (Power Automate). */
const ALLOWED_HOST_SUFFIXES = ['.logic.azure.com', '.powerplatform.com'];
/** Office 365 connectors (incoming webhooks), retired by Microsoft: no new URLs, existing channels get a warning. */
const LEGACY_HOST_SUFFIX = '.webhook.office.com';

export function isLegacyTeamsUrl(raw: string): boolean {
  try {
    return new URL(raw).hostname.endsWith(LEGACY_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function isTeamsWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ALLOWED_HOST_SUFFIXES.some((s) => url.hostname.endsWith(s));
  } catch {
    return false;
  }
}

/**
 * "https://prod-12.southeastasia.logic.azure.com/workflows/3f2a…" — enough to recognise the flow.
 * The signature lives in the query string, so no part of it is ever shown.
 */
export function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname}${url.pathname.slice(0, 16)}…`;
  } catch {
    return '…';
  }
}

export async function postTeams(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    const message = `${l('Teams trả về', 'Teams の応答:')} HTTP ${res.status}${text ? `: ${text}` : ''}`;
    if (res.status === 404 || res.status === 410)
      throw new PermanentDeliveryError(
        `${message} — ${l('URL webhook không còn (Workflow đã bị xoá hoặc tắt). Tạo Workflow mới rồi dán URL mới.', 'Webhook URL は無効です（Workflow が削除または無効化されました）。新しい Workflow を作成し、URL を貼り付けてください。')}`,
      );
    // Other 4xx (bad request, forbidden) do not get better by retrying; 408, 429 and 5xx do.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new PermanentDeliveryError(message);
    throw new Error(message);
  }
}

/** Wraps an Adaptive Card in the message envelope that Teams Workflows expects. */
export function adaptiveCard({ title, tone = 'default', lines, link }: Message) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body: [
            { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true, color: tone },
            ...lines.map((l) => ({
              type: 'TextBlock',
              text: l.text,
              wrap: true,
              spacing: 'Small',
              color: l.tone ?? 'default',
              isSubtle: l.subtle ?? false,
            })),
          ],
          ...(link ? { actions: [{ type: 'Action.OpenUrl', title: link.title, url: link.url }] } : {}),
        },
      },
    ],
  };
}
