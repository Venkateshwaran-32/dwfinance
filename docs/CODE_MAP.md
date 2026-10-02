# Code map

A Next.js (App Router) app in TypeScript, with a SQLite database through Prisma. Everything runs on one
computer.

## Folders

| Path | What is in it |
|---|---|
| `src/app/` | Pages and routes. `page.tsx` is the landing page; `dashboard/` holds the signed-in pages; `api/` holds the routes for upload, chat, export and status. |
| `src/app/actions.ts` | Server actions: sign up, log in, log out, confirm a review item, delete a statement |
| `src/components/` | The pieces of each screen: header, charts, money flow, calendar, chat panel, statement filters |
| `src/server/` | The logic. Runs only on the server. See the table below. |
| `src/lib/` | Small shared helpers: money formatting, auth, database client, category colours, chat history |
| `src/styles/` | Component styles. Shared tokens are in `src/app/globals.css`. |
| `prisma/schema.prisma` | The data model |
| `scripts/` | Setup, the launcher, and the synthetic statement generator |
| `tests/unit/` | Automated tests (run with `npm test`) |

## `src/server/`

| File | Job |
|---|---|
| `parse-statement.ts` | Checks the PDF and extracts its text |
| `parse-dbs.ts` | The DBS/POSB reader |
| `merchants.ts` | Cleans payee names; the Singapore merchant keyword rules |
| `categorize.ts` | The category ladder; the AI path for other banks |
| `rules.ts` | Teach-once rules: preview and apply |
| `statement-search.ts` | Search syntax and filters for the Statements page and CSV export |
| `subscriptions.ts`, `alerts.ts`, `insights.ts`, `financial-health.ts`, `peer-analytics.ts` | The dashboard findings |
| `llm.ts` | Talks to LM Studio; the lookup loop |
| `chat-tools.ts` | The five lookups and the instructions given to the model |
| `chat-guard.ts` | The guard rails |

## Data model

| Table | Holds |
|---|---|
| `User` | Email and hashed password |
| `Statement` | One per uploaded PDF: its period and a fingerprint of the file |
| `Transaction` | Date, description, payee, amount in cents (negative is spending), category, whether it needs review, and where the category came from (`rule`, `ai`, `fallback`, `user`) |
| `MerchantRule` | A payee you have confirmed, and its category |
| `UploadJob` | Progress of an upload, so a slow one survives a page refresh |

Deleting a statement removes its transactions. Your saved rules are kept.

## Common changes

| To do this | Change this |
|---|---|
| Add a merchant keyword | Add it to the right line of `RULES` in `src/server/merchants.ts`, and add a case to `tests/unit/merchants.test.ts` |
| Add a category | Add it to `CATEGORIES` in `src/server/categorize.ts` and give it a colour in `src/lib/category-colors.ts` |
| Support another bank without AI | Write a reader like `src/server/parse-dbs.ts` that returns rows, and call it in `src/app/api/upload/route.ts` before the AI fallback |
| Add a lookup for the chat | Add it to `chatTools` and `runTool` in `src/server/chat-tools.ts`, with a test in `tests/unit/chat-tools.test.ts` |
| Change the model server address | Set `LMSTUDIO_BASE_URL` in `.env` |

## Checks

    npm test            automated tests
    npm run typecheck   TypeScript
    npm run lint        ESLint
    npm run build       production build

Note for anyone using an AI coding tool on this code: this is Next.js 16, which differs from older
versions. See `AGENTS.md`.
