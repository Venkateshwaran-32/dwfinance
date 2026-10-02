import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { DashboardNav } from "@/components/dashboard-nav";
import { UploadProvider } from "@/components/upload-provider";
import { UploadIndicator } from "@/components/upload-indicator";
import { SystemMonitorDock } from "@/components/system-monitor-dock";
import { env } from "@/lib/env";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <UploadProvider>
      <header className="navbar">
        <div className="navbar-inner">
          <Link href="/dashboard" className="brand">dwfinance</Link>
          <DashboardNav />
          <div className="navbar-right">
            <UploadIndicator />
            <form action={logoutAction}>
              <button className="btn ghost" type="submit">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page-main">{children}</main>
      {/* Host CPU/RAM monitor: its API is dev-only (404 in production), so the dock is too. */}
      {env.NODE_ENV !== "production" && <SystemMonitorDock />}
    </UploadProvider>
  );
}
