// Synthetic 2067 "DBS-style" consolidated statements for a FICTIONAL NTU undergraduate.
// Pure + seeded (mulberry32) so output is byte-stable. Every name, stall, company, address,
// account number and reference here is invented. The text layout is shaped to satisfy the
// existing src/server/parse-dbs.ts regexes after unpdf extraction (mergePages:true).
import PDFDocument from "pdfkit";

export const YEAR = 2067;
export const OPENING_CENTS = 185_000;
export const BANNER = "SYNTHETIC SAMPLE - NOT A REAL BANK STATEMENT";
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOLDER = "MS ARIA LOKE XIN YI";
const ADDRESS = ["BLK 999 FICTION AVENUE 7 #12-345", "SINGAPORE 999999"];
const ACCOUNT = "900-482617-3";
const ROWS_PER_PAGE = 25;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Narration templates (mimic real DBS wording; each has a known clean payee) ---
export const tpl = {
  paynowOut: (ref: string, name: string) => `Advice FAST Payment / Receipt PAYNOW TRANSFER ${ref} TO: ${name}`,
  paynowIn: (ref: string, name: string) => `Advice FAST Payment / Receipt INCOMING PAYNOW REF ${ref} FROM: ${name}`,
  netsQr: (ref: string, stall: string) => `Advice Point-Of-Sale Transaction or Proceeds NETS QR PAYMENT ${ref} TO: ${stall}`,
  card: (merchant: string) => `Debit Card Transaction ${merchant} SI SINGAPORE`,
  busMrt: (ref: string) => `Debit Card Transaction BUS/MRT ${ref} SI SINGAPORE`,
  salary: (ref: string, company: string) => `Advice GIRO SALARY ${ref} FROM: ${company}`,
  bill: (ref: string, payee: string) => `Advice Bill Payment ${payee} ${ref}`,
};

export const PAYEES = {
  teachOnce: "ONG BEE LIAN",
  hawkers: ["GOH AH HOCK", "RAHMAT BIN YUSOF"],
  parent: "LOKE KAH WAI",
  employer: "BRIGHTLEAF TUITION PTE LTD",
  stalls: ["HAPPY DUCK NOODLE STALL", "AUNTY MAY NASI LEMAK", "CANTEEN 2 MIXED RICE", "SPINE DRINK STALL"],
};

// Template -> expected cleanMerchant output (asserted by tests).
export const TEMPLATE_EXPECTATIONS: { description: string; payee: string }[] = [
  { description: tpl.paynowOut("4417203", PAYEES.teachOnce), payee: PAYEES.teachOnce },
  ...PAYEES.hawkers.map((h) => ({ description: tpl.paynowOut("5520931", h), payee: h })),
  { description: tpl.paynowIn("7781042", PAYEES.parent), payee: PAYEES.parent },
  ...PAYEES.stalls.map((s) => ({ description: tpl.netsQr("610245988013527", s), payee: s })),
  { description: tpl.busMrt("512094377"), payee: "BUS/MRT" },
  { description: tpl.salary("3390871", PAYEES.employer), payee: PAYEES.employer },
  { description: tpl.bill("7712345", "NTU HALL OF RESIDENCE FEES"), payee: "NTU HALL OF RESIDENCE FEES" },
  ...["SPOTIFY", "NETFLIX.COM", "SHOPEE", "NTUC FAIRPRICE NTU", "7-ELEVEN NTU HALL", "KOI THE NTU", "GRAB RIDES", "GRABFOOD",
    "FOODPANDA", "DECATHLON", "LAPTOP WORLD", "POPULAR BOOKSTORE NTU", "BOULDER BARN CLIMBING"].map((m) => ({ description: tpl.card(m), payee: m })),
];

export type Row = { day: number; description: string; cents: number; balanceCents: number };
export type MonthStatement = { month: number; openingCents: number; closingCents: number; rows: Row[]; year?: number }; // year defaults to YEAR

type Plan = { day: number; description: string; cents: number; planted?: boolean };

export const daysIn = (m: number, y = YEAR) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (m: number, d: number, y = YEAR) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
export const isWeekday = (m: number, d: number, y = YEAR) => { const w = weekday(m, d, y); return w !== 0 && w !== 6; };

