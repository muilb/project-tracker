// Security headers of the web app: CloudFront sends them in production (stack.ts), `vite preview`
// sends the same ones in the end-to-end tests, so a page that breaks the policy fails there first.

/**
 * Content-Security-Policy. The app only runs its own scripts and styles and only talks to its own
 * origin plus `connect` (the API and Cognito in production; the tests proxy the API through '/api').
 * React sets inline styles through the DOM, which CSP allows; the favicon is a data: URI.
 */
export function contentSecurityPolicy(connect: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${["'self'", ...connect].join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Only the microphone (voice input on the AI page) may be used. */
export const PERMISSIONS_POLICY = 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()';

export const REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** HSTS: two years. */
export const HSTS_SECONDS = 2 * 365 * 24 * 3600;

/** The headers as `vite preview` sends them (CloudFront sets the same through a ResponseHeadersPolicy). */
export function securityHeaders(connect: string[]): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(connect),
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Referrer-Policy': REFERRER_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}
