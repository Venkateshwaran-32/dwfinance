export default function ConnectDbsPage() {
  return (
    <section style={{ maxWidth: 620 }}>
      <h1>Connect DBS (V2 preview)</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Today dwfinance reads a statement PDF you upload. V2 drops the PDF flow entirely and pulls live
        transactions through the official DBS Developers API — so insights stay current with no manual upload.
      </p>
      <div className="card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Live transaction feed</span><span style={{ color: "var(--text-dim)" }}>planned</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Auto-categorization on every new transaction</span><span style={{ color: "var(--text-dim)" }}>planned</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Statement history beyond 6 months</span><span style={{ color: "var(--text-dim)" }}>planned</span></div>
        <button className="btn" disabled style={{ marginTop: 6 }}>Connect with DBS — coming in V2</button>
      </div>
      <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 12 }}>
        See the <a href="https://www.dbs.com/dbsdevelopers/" target="_blank" rel="noreferrer">DBS Developers API</a>. Not affiliated with DBS Bank Ltd.
      </p>
    </section>
  );
}
