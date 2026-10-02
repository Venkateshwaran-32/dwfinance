// Write the 48 synthetic statements (2067-2070, four uni years) to public/sample-statements/<year>/.
//   npx tsx scripts/gen-sample-2067.ts            (optional COPY_TO=<dir> also copies them all there)
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { renderStatementPdf, fileName, fmt } from "./sample-2067";
import { generateUni } from "./sample-uni";

async function main() {
  const copyTo = process.env.COPY_TO;
  if (copyTo) mkdirSync(copyTo, { recursive: true });
  let rows = 0;
  for (const s of generateUni()) {
    const outDir = join(process.cwd(), "public", "sample-statements", String(s.year));
    mkdirSync(outDir, { recursive: true });
    const name = fileName(s.month, s.year);
    const p = join(outDir, name);
    writeFileSync(p, await renderStatementPdf(s));
    if (copyTo) copyFileSync(p, join(copyTo, name));
    rows += s.rows.length;
    console.log(`${name}  rows=${s.rows.length}  opening=${fmt(s.openingCents)}  closing=${fmt(s.closingCents)}`);
  }
  console.log(`wrote 48 statements, ${rows} transactions`);
}

main().catch((e) => { console.error(e); process.exit(1); });
