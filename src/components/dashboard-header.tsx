import Link from "next/link";
import { formatCents } from "@/lib/money";
import { PeriodPicker } from "@/components/period-picker";
import "@/styles/dashboard-header.css";

type Props = {
  rangeLabel: string; txnCount: number; monthsList: string[]; from: string; to: string;
  incomeCents: number; spendCents: number; paynowPeopleCents: number; needsReview: number;
};

// The one flat red block: period picker, three equal totals, PayNow/review line, decorative art.
export function DashboardHeader({ rangeLabel, txnCount, monthsList, from, to, incomeCents, spendCents, paynowPeopleCents, needsReview }: Props) {
  const saved = incomeCents - spendCents;
  const figures = [
    { label: "Money in", cents: incomeCents },
    { label: "Money out", cents: spendCents },
    { label: saved < 0 ? "Overspent" : "Saved", cents: Math.abs(saved) },
  ];
  return (
    <section className="dash-header" aria-label="Summary">
      <div className="dash-header-top">
        <span className="dash-header-meta">{txnCount} transactions · {rangeLabel}</span>
        <PeriodPicker months={monthsList} from={from} to={to} />
      </div>
      <dl className="dash-header-figures">
        {figures.map((f) => (
          <div key={f.label} className="dash-header-figure">
            <dt>{f.label}</dt>
            <dd className="num-hero">{formatCents(f.cents)}</dd>
          </div>
        ))}
      </dl>
      <p className="dash-header-foot">
        {formatCents(paynowPeopleCents)} went to people via PayNow
        {needsReview > 0 && (
          <> · <Link className="dash-header-link" href="/dashboard/review">{needsReview} need review</Link></>
        )}
      </p>
      {/* Decorative only; with alt="" a missing file renders nothing, so the block still reads complete. */}
      <div className="dash-header-art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative PNG, no optimisation needed */}
        <img className="art-stash" src="/art/stash.png" alt="" width={190} height={190} />
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative PNG, no optimisation needed */}
        <img className="art-coin art-coin-a" src="/art/coin.png" alt="" width={56} height={56} />
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative PNG, no optimisation needed */}
        <img className="art-coin art-coin-b" src="/art/coin.png" alt="" width={40} height={40} />
      </div>
    </section>
  );
}
