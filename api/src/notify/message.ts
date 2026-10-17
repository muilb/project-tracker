// Channel-independent alert message; rendered as an Adaptive Card (Teams), HTML (Telegram) or Block Kit (Slack).
export type Tone = 'attention' | 'warning' | 'good' | 'default';

export interface MessageLine {
  text: string; // may contain **bold**
  tone?: Tone;
  subtle?: boolean;
  /**
   * The line for channels with detail = 'compact': the same facts without user-entered text,
   * or true when `text` has none. Lines without it are dropped (see render.compact).
   */
  compact?: string | true;
}

export interface Message {
  title: string;
  tone?: Tone;
  lines: MessageLine[];
  link?: { title: string; url: string };
  // track G
  /** Buttons under a personal Telegram message (other channels ignore them). */
  actions?: MessageAction[];
}

/** An inline button; `data` (≤ 64 bytes) comes back to the webhook as a callback_query. */
export interface MessageAction {
  label: string;
  data: string;
}
