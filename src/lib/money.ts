// Money is stored as signed integer cents everywhere; format only at the edge.
export function formatCents(cents: number): string {
  const sgd = cents / 100;
  // en-SG prints SGD as a bare "$"; the app always shows "S$" so amounts are unambiguous.
  return new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(sgd).replace("$", "S$");
}

export function parseAmountToCents(raw: string): number {
  // "1,234.50" | "-3.30" | "(3.30)" -> signed cents
  const neg = /^\(.*\)$/.test(raw.trim()) || raw.trim().startsWith("-");
  const n = Number(raw.replace(/[(),\s$]/g, "").replace(/^-/, ""));
  if (!Number.isFinite(n)) return 0;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}
