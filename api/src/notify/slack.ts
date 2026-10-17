// Slack delivery through an Incoming Webhook (Slack App → Incoming Webhooks → pick a channel).
import { l } from '../i18n.js';
import { PermanentDeliveryError } from './errors.js';
import type { Message } from './message.js';

/** Slack Block Kit limits. */
export const MAX_BLOCKS = 50;
export const MAX_TEXT = 3000;
const MAX_HEADER = 150;
const MAX_BUTTON = 75;

/** Only "https://hooks.slack.com/services/T…/B…/secret". */
export function isSlackWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'hooks.slack.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      parts[0] === 'services' &&
      parts.length >= 4
    );
  } catch {
    return false;
  }
}

/** "https://hooks.slack.com/services/T0123ABCD/…" — the workspace only; the channel and secret parts are never shown. */
export function maskSlackUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const team = url.pathname.split('/').filter(Boolean)[1] ?? '';
    return `${url.protocol}//${url.hostname}/services/${team.slice(0, 12)}/…`;
  } catch {
    return '…';
  }
}

/** Slack treats & < > as control characters (links, @channel mentions). */
export const escapeSlack = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Our **bold** becomes Slack's *bold*. */
export const mrkdwn = (s: string) => escapeSlack(s).replace(/\*\*(.+?)\*\*/g, '*$1*');

const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Block = Record<string, unknown>;

/** Block Kit payload: header, lines (subtle ones as context), a link button, and a plain `text` for phone notifications. */
export function slackPayload({ title, lines, link }: Message) {
  const blocks: Block[] = [{ type: 'header', text: { type: 'plain_text', text: cut(plain(title), MAX_HEADER), emoji: true } }];

  // Consecutive lines of the same kind share one block, up to MAX_TEXT characters.
  let open: { subtle: boolean; text: string } | undefined;
  const body: { subtle: boolean; text: string }[] = [];
  for (const line of lines) {
    const text = cut(mrkdwn(line.text), MAX_TEXT);
    const subtle = !!line.subtle;
    if (open && open.subtle === subtle && open.text.length + 1 + text.length <= MAX_TEXT) open.text += `\n${text}`;
    else body.push((open = { subtle, text }));
  }

  const action: Block | undefined = link && {
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text: cut(link.title, MAX_BUTTON) }, url: link.url }],
  };
  const room = MAX_BLOCKS - blocks.length - (action ? 1 : 0);
  const shown = body.length > room ? [...body.slice(0, room - 1), { subtle: true, text: '…' }] : body;
  for (const b of shown)
    blocks.push(
      b.subtle
        ? { type: 'context', elements: [{ type: 'mrkdwn', text: b.text }] }
        : { type: 'section', text: { type: 'mrkdwn', text: b.text } },
    );
  if (action) blocks.push(action);

  const text = cut([plain(title), ...lines.map((x) => plain(x.text))].map(escapeSlack).join('\n'), MAX_TEXT);
  return { text, blocks };
}

export async function postSlack(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    // Slack answers with a short code such as "invalid_payload" or "no_service".
    const text = (await res.text().catch(() => '')).slice(0, 200);
    const message = `${l('Slack trả về', 'Slack の応答:')} HTTP ${res.status}${text ? `: ${text}` : ''}`;
    // track C: 404 no_service / 410 channel_is_archived / 403 … do not get better by retrying; 408, 429 and 5xx do.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      const gone = res.status === 404 || res.status === 410;
      throw new PermanentDeliveryError(
        gone
          ? `${message} — ${l('Webhook Slack không còn (app bị gỡ hoặc kênh đã lưu trữ). Tạo webhook mới rồi Sửa → dán URL mới.', 'Slack の Webhook は無効です（アプリの削除またはチャネルのアーカイブ）。新しい Webhook を作成し、編集 → URL を貼り付けてください。')}`
          : message,
      );
    }
    throw new Error(message);
  }
}