export function generateYear(seed = 2067): MonthStatement[] {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const ref = (n: number) => { let s = String(int(1, 9)); while (s.length < n) s += String(int(0, 9)); return s; };
  const cents = (lo: number, hi: number, step = 10) => Math.round(int(lo / step, hi / step)) * step; // inclusive, in cents

  const out: MonthStatement[] = [];
  let bal = OPENING_CENTS;
  for (let m = 1; m <= 12; m++) {
    const n = daysIn(m);
    const plan: Plan[] = [];
    const add = (day: number, description: string, c: number, planted = false) => plan.push({ day, description, cents: c, planted });

    // Income: monthly allowance from parent + part-time tutoring pay.
    add(1, tpl.paynowIn(ref(7), PAYEES.parent), 50_000, true);
    add(int(24, 27), tpl.salary(ref(7), PAYEES.employer), cents(40_000, 70_000, 500), true);

    // Fixed subscriptions. NETFLIX price rise lands only in December (latest charge).
    add(5, tpl.card("SPOTIFY"), -1098, true);
    add(12, tpl.card("NETFLIX.COM"), m === 12 ? -1798 : -1398, true);

    for (let d = 1; d <= n; d++) {
      const wk = isWeekday(m, d);
      // The "teach once" demo payee: hawker aunty paid by PayNow on most weekdays.
      if (wk && rnd() < 0.8) add(d, tpl.paynowOut(ref(7), PAYEES.teachOnce), -cents(330, 450));
      if (wk && rnd() < 0.15) add(d, tpl.paynowOut(ref(7), PAYEES.hawkers[0]!), -cents(350, 600));
      if (rnd() < 0.15) add(d, tpl.paynowOut(ref(7), PAYEES.hawkers[1]!), -cents(400, 650));
      if (rnd() < 0.45) add(d, tpl.netsQr(ref(15), pick(PAYEES.stalls)), -cents(250, 800));
      if (wk ? rnd() < 0.65 : rnd() < 0.3) add(d, tpl.busMrt(ref(9)), -cents(99, 240, 1));
      if (rnd() < 0.11) add(d, tpl.card("7-ELEVEN NTU HALL"), -cents(180, 900, 5));
      if (rnd() < 0.1) add(d, tpl.card("KOI THE NTU"), -cents(390, 620));
      const delivery = m === 11 ? 0.4 : 0.07; // November exam-season spike
      if (rnd() < delivery) add(d, tpl.card(pick(["GRABFOOD", "FOODPANDA"])), -cents(1250, 2890, 5));
      if (m === 11 && rnd() < 0.3) add(d, tpl.netsQr(ref(15), pick(PAYEES.stalls)), -cents(300, 900));
    }
    for (let i = 0; i < 4; i++) add(int(1, n), tpl.card("NTUC FAIRPRICE NTU"), -cents(1200, 5800, 5));
    for (let i = 0; i < 2; i++) add(int(1, n), tpl.card("GRAB RIDES"), -cents(900, 2400, 5));
      for (let i = 0; i < 2; i++) add(int(1, n), tpl.card("SHOPEE"), -cents(890, 6500, 5));

    // Planted stories.
    if (m === 8) { // spike month: laptop + hall fee + textbooks
      add(6, tpl.card("LAPTOP WORLD"), -149_900, true);
      add(6, tpl.bill(ref(7), "NTU HALL OF RESIDENCE FEES"), -48_000, true);
      add(11, tpl.card("POPULAR BOOKSTORE NTU"), -8990, true);
    }
    if (m === 10) { // duplicate charge: same merchant, same amount, same day
      add(18, tpl.card("DECATHLON"), -12_900, true);
      add(18, tpl.card("DECATHLON"), -12_900, true);
    }
    if (m === 12) { // brand-new merchant first seen in the latest month
      add(9, tpl.card("BOULDER BARN CLIMBING"), -6800, true);
      add(23, tpl.card("BOULDER BARN CLIMBING"), -6800, true);
    }

    // Stable order: by day, credits first within a day, then insertion order.
    const ordered = plan.map((p, i) => ({ p, i })).sort((a, b) => a.p.day - b.p.day || Number(b.p.cents > 0) - Number(a.p.cents > 0) || a.i - b.i).map((x) => x.p);
    const opening = bal;
    const rows: Row[] = [];
    for (const p of ordered) {
      if (p.cents < 0 && bal + p.cents < 2000 && !p.planted) continue; // never overdraw on filler spends
      bal += p.cents;
      if (bal < 0) throw new Error(`balance negative in month ${m}`);
      rows.push({ day: p.day, description: p.description, cents: p.cents, balanceCents: bal });
    }
    if (rows.length < 60 || rows.length > 110) throw new Error(`month ${m} has ${rows.length} rows (want 60..110)`);
    out.push({ month: m, openingCents: opening, closingCents: bal, rows });
  }
  return out;
}

