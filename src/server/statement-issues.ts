// Decides which statements are labelled "Needs checking" (failed self-checks stored in Statement.issues).

/** True when the statement has at least one non-blank failed check; null means it passed. */
export function needsChecking(st: { issues: string | null | undefined }): boolean {
  return typeof st.issues === "string" && st.issues.trim() !== "";
}

/** Number of statements labelled "Needs checking". */
export function countNeedsChecking(statements: ReadonlyArray<{ issues: string | null | undefined }>): number {
  return statements.filter(needsChecking).length;
}

/** The clause the Statements subtitle appends: "" when n <= 0, ", 1 needs checking", ", 2 need checking". */
export function needsCheckingClause(n: number): string {
  if (n <= 0) return "";
  return `, ${n} ${n === 1 ? "needs" : "need"} checking`;
}
