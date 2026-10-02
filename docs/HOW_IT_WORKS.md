# How it works

This page follows one statement from PDF to dashboard. File names point at the code that does each step.

```mermaid
flowchart TD
    A[Statement PDF] --> B[Check it is a real PDF, 10 MB or less]
    B --> C[Pull the text out with unpdf]
    C --> D{DBS or POSB layout?}
    D -- yes --> E[Built-in reader: amounts from the running balance]
    D -- no --> F[Local AI model reads the text in chunks]
    E --> G[Sort into categories]
    F --> G
    G --> H{Sure about it?}
    H -- yes --> I[Saved]
    H -- no --> J[Saved and added to the Review list]
    J --> K[You confirm once]
    K --> L[Rule saved, applied to past and future payments]
```

## 1. The file is checked

`src/server/parse-statement.ts`

- The file must start with the bytes `%PDF-`. The file type claimed by the browser is ignored.
- Anything over 10 MB is refused.
- A fingerprint (SHA-256) of the file is compared with earlier uploads, so the same statement is not added twice.

## 2. The text is pulled out

The [unpdf](https://github.com/unjs/unpdf) library extracts the text. If almost no text comes out, the
file is probably a scan or is password-protected, and the upload stops with a message saying so.

The PDF itself is not kept. Only the transactions found in it are stored.

## 3. Transactions are found

### DBS and POSB statements: the built-in reader

`src/server/parse-dbs.ts` (38 lines, no AI)

A DBS or POSB consolidated statement prints the running balance after every transaction. The reader uses
that instead of trusting the amount column:

    amount = balance after this line - balance before this line

This has two useful effects:

| Effect | Why |
|---|---|
| The sign is always right | A payment makes the balance go down, a deposit makes it go up. There is no need to guess from which column a number sits in. |
| The statement checks itself | The last balance the reader arrives at should equal the total printed on the statement. If they match, no line was missed or misread. |

The result of that final check is currently written to the server log only; it is not shown on screen.
The automated tests assert it for all 48 sample statements.

### Other banks: the local AI model

`aiExtractStatement` in `src/server/categorize.ts`

If the built-in reader finds nothing, the text is cut into overlapping chunks and each chunk is given to
the local model with a strict output format. Duplicates from the overlaps are removed. This path is slow
(minutes, not seconds), needs LM Studio running, and can make mistakes. Treat its results as a draft.

## 4. Each transaction is sorted into a category

`src/server/categorize.ts`, `src/server/merchants.ts`

The categories are: Groceries, Transport, Food & Dining, Utilities, Telecom, Shopping, Subscriptions,
Health, Income, Cash, Transfers, Other.

For a DBS or POSB statement the steps are tried in this order, and the first one that answers wins:

| Step | What it does | Marked for review? |
|---|---|---|
| 1. Your saved rules | If you have confirmed this payee before, your answer is used | No |
| 2. Singapore merchant rules | A list of keywords: NTUC and Sheng Siong are Groceries, Grab and BUS/MRT are Transport, Netflix is Subscriptions, and so on | No |
| 3. Best guess | A PayNow or NETS QR payment to a named person or small stall of S$20 or less is guessed as Food & Dining, a larger one as Transfers. Money coming in is guessed as Income. Everything else is Other. | Yes |

No AI is used on this path, so a DBS or POSB statement is sorted the same way every time.

For statements read by the AI model, a fourth step sits between 2 and 3: the model is asked to categorise
only the rows the rules could not.

### Why payments to people are the hard part

A bank statement shows a PayNow payment as a transfer to a name. It cannot know that "ONG BEE LIAN" is
the drinks stall where you buy breakfast. Nothing in the statement can settle that, so the app does not
pretend to know: it makes a marked guess and asks you.

## 5. Teach it once

`src/server/rules.ts`

On the Review page (or through Ask AI) you confirm the category for a payee one time. That does two things:

1. Saves a rule for that payee.
2. Updates every existing transaction for that payee, and removes them from the Review list.

Every later upload checks saved rules first, so the same payee is never asked about again.

The payee is matched by a cleaned-up name: reference numbers, account numbers and bank boilerplate are
stripped out, so "PAYNOW TRANSFER 5992280 TO: ONG BEE LIAN" and "PAYNOW TRANSFER 2821666 TO: ONG BEE LIAN"
are recognised as the same payee.

## 6. The dashboard is worked out from the transactions

Nothing on the dashboard is stored separately. Each section is calculated from the transactions in the
period you picked:

| Section | Code |
|---|---|
| Where it went, monthly spend | `src/app/dashboard/page.tsx`, `src/components/dashboard-charts.tsx` |
| Money flow | `src/lib/cashflow.ts` |
| Subscriptions and price changes | `src/server/subscriptions.ts` |
| Alerts (large, duplicate, new merchant, spikes) | `src/server/alerts.ts` |
| Insights ticker | `src/server/insights.ts` |
| Financial health | `src/server/financial-health.ts` |
| People you pay and are paid by | `src/server/peer-analytics.ts` |

Money is stored as whole cents (integers), never as decimals, so totals do not drift.
