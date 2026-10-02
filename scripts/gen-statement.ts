// Generate a synthetic DBS statement PDF whose text layout matches src/server/parse-statement.ts:
//   "YYYY-MM-DD | <description> | <counterparty or -> | <signed amount>"
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { genRows } from "./sample-data";

const outDir = join(process.cwd(), "public", "sample-statements");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "dbs-statement-2026-04.pdf");

const doc = new PDFDocument({ size: "A4", margin: 48 });
doc.pipe(createWriteStream(outPath));
doc.fontSize(16).text("DBS Multiplier Account — Statement (SYNTHETIC / DEMO)");
doc.moveDown(0.5).fontSize(10).text("Statement period: 2026-04-01 to 2026-05-31");
doc.moveDown(0.5).text("Date | Description | Counterparty | Amount (SGD)");
doc.moveDown(0.5);
for (const r of genRows()) {
  doc.text(`${r.date} | ${r.description} | ${r.counterparty ?? "-"} | ${(r.amountCents / 100).toFixed(2)}`);
}
doc.moveDown(1).fontSize(8).fillColor("#888").text("Synthetic data. Not a real DBS statement. Not affiliated with DBS Bank Ltd.");
doc.end();
console.log("wrote", outPath);
