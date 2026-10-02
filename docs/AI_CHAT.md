# The AI chat and its guard rails

Ask AI lets you ask about your spending in plain English. The model runs on your own computer through
[LM Studio](https://lmstudio.ai). This page explains what the model is allowed to do and what stops it
from going wrong.

## The main idea: the model looks things up, it does not remember

A language model is good at understanding a question and bad at arithmetic and recall. So the model
never sees your transactions directly and never adds anything up. It is given five lookups. It chooses
which to call; ordinary code runs the lookup against the database and hands back exact figures; the
model then puts those figures into a sentence.

| Lookup | What it returns |
|---|---|
| `get_overview` | Date range of the data, number of transactions, total in and out, totals per category |
| `spend_summary` | Totals grouped by category, payee, month or year, with the grand total |
| `find_transactions` | Matching transactions by text, category, date range or minimum amount, with the total of all matches stated first |
| `get_insights` | Ready-made findings: subscriptions, alerts, financial health, people paid and received, month highlights |
| `propose_payee_category` | Prepares (does not apply) a category change for one payee |

Code: `src/server/chat-tools.ts`, `src/server/llm.ts`

Every lookup is tied to the signed-in user by the server. The model cannot ask for another user's data
because the user is never one of the things it gets to choose.

Under each answer, "How I got this" shows the lookups that were made, and "See in bank statement" opens
the Statements page filtered to the rows behind the answer.

## The model cannot change your data

The only action the model has is `propose_payee_category`. It produces a card showing what would
change, how many payments are affected, and a sample of them. Nothing is written until you press
**Confirm**. Pressing Confirm calls a separate route (`src/app/api/chat/confirm/route.ts`) that
re-checks the request on the server and applies the same rule code the Review page uses.

## Guard rails

These run in ordinary code, not inside the model, so they behave the same whichever model is loaded.

Code: `src/server/chat-guard.ts`, `src/app/api/chat/route.ts`

| Order | Guard rail | What it does |
|---|---|---|
| 1 | Rate limit | 20 messages per 5 minutes per user. Beyond that, a "please wait" reply. |
| 2 | Input screen | Slurs, threats and sexual content are refused before the model sees them, including spaced-out and number-for-letter spellings. A message that mentions self-harm gets Singapore helpline numbers instead of a refusal. |
| 3 | History scrub | A blocked message, and the reply to it, are removed from the conversation the model is given. |
| 4 | One-at-a-time limit | At most two answers are generated at once. Others get "try again in a few seconds", so a burst of users cannot freeze the computer. |
| 5 | Scope rules | The model is instructed to answer only about the user's own money and this app, and to refuse general knowledge, advice on investments, tax or law, and anything about other people. |
| 6 | Made-up-number check | If an answer contains a money figure or a percentage but no lookup was made in that turn, the answer is thrown away and the model is forced to make a lookup. If it still has none, the reply is "I couldn't look that up just now, so I won't guess." |
| 7 | Output screen | The model's reply goes through the same abuse filter as the input. |

Other limits: a question can be at most 2,000 characters, the model sees at most the last 12 messages,
it may make at most 6 rounds of lookups per answer, and an answer is abandoned after 90 seconds. The
model runs at temperature 0, so the same question gives the same answer.

Payee names and descriptions come from PDFs, which means they could contain text written to trick a
model. The model is told to treat them as data and never as instructions, and it has no action that
could do harm even if it were tricked: the only change it can prepare still needs your Confirm.

## What was tested, and what went wrong

Tested on one Mac with the synthetic sample data, checking every answer against the database.

| Model | Size | Result |
|---|---|---|
| `qwen2.5-14b-instruct` | about 9 GB | Used for most testing. Answers in roughly 6 to 25 seconds. |
| `google/gemma-4-e4b` | about 6 GB | Six test questions correct after one fix (below). Answers in roughly 6 to 14 seconds. |

Problems found and how they were fixed:

| Problem | Fix |
|---|---|
| On a follow-up question the model invented figures from memory instead of looking them up | The made-up-number check (guard rail 6) |
| Asked "how much have I paid this payee in total", the smaller model added up only the ten rows it was shown and answered S$12.60 instead of S$3,019.50 | `find_transactions` now states the full totals in words before the rows |
| Asked "which month did I spend the most", the model mixed up the reasons from different months | Only the top month carries its biggest categories and biggest charge, so there is nothing else to mix in |
| The model guessed a category for a payee search and found nothing | A search that finds nothing in the guessed category is retried across all categories, with a note |

These are fixes for the cases that were found. A local model can still pick the wrong lookup or
misread a question. The guard rails make sure it cannot invent a number or change data by itself; they
do not make every answer right.

## Privacy

The only network call Ask AI makes is to LM Studio on the same computer (`127.0.0.1:1234`). Chat
history is saved in your browser's local storage, not in the database.
