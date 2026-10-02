# Sample data

`npm run setup` creates 48 monthly statement PDFs and loads them into a demo account. They exist so
the app can be tried, tested and demonstrated without anyone's real bank data.

## What it is

| Fact | Value |
|---|---|
| Who | A fictional university student in Singapore |
| Period | January 2067 to December 2070 (the dates are deliberately in the future) |
| Statements | 48 |
| Transactions | 4,025 |
| Layout | Laid out like a DBS consolidated statement so the built-in reader can be exercised |
| Marking | Every page is headed "SYNTHETIC SAMPLE - NOT A REAL BANK STATEMENT" |

Every name, stall, company and amount is invented. Any resemblance to real people or payments is
coincidental. These files are not bank documents and must not be presented as such.

## How it is generated

Code: `scripts/sample-2067.ts` (first year), `scripts/sample-uni.ts` (all four years),
`scripts/gen-sample-2067.ts` (writes the PDFs), `scripts/load-demo-2067.ts` (loads them through the
same code path as a real upload).

The generator uses a fixed random seed, so it produces exactly the same statements on every computer.
That is what lets the tests and this documentation quote exact figures.

The four years are written to look like a real student's money, with things for the app to find:

| Pattern in the data | What it exercises |
|---|---|
| Daily small PayNow payments to the same few stall owners | The Review list and teach-once rules |
| A one-off laptop purchase, a phone purchase | Large-payment alerts, the "biggest month" question |
| An internship salary for three months in 2069 | Income sources in the money flow |
| Subscriptions, one with a price rise, one that stops | Subscription and price-change detection |
| Heavier spending in some months, lighter in others | The calendar, the Compare and Pattern views |
| Rent appearing in the last month | New-merchant alert |

## Using it

- Press **Fast access** on the landing page, or log in as `demo@dwfinance.local` / `Password123!`.
- The PDFs are written to `public/sample-statements/<year>/`. You can upload one into a new account to
  see the upload flow.
- `npm run setup` resets the demo account to this data at any time. It does not touch other accounts.
