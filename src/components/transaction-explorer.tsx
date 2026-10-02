"use client";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";

export type Row = { id: string; date: string; description: string; counterparty: string | null; merchant: string; category: string; amountCents: number; needsReview: boolean };

function toCsv(rows: Row[]): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ["date", "merchant", "description", "category", "amount", "needsReview"].join(",");
  const body = rows.map((r) => [r.date.slice(0, 10), esc(r.merchant), esc(r.description), r.category, (r.amountCents / 100).toFixed(2), r.needsReview].join(","));
  return [head, ...body].join("\n");
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function TransactionExplorer({ rows, categories }: { rows: Row[]; categories: string[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [onlyReview, setOnlyReview] = useState(false);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (cat === "All" || r.category === cat) &&
      (!onlyReview || r.needsReview) &&
      (needle === "" || `${r.merchant} ${r.description} ${r.counterparty ?? ""} ${r.category}`.toLowerCase().includes(needle)),
    );
  }, [rows, q, cat, onlyReview]);

  const total = filtered.reduce((s, r) => s + (r.amountCents < 0 ? -r.amountCents : 0), 0);

  function copyBrief() {
    const byCat = new Map<string, number>();
    for (const r of filtered) if (r.amountCents < 0) byCat.set(r.category, (byCat.get(r.category) ?? 0) + -r.amountCents);
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `  ${c}: ${formatCents(v)}`).join("\n");
    const brief = `dwfinance brief — ${filtered.length} transactions, ${formatCents(total)} spent${cat !== "All" ? ` (${cat})` : ""}\nTop categories:\n${top}`;
    navigator.clipboard.writeText(brief).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, flex: "1 1 160px" }}>
          Transactions <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>({filtered.length} · {formatCents(total)} spent)</span>
        </h2>
        <input className="input" placeholder="Search payee / description…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} aria-label="Search transactions" />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 160 }} aria-label="Filter by category">
          <option value="All">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> needs review
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost" style={{ fontSize: 12, padding: "0.4rem 0.7rem" }} onClick={() => download("transactions.csv", toCsv(filtered), "text/csv")}>CSV</button>
          <button className="btn ghost" style={{ fontSize: 12, padding: "0.4rem 0.7rem" }} onClick={() => download("transactions.json", JSON.stringify(filtered, null, 2), "application/json")}>JSON</button>
          <button className="btn ghost" style={{ fontSize: 12, padding: "0.4rem 0.7rem" }} onClick={copyBrief}>{copied ? "Copied ✓" : "Copy brief"}</button>
        </div>
      </div>
      <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ color: "var(--text-dim)", textAlign: "left", position: "sticky", top: 0, background: "var(--surface)" }}>
            <th style={{ padding: "6px 8px" }}>Date</th><th>Merchant</th><th>Category</th><th style={{ textAlign: "right" }}>Amount</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 20, color: "var(--text-dim)", textAlign: "center" }}>No matching transactions.</td></tr>
            ) : filtered.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="mono" style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{t.date.slice(0, 10)}</td>
                <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>{t.merchant}</td>
                <td><button onClick={() => setCat(t.category)} title="Filter by this category" style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, font: "inherit" }}>{t.category}</button>{t.needsReview ? <span style={{ color: "var(--accent)" }}> ·review</span> : null}</td>
                <td className="mono" style={{ textAlign: "right", color: t.amountCents < 0 ? "var(--text)" : "var(--pos)" }}>{formatCents(t.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
