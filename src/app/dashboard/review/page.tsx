import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { recategorizeAction } from "@/app/actions";
import { confirmPayeeAction } from "@/app/review-actions";
import { CATEGORIES } from "@/server/categorize";
import { groupReviewItems, parseShow, PAGE_SIZE, type ReviewGroup } from "@/lib/review-groups";
import "@/styles/review.css";

export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-SG")} ${n === 1 ? one : many}`;

function amountText(g: ReviewGroup): string {
  if (g.count === 1) return formatCents(g.lowCents);
  if (g.lowCents === g.highCents) return `always ${formatCents(g.lowCents)}`;
  return `usually ${formatCents(g.lowCents)} to ${formatCents(g.highCents)}`;
}

function dateText(g: ReviewGroup): string {
  const a = day.format(g.firstDate);
  const b = day.format(g.lastDate);
  return a === b ? a : `${a} to ${b}`;
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const [rows, sp] = await Promise.all([
    db.transaction.findMany({
      where: { userId, needsReview: true },
      select: { id: true, date: true, description: true, counterparty: true, amountCents: true, category: true },
    }),
    searchParams,
  ]);
  const groups = groupReviewItems(rows);
  const show = parseShow(sp.show, groups.length);
  const visible = groups.slice(0, show);

  return (
    <section className="review">
      <div className="review-head">
        <h1>Review</h1>
        <form action={recategorizeAction} className="review-rerun">
          <button className="btn" type="submit" style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--border)" }}>
            Re-run auto-categorize
          </button>
        </form>
      </div>
      {groups.length > 0 && (
        <p className="review-summary">
          <strong>{plural(groups.length, "payee", "payees")}, {plural(rows.length, "payment", "payments")} to check</strong>
        </p>
      )}
      <p className="review-lede">
        Pick a category once per payee. It is saved as a rule and applied to every payment to that payee, past and future.
      </p>

      {groups.length === 0 ? (
        <div className="card card-pad">
          <h2 className="card-title">Nothing to review</h2>
          <p className="card-sub">Every payment has a category.</p>
        </div>
      ) : (
        <ol className="review-list">
          {visible.map((g) => (
            <li key={g.matchKey} className="card card-pad review-group">
              <div className="review-who">
                <h2 className="card-title review-payee" title={g.payee}>{g.payee}</h2>
                <p className="card-sub">
                  {plural(g.count, "payment", "payments")}{g.flow === "in" ? " in" : ""}, {amountText(g)}
                </p>
                <p className="card-sub">{dateText(g)}</p>
              </div>
              <form action={confirmPayeeAction} className="review-form">
                <input type="hidden" name="matchKey" value={g.matchKey} />
                <label className="review-label">
                  <span>Category</span>
                  <select className="input" name="category" defaultValue={g.category}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <button className="btn" type="submit" disabled={!g.matchKey} aria-label={`Confirm category for all ${plural(g.count, "payment", "payments")} to ${g.payee}`}>
                  Confirm
                </button>
              </form>
              <details className="review-more">
                <summary>{g.count === 1 ? "See the payment" : `See the last ${Math.min(g.count, g.recent.length)} payments`}</summary>
                <ul className="review-recent">
                  {g.recent.map((t) => (
                    <li key={t.id}>
                      <span className="review-date">{day.format(t.date)}</span>
                      <span className="review-desc" title={t.description}>{t.description}</span>
                      <span className={t.amountCents > 0 ? "review-amt in" : "review-amt"}>
                        {t.amountCents > 0 ? "+" : "-"}{formatCents(Math.abs(t.amountCents))}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      )}

      {groups.length > visible.length && (
        <div className="review-pager">
          <p>Showing the {visible.length} biggest of {plural(groups.length, "payee", "payees")}.</p>
          <Link className="btn ghost" href={`/dashboard/review?show=${show + PAGE_SIZE}`} scroll={false}>Show more</Link>
        </div>
      )}
    </section>
  );
}
