import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

// Type system (see ../VISUAL_SYSTEM.md): one loud display face used sparingly, Inter for everything else.
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["800"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "dwfinance: DBS and POSB statements, sorted on your own computer",
  description: "Reads DBS and POSB statement PDFs and sorts every transaction on your own computer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        {children}
        <footer style={{ padding: "2rem 1rem", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
          Not affiliated with DBS Bank Ltd. Sample data is synthetic. Demo only. ·{" "}
          <a href="https://www.dbs.com/dbsdevelopers/" target="_blank" rel="noreferrer">DBS Developers API</a>
        </footer>
      </body>
    </html>
  );
}
