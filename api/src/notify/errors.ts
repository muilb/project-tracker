// Delivery failures that retrying cannot fix (URL gone, bot removed from the group).

/** Thrown by a driver when the destination refuses for good: the message is not queued for a retry. */
export class PermanentDeliveryError extends Error {}

export const isPermanent = (e: unknown) => e instanceof PermanentDeliveryError;

/**
 * Removes secrets from an error before it is stored or shown: Telegram bot tokens
 * (they are part of the API URL) and the query string of any URL (webhook signatures).
 */
export function scrubError(text: string): string {
  return text
    .replace(/\bbot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot***')
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g, '***')
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1?…');
}
