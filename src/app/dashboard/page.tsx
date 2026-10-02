import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPayNowToPerson, cleanMerchant } from "@/server/merchants";
import { DashboardCharts } from "@/components/dashboard-charts";
import { CalendarHeatmap } from "@/components/calendar-heatmap";
import { RecurringPanel } from "@/components/recurring-panel";
import { computeInsights } from "@/server/insights";
import { InsightRail } from "@/components/insight-rail";
import { computeAlerts } from "@/server/alerts";
import { AlertsPanel } from "@/components/alerts-panel";
import { computeSubscriptions } from "@/server/subscriptions";
import { SubscriptionCard } from "@/components/subscription-card";
import { computePeers } from "@/server/peer-analytics";
import { PeerLedgerCard } from "@/components/peer-ledger-card";
import { computeHealth } from "@/server/financial-health";
import { FinancialHealthCard } from "@/components/financial-health-card";
import { buildMoneyFlow } from "@/lib/cashflow";
import { MoneyFlowChart } from "@/components/money-flow";
import { DashboardHeader } from "@/components/dashboard-header";
import "@/styles/dashboard-header.css";

export const dynamic = "force-dynamic";

function cadenceLabel(dates: Date[]): string {
  if (dates.length < 2) return "one-off";
  const s = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let gap = 0;
  for (let i = 1; i < s.length; i++) gap += (s[i].getTime() - s[i - 1].getTime()) / 86400000;
  gap /= s.length - 1;
  if (gap <= 2) return "daily"; if (gap <= 10) return "weekly"; if (gap <= 45) return "monthly"; return `~${Math.round(gap)}d`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ months?: string; from?: string; to?: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const allTxns = await db.transaction.findMany({ where: { userId }, orderBy: { date: "desc" } });

  if (allTxns.length === 0) {
    return (
      <section className="card card-pad dash-empty">
        <h1>No transactions yet</h1>
        <p>Upload a DBS/POSB statement PDF to see your spending categorized.</p>
        <Link className="btn" href="/dashboard/upload">Upload a statement</Link>
      </section>
    );
  }

  // Scope the WHOLE dashboard to one period (preset or any start/end month), so every section shows the same
  // window. ?from=YYYY-MM&to=YYYY-MM; the older ?months=N (last N months) still works.
  const sp = await searchParams;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthsPresent = [...new Set(allTxns.map((t) => t.date.toISOString().slice(0, 7)))].sort();
  const first = monthsPresent[0]!, last = monthsPresent[monthsPresent.length - 1]!;
  const lastN = Number(sp.months);
  const legacyFrom = Number.isFinite(lastN) && lastN >= 1 ? monthsPresent[Math.max(0, monthsPresent.length - Math.trunc(lastN))]! : first;
  const pick = (v: string | undefined, fallback: string) => (v && monthsPresent.includes(v) ? v : fallback);
  let from = pick(sp.from, legacyFrom), to = pick(sp.to, last);
  if (from > to) [from, to] = [to, from];
  const txns = allTxns.filter((t) => { const ym = t.date.toISOString().slice(0, 7); return ym >= from && ym <= to; });
  const ymLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const wholeYear = from.slice(0, 4) === to.slice(0, 4) && from === monthsPresent.find((m) => m.startsWith(from.slice(0, 4))) && to === [...monthsPresent].reverse().find((m) => m.startsWith(to.slice(0, 4)));
  const rangeLabel = from === first && to === last ? `All time · ${ymLabel(first)}–${ymLabel(last)}`
    : wholeYear && monthsPresent.some((m) => !m.startsWith(from.slice(0, 4))) ? `${from.slice(0, 4)} · ${ymLabel(from)}–${ymLabel(to)}`
    : from === to ? ymLabel(from) : `${ymLabel(from)}–${ymLabel(to)}`;

  if (txns.length === 0) {
    return (
      <section className="card card-pad dash-empty">
        <h2 className="card-title">No transactions in this period</h2>
        <p>Nothing between {ymLabel(from)} and {ymLabel(to)}. You have {allTxns.length} transactions across {monthsPresent.length} months.</p>
        <Link className="btn" href="/dashboard">Show all time</Link>
      </section>
    );
  }

  const byCat = new Map<string, number>(), byDay = new Map<string, number>(), byMonth = new Map<string, number>();
  const catMerch = new Map<string, Map<string, { cents: number; count: number }>>();
  const occ = new Map<string, { count: number; total: number; dates: Date[]; category: string; instances: { date: string; cents: number }[] }>();
  let spend = 0, income = 0, paynowTotal = 0;
  for (const t of txns) {
    const name = cleanMerchant(t.description, t.counterparty) || t.counterparty || t.description;
    if (t.amountCents < 0) {
      const v = -t.amountCents; spend += v;
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + v);
      const day = t.date.toISOString().slice(0, 10); byDay.set(day, (byDay.get(day) ?? 0) + v);
      const mon = day.slice(0, 7); byMonth.set(mon, (byMonth.get(mon) ?? 0) + v);
      let cm = catMerch.get(t.category); if (!cm) { cm = new Map(); catMerch.set(t.category, cm); }
      const ce = cm.get(name) ?? { cents: 0, count: 0 }; ce.cents += v; ce.count++; cm.set(name, ce);
      const e = occ.get(name) ?? { count: 0, total: 0, dates: [], category: t.category, instances: [] };
      e.count++; e.total += v; e.dates.push(t.date); e.instances.push({ date: day, cents: v }); occ.set(name, e);
      if (isPayNowToPerson(t.description, t.counterparty)) paynowTotal += v;
    } else income += t.amountCents;
  }
  const categories = [...byCat.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  // Extra views of "Where it went": per-month category mix, and this period against the one before it.
  const catByMonth = new Map<string, Map<string, number>>();
  for (const t of allTxns) {
    if (t.amountCents >= 0) continue;
    const ym = t.date.toISOString().slice(0, 7);
    let m = catByMonth.get(ym); if (!m) { m = new Map(); catByMonth.set(ym, m); }
    m.set(t.category, (m.get(t.category) ?? 0) + -t.amountCents);
  }
  const selMonths = monthsPresent.filter((m) => m >= from && m <= to);
  const monthly = selMonths.map((ym) => ({ ym, label: `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`, byCat: Object.fromEntries(catByMonth.get(ym) ?? []) }));
  const sumCats = (ms: string[]) => { const out = new Map<string, number>(); for (const ym of ms) for (const [c, v] of catByMonth.get(ym) ?? []) out.set(c, (out.get(c) ?? 0) + v); return out; };
  const span = (ms: string[]) => (ms.length === 1 ? ymLabel(ms[0]!) : `${ymLabel(ms[0]!)}–${ymLabel(ms[ms.length - 1]!)}`);
  const startIdx = monthsPresent.indexOf(selMonths[0]!);
  // Same-length period just before the chosen one; if there is none (e.g. "All time"), the latest half against the half before it.
  let curMonths = selMonths, prevMonths = startIdx >= selMonths.length ? monthsPresent.slice(startIdx - selMonths.length, startIdx) : [];
  if (prevMonths.length === 0 && selMonths.length >= 2) {
    const half = Math.min(12, Math.floor(selMonths.length / 2));
    curMonths = selMonths.slice(-half); prevMonths = selMonths.slice(-2 * half, -half);
  }
  const curCats = sumCats(curMonths), prevCats = sumCats(prevMonths);
  const compare = prevMonths.length === 0 ? null : {
    curLabel: span(curMonths), prevLabel: span(prevMonths),
    rows: [...new Set([...curCats.keys(), ...prevCats.keys()])].map((name) => ({ name, cur: curCats.get(name) ?? 0, prev: prevCats.get(name) ?? 0 }))
      .sort((a, b) => Math.max(b.cur, b.prev) - Math.max(a.cur, a.prev)),
  };

  const monthlyTrend = byDay.size > 92; // long window -> aggregate to months so it stays readable
  const trend = monthlyTrend
    ? [...byMonth.entries()].sort().map(([m, cents]) => ({ day: `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`, cents }))
    : [...byDay.entries()].sort().map(([day, cents]) => ({ day: day.slice(5), cents }));
  const trendLabel = monthlyTrend ? "Monthly spend" : "Daily spend";
  const breakdown: Record<string, { name: string; cents: number; count: number }[]> = {};
  for (const [cat, m] of catMerch) breakdown[cat] = [...m.entries()].map(([name, e]) => ({ name, cents: e.cents, count: e.count })).sort((a, b) => b.cents - a.cents).slice(0, 12);
  const recurring = [...occ.entries()].filter(([, e]) => e.count >= 3).map(([name, e]) => ({ name, count: e.count, avg: Math.round(e.total / e.count), total: e.total, cadence: cadenceLabel(e.dates), category: e.category, instances: [...e.instances].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12) })).sort((a, b) => b.total - a.total).slice(0, 10);
  const needsReview = txns.filter((t) => t.needsReview).length;
  const rows = txns.map((t) => ({ id: t.id, date: t.date.toISOString(), description: t.description, counterparty: t.counterparty, merchant: cleanMerchant(t.description, t.counterparty), category: t.category, amountCents: t.amountCents, needsReview: t.needsReview }));

  // Roadmap features (deterministic, on-device).
  const insights = computeInsights(txns);
  const alerts = computeAlerts(txns);
  const subscriptions = computeSubscriptions(txns);
  const peers = computePeers(txns);
  const health = computeHealth(txns);
  const flow = buildMoneyFlow(txns);
  const monthsCount = new Set(txns.map((t) => t.date.toISOString().slice(0, 7))).size || 1;
  const incomeMonthlyCents = Math.round(income / monthsCount);

  return (
    <section className="dash">
      <DashboardHeader
        rangeLabel={rangeLabel} txnCount={txns.length} monthsList={monthsPresent} from={from} to={to}
        incomeCents={income} spendCents={spend} paynowPeopleCents={paynowTotal} needsReview={needsReview}
      />

      <InsightRail insights={insights} />

      <DashboardCharts categories={categories} trend={trend} breakdown={breakdown} trendLabel={trendLabel} monthly={monthly} compare={compare} />

      <MoneyFlowChart flow={flow} />

      <div className="dash-row">
        <AlertsPanel alerts={alerts} />
        <SubscriptionCard summary={subscriptions} incomeMonthlyCents={incomeMonthlyCents} />
        <FinancialHealthCard health={health} />
      </div>

      <CalendarHeatmap rows={rows} />

      <div className="dash-row">
        <PeerLedgerCard peers={peers} />
        <RecurringPanel recurring={recurring} />
      </div>

      <div className="dash-links">
        <Link className="btn ghost" href="/dashboard/statements">See all transactions</Link>
      </div>
    </section>
  );
}
