"use client";
import { useState } from "react";

// A card whose body can be minimized and is height-capped + scrollable, so data-heavy
// sections don't blow up page height on long ranges (12m / all).
export function CollapsibleCard({
  title, subtitle, children, bodyMaxHeight, defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  bodyMaxHeight?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          {title}
          {subtitle ? <span style={{ color: "var(--text-dim)", fontWeight: 400, fontSize: 13 }}> · {subtitle}</span> : null}
        </h2>
        <button
          className="card-collapse"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Minimize ${title}` : `Expand ${title}`}
          title={open ? "Minimize" : "Expand"}
        >
          {open ? "–" : "+"}
        </button>
      </div>
      {open ? (
        <div style={{ marginTop: 12, maxHeight: bodyMaxHeight, overflowY: bodyMaxHeight ? "auto" : undefined }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
