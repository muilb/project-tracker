# project-tracker

Project tracking system replacing an Excel sheet. Serverless on AWS. UI text and API error messages are in Vietnamese; code, identifiers and comments are in English.

## Layout
- `api/` — single Lambda (Hono). `src/app.ts` wires routes; `src/rules.ts` holds the business rules ported from the Excel (health aggregation, update frequency, lateness, urgency); `src/views.ts` builds dashboard / public read models; `src/store/` has `Store` with `DynamoStore` (single table, pk/sk) and `MemoryStore` (tests, local dev); `src/seed/sample.ts` is the Excel sample data. `src/notify/` holds Teams delivery (`teams.ts`: Adaptive Card, URL allow-list/masking) and alert logic (`alerts.ts`: immediate alerts from the routes, `runHourly` used by the `src/cron.ts` Lambda). Tests inject a fake `send`; `npm run dev` prints Teams messages instead of sending (set `LOCAL_SEND_TEAMS=1` to really send).
- `web/` — React + Vite SPA. Talks to the Cognito JSON API directly (`src/auth.ts`, no Amplify); reads `/config.json` (written by CDK) in production; in dev uses the `/api` proxy to :3001 and `x-dev-user` auth. Response types are imported from the API code (`src/types.ts`). Status colors always come with an icon + text label.
- `infra/` — AWS CDK stack (`lib/stack.ts`). `bootstrap/github-oidc.yaml` creates the GitHub Actions deploy role.
- `docs/DESIGN.md` — design, rules, API list, roadmap. Update it when behavior changes.

## Commands (run from repo root)
- `npm test` — vitest for api (must pass)
- `npm run typecheck` — tsc for all workspaces
- `npm run synth` — CDK synth (no AWS credentials needed)
- `npm run dev` — local API on :3001 with in-memory sample data; auth via `x-dev-user: <email>` header
- `npm run dev:web` — web on :5173 (needs `npm run dev` running)
- `npm run build` — builds `web/dist`, which `cdk deploy` uploads

## Conventions
- Auth: Cognito only authenticates; roles (PL/GL/PMO/SUBMNG/MNG/OTHER) are stored in DynamoDB. Permission checks live in `api/src/auth.ts` (`can.*`).
- `GET /public` and `GET /health` are the only unauthenticated routes; the public payload must never include customers, people, needHelp or issue text — `test/rules.test.ts` checks this.
- Dates for items are `YYYY-MM-DD`; "today" is Vietnam time (`src/time.ts`). Timestamps are ISO UTC.
- Repo is public: never commit credentials, webhook URLs or real personal data.
- Channel webhook URLs are secrets: the API returns only `webhookUrlMasked` (never any part of the query string).
- Deploy happens only from GitHub Actions on `main` (`.github/workflows/deploy.yml`).
