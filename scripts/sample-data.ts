// Synthetic DBS-statement transactions. Shared by gen-statement.ts (→PDF) and seed.ts (→DB).
// Includes the PayNow-to-individual pattern DBS can't categorize. Amounts are signed cents.
export type SeedRow = {
  date: string; description: string; counterparty: string | null; amountCents: number;
  category: string; needsReview: boolean;
};

function row(date: string, description: string, counterparty: string | null, sgd: number, category: string, needsReview = false): SeedRow {
  return { date, description, counterparty, amountCents: Math.round(sgd * 100), category, needsReview };
}

export function genRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  // income
  rows.push(row("2026-04-25", "GIRO SALARY", "ACME PTE LTD", 5200, "Income"));
  rows.push(row("2026-05-25", "GIRO SALARY", "ACME PTE LTD", 5200, "Income"));
  // recurring merchants (rule-categorized)
  for (const [d, amt] of [["2026-04-03", -86.4], ["2026-04-17", -73.2], ["2026-05-02", -91.1], ["2026-05-19", -64.8]] as [string, number][])
    rows.push(row(d, "NTUC FAIRPRICE", "NTUC FAIRPRICE", amt, "Groceries"));
  for (const [d, amt] of [["2026-04-05", -12.5], ["2026-04-22", -9.8], ["2026-05-08", -15.2], ["2026-05-21", -11.0]] as [string, number][])
    rows.push(row(d, "GRAB RIDE", "GRAB", amt, "Transport"));
  rows.push(row("2026-04-10", "SP GROUP UTILITIES", "SP GROUP", -142.3, "Utilities"));
  rows.push(row("2026-05-10", "SP GROUP UTILITIES", "SP GROUP", -138.9, "Utilities"));
  rows.push(row("2026-04-15", "SINGTEL MOBILE", "SINGTEL", -42.0, "Telecom"));
  rows.push(row("2026-05-15", "SINGTEL MOBILE", "SINGTEL", -42.0, "Telecom"));
  rows.push(row("2026-04-12", "FOODPANDA ORDER", "FOODPANDA", -28.6, "Food & Dining"));
  rows.push(row("2026-05-06", "SHOPEE PURCHASE", "SHOPEE", -54.9, "Shopping"));
  rows.push(row("2026-04-08", "NETFLIX", "NETFLIX", -19.98, "Subscriptions"));
  rows.push(row("2026-05-08", "NETFLIX", "NETFLIX", -19.98, "Subscriptions"));
  // the wedge: PayNow to a named individual, recurring small weekday amount -> needs review
  const breakfastDays = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-13", "2026-05-04", "2026-05-05", "2026-05-06"];
  for (const d of breakfastDays) rows.push(row(d, "PAYNOW TRANSFER", "Tan Wei Jie", -3.3, "Food & Dining", true));
  rows.push(row("2026-04-20", "PAYNOW TRANSFER", "Siti Rahimah", -45.0, "Transfers", true));
  rows.push(row("2026-05-12", "PAYNOW TRANSFER", "Wei Jie", -22.0, "Transfers", true));
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
