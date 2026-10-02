"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export type StatementFilterValues = {
  q: string; month: string; category: string; dir: "" | "out" | "in"; min: string; max: string; review: boolean; all: boolean; oneOff: boolean;
  // advanced
  not: string; from: string; to: string; cats: string[]; types: string[]; sort: string; group: string; advOpen: boolean;
};
type Option = readonly [value: string, label: string];

const MULTI = new Set(["cats", "type"]); // checkbox groups travel as one comma-separated param

// Plain GET form (works without JS); this wrapper applies select/toggle/date changes instantly and keeps
// empty fields out of the URL. Text and amount fields apply on Enter or the Apply button.
export function StatementFilters({
  values, months, categories, payTypes, sorts, groups, presets,
}: {
  values: StatementFilterValues; months: string[]; categories: readonly string[];
  payTypes: readonly Option[]; sorts: readonly Option[]; groups: readonly Option[]; presets: { label: string; href: string }[];
}) {
  const router = useRouter();
  const [advOpen, setAdvOpen] = useState(values.advOpen);

  function go(form: HTMLFormElement, changed?: string) {
    const p = new URLSearchParams();
    const multi = new Map<string, string[]>();
    for (const [k, v] of new FormData(form)) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (MULTI.has(k)) multi.set(k, [...(multi.get(k) ?? []), v]);
      else p.set(k, v.trim());
    }
    for (const [k, vals] of multi) p.set(k, vals.join(","));
    // A month and a custom date range are two ways to say the same thing: the one just touched wins.
    if (changed === "month") { p.delete("from"); p.delete("to"); }
    if (changed === "from" || changed === "to") p.delete("month");
    if (p.get("sort") === "default") p.delete("sort");
    if (p.get("group") === "month") p.delete("group");
    const qs = p.toString();
    router.push(qs ? `/dashboard/statements?${qs}` : "/dashboard/statements");
  }
  const onSubmit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); go(e.currentTarget); };
  const onChange = (e: FormEvent<HTMLFormElement>) => {
    const t = e.target as HTMLInputElement;
    if (t.tagName === "SELECT" || t.type === "checkbox" || t.type === "radio" || t.type === "date") go(e.currentTarget, t.name);
  };

  return (
    <form className="card stmt-toolbar" method="get" action="/dashboard/statements" onSubmit={onSubmit} onChange={onChange} role="search" aria-label="Filter transactions">
      <div className="stmt-toolbar-row">
        <input className="input stmt-search" type="search" name="q" defaultValue={values.q} placeholder="Search payee or description..." aria-label="Search payee or description" maxLength={200} />
        <select className="input" name="month" defaultValue={values.month} aria-label="Month">
          <option value="">All months</option>
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <select className="input" name="category" defaultValue={values.category} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="stmt-toolbar-row">
        <fieldset className="stmt-seg">
          <legend className="sr-only">Direction</legend>
          {([["", "All"], ["out", "Money out"], ["in", "Money in"]] as const).map(([v, label]) => (
            <label key={v || "all"} className={values.dir === v ? "on" : undefined}>
              <input type="radio" name="dir" value={v} defaultChecked={values.dir === v} />{label}
            </label>
          ))}
        </fieldset>
        <span className="stmt-range">
          <input className="input" type="number" name="min" min={0} step="0.01" inputMode="decimal" defaultValue={values.min} placeholder="Min S$" aria-label="Minimum amount in SGD" />
          <span aria-hidden="true">to</span>
          <input className="input" type="number" name="max" min={0} step="0.01" inputMode="decimal" defaultValue={values.max} placeholder="Max S$" aria-label="Maximum amount in SGD" />
        </span>
        <label className="stmt-check"><input type="checkbox" name="review" value="1" defaultChecked={values.review} /> Needs review</label>
        <label className="stmt-check"><input type="checkbox" name="all" value="1" defaultChecked={values.all} /> Show other rows too</label>
        <span className="stmt-actions">
          <button className="btn" type="submit">Apply</button>
          <a className="btn ghost" href="/dashboard/statements">Clear</a>
        </span>
      </div>

      <details className="stmt-adv" open={advOpen} onToggle={(e) => setAdvOpen(e.currentTarget.open)}>
        <summary>Advanced search</summary>
        {advOpen && <input type="hidden" name="adv" value="1" />}
        {values.oneOff && <input type="hidden" name="oneoff" value="1" />}
        <div className="stmt-adv-grid">
          <div className="stmt-field stmt-field-wide">
            <span className="stmt-label" id="adv-range">Date range</span>
            <span className="stmt-range" role="group" aria-labelledby="adv-range">
              <input className="input" type="date" name="from" defaultValue={values.from} aria-label="From date" />
              <span aria-hidden="true">to</span>
              <input className="input" type="date" name="to" defaultValue={values.to} aria-label="To date" />
            </span>
          </div>
          <label className="stmt-field">
            <span className="stmt-label">Exclude words</span>
            <input className="input" type="text" name="not" defaultValue={values.not} placeholder='e.g. grab "ong bee lian"' maxLength={100} />
          </label>
          <label className="stmt-field">
            <span className="stmt-label">Sort by</span>
            <select className="input" name="sort" defaultValue={values.sort}>{sorts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="stmt-field">
            <span className="stmt-label">Group by</span>
            <select className="input" name="group" defaultValue={values.group}>{groups.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        <fieldset className="stmt-fieldset">
          <legend className="stmt-label">Paid by</legend>
          <div className="stmt-pills">
            {payTypes.map(([v, l]) => (
              <label key={v} className="stmt-pill"><input type="checkbox" name="type" value={v} defaultChecked={values.types.includes(v)} /><span>{l}</span></label>
            ))}
          </div>
        </fieldset>
        <fieldset className="stmt-fieldset">
          <legend className="stmt-label">Categories (pick several)</legend>
          <div className="stmt-pills">
            {categories.map((c) => (
              <label key={c} className="stmt-pill"><input type="checkbox" name="cats" value={c} defaultChecked={values.cats.includes(c)} /><span>{c}</span></label>
            ))}
          </div>
        </fieldset>
        <div className="stmt-fieldset">
          <span className="stmt-label">Quick searches</span>
          <div className="stmt-pills">
            {presets.map((p) => <a key={p.label} className="stmt-preset" href={p.href}>{p.label}</a>)}
          </div>
        </div>
        <p className="stmt-tips">
          Search box tips: <code>grab -food</code> leaves out a word, <code>&quot;ong bee lian&quot;</code> matches an exact name,{" "}
          <code>&gt;50</code> <code>&lt;10</code> <code>10..20</code> <code>=3.30</code> search by amount, and category names like <code>transport</code> work too.
        </p>
      </details>
    </form>
  );
}

function monthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", { month: "short", year: "numeric", timeZone: "UTC" });
}
