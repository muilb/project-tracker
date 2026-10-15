// Channel-independent alert message; rendered as an Adaptive Card (Teams) or HTML (Telegram).
export type Tone = 'attention' | 'warning' | 'good' | 'default';

export interface MessageLine {
  text: string; // may contain **bold**
  tone?: Tone;
  subtle?: boolean;
}

export interface Message {
  title: string;
  tone?: Tone;
  lines: MessageLine[];
  link?: { title: string; url: string };
}
