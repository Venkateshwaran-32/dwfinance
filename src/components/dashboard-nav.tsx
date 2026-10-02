"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/dashboard/chat", "Ask AI"],
  ["/dashboard/statements", "Statements"],
  ["/dashboard/upload", "Upload"],
  ["/dashboard/review", "Review"],
  ["/dashboard/utilities", "Utilities"],
  ["/dashboard/connect-dbs", "Connect DBS"],
];

export function DashboardNav() {
  const path = usePathname();
  return (
    <nav className="nav-links">
      {ITEMS.map(([href, label]) => {
        const active = href === "/dashboard" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
