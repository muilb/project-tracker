# project-tracker

Project tracking system replacing an Excel sheet. Serverless on AWS. UI text and API error messages are in Vietnamese and Japanese (Vietnamese is the default); code, identifiers and comments are in English.

## Layout
- `api/` — single Lambda (Hono). `src/app.ts` wires routes; `src/rules.ts` holds the business rules ported from the Excel (health aggregation, update frequency, lateness, urgency); `src/views.ts` builds dashboard / public read models; `src/store/` has `Store` with `DynamoStore` (single table, pk/sk) and `MemoryStore` (tests, local dev); `src/seed/sample.ts` is the Excel sample data. `src/notify/` holds alerts: `message.ts` (channel-neutral message), `pipeline.ts` (`emit` from the routes, `runHourly` / `flushDue` used by the `src/cron.ts` Lambdas), `events.ts` (event types, hourly scan), `routeChannels.ts` / `routePersonal.ts` (who receives what), `policy.ts` (quiet hours, digest time, pauses), `render.ts` (messages), `samples.ts` (test previews), `deliver.ts` (send, delivery log, outbox), `personal.ts` (personal defaults), `sender.ts` (dispatch per channel kind), `teams.ts` (Adaptive Card, URL allow-list/masking), `telegram.ts` (system bot client, HTML rendering, inline buttons, webhook calls), `push.ts` (Web Push: VAPID keys, payload, send to one device). `src/bot/` is the two-way bot behind `POST /telegram/webhook` (`src/routes/telegram.ts`): `webhook.ts` (update dispatch, rate limits, bot removed / group migrated), `codes.ts` (connect codes captured by the webhook; `getUpdates` for bots without one), `who.ts` (linked person / group channel of a chat), `commands.ts` (/mine, /status, /late, /help), `actions.ts` (buttons), `notes.ts` (AI notes with Confirm / Cancel). `src/projectOps.ts` holds the project / update / item writes shared by the REST routes and the bot. `src/routes/me.ts` is the person's own notification settings and inbox; `src/routes/push.ts` their Web Push devices (`/me/push/*`). `src/ai/` holds natural-language entry: `assistant.ts` (Claude API client, prompt, output schema), `proposals.ts` (prompt context, validation of proposals; nothing is written — the web posts confirmed proposals to the normal endpoints), `ask.ts` (read-only Q&A: data context and prompt for `POST /ai/ask`). Tests inject a fake `send` / `telegram` / `ai` / `push`; `npm run dev` prints messages (Web Push payloads too) and fakes Telegram (set `LOCAL_SEND=1` to really send) and fakes the AI (set `ANTHROPIC_API_KEY` to call Claude).
- `web/` — React + Vite SPA. Talks to the Cognito JSON API directly (`src/auth.ts`, no Amplify); reads `/config.json` (written by CDK) in production; in dev uses the `/api` proxy to :3001 and `x-dev-user` auth. Response types are imported from the API code (`src/types.ts`). Status colors always come with an icon + text label. `public/sw.js` is the Web Push service worker (no fetch handler, nothing cached); `public/manifest.webmanifest` + `public/icons/` make it installable (needed for push on iOS).
- `infra/` — AWS CDK stack (`lib/stack.ts`). `bootstrap/github-oidc.yaml` creates the GitHub Actions deploy role.
- `docs/DESIGN.md` — design, rules, API list, roadmap. Update it when behavior changes.
- `web/src/pages/Help.tsx` / `HelpJa.tsx` — user manual (public `/help`, Vietnamese / Japanese). Update both when UI labels or behavior change.

## Commands (run from repo root)
- `npm test` — vitest for api (must pass)
- `npm run typecheck` — tsc for all workspaces
- `npm run synth` — CDK synth (no AWS credentials needed)
- `npm run dev` — local API on :3001 with in-memory sample data; auth via `x-dev-user: <email>` header
- `npm run dev:web` — web on :5173 (needs `npm run dev` running)
- `npm run build` — builds `web/dist`, which `cdk deploy` uploads

## Conventions
- Languages: every user-visible string is written as `l('Tiếng Việt', '日本語')` — `web/src/i18n.ts` on the web (choice in localStorage, switching reloads the page), `api/src/i18n.ts` in the API (request language from `Accept-Language` via AsyncLocalStorage; zod messages must use `msg()` / `{ error: () => … }` so they are evaluated per request). Alerts are built inside `withLang(channel.lang, …)` (personal ones in the person's `NotifyPrefs.lang`). User-entered data is never translated.
- Auth: Cognito only authenticates; roles (PL/GL/PMO/SUBMNG/MNG/OTHER/ADMIN) are stored in DynamoDB. Permission checks live in `api/src/auth.ts` (`can.*`); `can.system` (ADMIN only) guards secrets and granting ADMIN. Administrative changes are recorded with `audit()` (`src/audit.ts`).
- `GET /public`, `GET /health` and `POST /telegram/webhook` are the only unauthenticated routes; the public payload must never include customers, people, needHelp or issue text — `test/rules.test.ts` checks this. The webhook rejects any request without the bot's `X-Telegram-Bot-Api-Secret-Token` (constant-time compare, before reading the body), always answers without data, and acts only as the person / channel linked to the chat (`test/notify-g.test.ts`).
- Dates for items are `YYYY-MM-DD`; "today" is Vietnam time (`src/time.ts`). Timestamps are ISO UTC.
- Repo is public: never commit credentials, webhook URLs or real personal data.
- Channel webhook URLs are secrets: the API returns only `webhookUrlMasked` (never any part of the query string).
- The Telegram bot token and webhook secret are secrets: stored only in `CONFIG/TELEGRAM`, never returned by any endpoint or logged; chat ids are never logged in clear.
- The Claude API key is a secret: stored only in `CONFIG/AI`, never returned by any endpoint.
- The Web Push VAPID private key is a secret: stored only in `CONFIG/PUSH`, never returned by any endpoint (`GET /me/push/key` returns only the public key). Push subscription endpoints / keys are never returned either.
- Deploy happens only from GitHub Actions on `main` (`.github/workflows/deploy.yml`).
