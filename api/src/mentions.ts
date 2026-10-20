// Mentions in comment text: `@{<user id>}`, shown as @Name (comments.ts, notify/personal.ts, the web).
const MENTION = /@\{([^{}\s]{1,200})\}/g;

/** The people mentioned in `text`, once each, in order. */
export function mentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[1]))];
}

/** The text with every mention written as @Name. */
export function mentionText(text: string, name: (id: string) => string): string {
  return text.replace(MENTION, (_, id: string) => `@${name(id)}`);
}