export function fmt(c: number): string {
  const abs = Math.abs(c);
  return `${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
const dd = (n: number) => String(n).padStart(2, "0");
export const dateStr = (m: number, d: number, y = YEAR) => `${dd(d)}/${dd(m)}/${y}`;
export const fileName = (m: number, y = YEAR) => `dbs-style-${y}-${dd(m)}.pdf`;

// Render one month. Text-only, A4, manual pagination (no auto pages), one row per line, no wrapping.
export function renderStatementPdf(s: MonthStatement): Promise<Buffer> {
  const year = s.year ?? YEAR;
  const fixed = new Date(Date.UTC(year, s.month, 1));
  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, info: { Title: `Synthetic sample statement ${MONTHS[s.month - 1]} ${year}`, Author: "dwfinance synthetic generator", CreationDate: fixed, ModDate: fixed } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => { doc.on("end", () => res(Buffer.concat(chunks))); doc.on("error", rej); });

  const W = 595.28, H = 841.89, L = 36, R = W - 36;
  const DESC_X = 82, DESC_MAX = 372, WD_R = 488, DP_R = 532, BAL_R = R;
  const line = (t: string, x: number, y: number, size = 7.5) => doc.fontSize(size).text(t, x, y, { lineBreak: false });
  const right = (t: string, xr: number, y: number, size = 7) => { doc.fontSize(size); doc.text(t, xr - doc.widthOfString(t), y, { lineBreak: false }); };
  const fit = (t: string) => { doc.fontSize(6); let s = t; while (s.length > 10 && doc.widthOfString(s) > DESC_MAX) s = s.slice(0, -1); return s.trimEnd(); };

  const lastDay = daysIn(s.month, year);
  const pages: Row[][] = [];
  for (let i = 0; i < s.rows.length; i += ROWS_PER_PAGE) pages.push(s.rows.slice(i, i + ROWS_PER_PAGE));
  let carried = s.openingCents;
  pages.forEach((rows, pi) => {
    doc.addPage({ size: "A4", margin: 0 });
    doc.font("Helvetica");
    line(BANNER, L, 22, 8);
    let y = 44;
    if (pi === 0) {
      line("Consolidated Statement (SYNTHETIC SAMPLE)", L, y, 13); y += 22;
      line(HOLDER, L, y); y += 11;
      for (const a of ADDRESS) { line(a, L, y); y += 11; }
      y += 6;
      line(`Account Summary as at ${lastDay} ${MONTHS[s.month - 1]} ${year}`, L, y, 9); y += 13;
      line(`Savings Account ${ACCOUNT}`, L, y); y += 11;
      line(`Total: SGD Equivalent ${fmt(s.closingCents)}`, L, y); y += 20;
    }
    line("Transaction Details", L, y, 9); y += 13;
    line("Date Description Withdrawal (-) Deposit (+) Balance", L, y, 7); y += 12;
    line(`Balance Brought Forward SGD ${fmt(carried)}`, L, y, 7); y += 12;
    for (const r of rows) {
      line(dateStr(s.month, r.day, year), L, y, 6.5);
      doc.fontSize(6).text(fit(r.description), DESC_X, y, { lineBreak: false });
      right(fmt(r.cents), r.cents < 0 ? WD_R : DP_R, y, 6.5);
      right(fmt(r.balanceCents), BAL_R, y, 6.5);
      carried = r.balanceCents;
      y += 11;
    }
    line(`Balance Carried Forward SGD ${fmt(carried)}`, L, y + 4, 7);
    line(BANNER, L, H - 30, 8);
  });
  doc.end();
  return done;
}
