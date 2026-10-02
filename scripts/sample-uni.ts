// Four synthetic uni years (2067-2070) for the same FICTIONAL NTU undergraduate.
// Year 1 is scripts/sample-2067.ts unchanged (byte-identical PDFs, so everything rehearsed on 2067 still holds).
// Years 2-4 continue the balance and are deliberately bumpier: prices creep up, part-time pay varies and
// sometimes stops, semester breaks and exam months change habits, and one-off events swing whole months.
// Pure + seeded, so output is byte-stable. Every name and company is invented.
import { generateYear, mulberry32, tpl, PAYEES, daysIn, isWeekday, type MonthStatement, type Row } from "./sample-2067";

export const YEARS = [2067, 2068, 2069, 2070] as const;
export type UniStatement = MonthStatement & { year: number };

export const UNI = {
  relatives: ["LOKE SIEW ENG", "TAN BOON HUAT", "LOKE MEI FANG"],
  friend: "CHUA WEI JIE",
  intern: "MERIDIAN DATA PTE LTD",
  research: "NTU RESEARCH OFFICE",
  cafes: ["STARBUCKS JURONG POINT", "TOAST BOX JURONG POINT", "SUSHI EXPRESS JEM"],
};

// New card merchants introduced after year 1 -> expected cleanMerchant output (asserted by tests).
export const UNI_CARD_MERCHANTS = [
  ...UNI.cafes, "SHAW THEATRES JEM", "UNIQLO JURONG POINT", "SIMBA TELECOM", "SCOOT", "AGODA", "KLOOK TRAVEL", "PHONE HUB",
  "DENTAL CLINIC NTU", "TICKETMASTER", "GRADSHOTS STUDIO", "SKYLINE CO-LIVING",
];

type Plan = { day: number; description: string; cents: number; planted?: boolean };

export function generateUni(seed = 20680101): UniStatement[] {
  const out: UniStatement[] = generateYear().map((s) => ({ ...s, year: 2067 }));
  let bal = out[out.length - 1]!.closingCents;

  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const ref = (n: number) => { let s = String(int(1, 9)); while (s.length < n) s += String(int(0, 9)); return s; };
  const cents = (lo: number, hi: number, step = 10) => Math.round(int(lo / step, hi / step)) * step;

  for (const year of [2068, 2069, 2070]) {
    const inflation = 1 + 0.07 * (year - 2067); // hawker and delivery prices creep up each year
    const price = (lo: number, hi: number, step = 10) => cents(Math.round((lo * inflation) / step) * step, Math.round((hi * inflation) / step) * step, step);

    for (let m = 1; m <= 12; m++) {
      const n = daysIn(m, year);
      const plan: Plan[] = [];
      const add = (day: number, description: string, c: number, planted = false) => plan.push({ day: Math.min(day, n), description, cents: c, planted });

      const onBreak = m === 6 || m === 7 || m === 12;           // semester break: mostly off campus
      const exams = m === 4 || m === 11;                         // exam crunch: more delivery, less tutoring
      const intern = year === 2069 && m >= 5 && m <= 7;          // summer internship
      const campus = intern ? 0.15 : onBreak ? 0.35 : 1;         // how often she eats on campus
      const mood = 0.65 + rnd() * 0.9;                           // month-to-month swing in discretionary spending

      // Income: allowance (trimmed in the final year), irregular part-time pay, an internship, ang bao, friends paying back.
      add(1, tpl.paynowIn(ref(7), PAYEES.parent), year === 2070 ? 45_000 : 50_000, true);
      if (intern) add(28, tpl.salary(ref(7), UNI.intern), 140_000, true);
      else if (!(exams && rnd() < 0.6)) add(int(24, 27), tpl.salary(ref(7), year === 2070 ? UNI.research : PAYEES.employer), year === 2070 ? cents(50_000, 115_000, 500) : cents(25_000, 95_000, 500), true); // research assistant pays better than tutoring
      if (m === 2) for (const rel of UNI.relatives.slice(0, int(2, 3))) add(int(10, 20), tpl.paynowIn(ref(7), rel), cents(5000, 20_000, 1000), true);
      if (rnd() < 0.3) add(int(3, n), tpl.paynowIn(ref(7), UNI.friend), cents(1500, 6000, 100), true);

      // Subscriptions. Spotify's price rise lands only in the very last month (the latest charge).
      add(5, tpl.card("SPOTIFY"), year === 2070 && m === 12 ? -1398 : -1098, true);
      add(12, tpl.card("NETFLIX.COM"), -1798, true);
      if (year === 2068 || (year === 2069 && m <= 6)) add(9, tpl.card("BOULDER BARN CLIMBING"), -6800, true); // gym pass, cancelled mid-2069
      if (year >= 2069) add(15, tpl.card("SIMBA TELECOM"), -1000, true);

      for (let d = 1; d <= n; d++) {
        const wk = isWeekday(m, d, year);
        if (wk && rnd() < 0.8 * campus) add(d, tpl.paynowOut(ref(7), PAYEES.teachOnce), -price(330, 450));
        if (wk && rnd() < 0.15 * campus) add(d, tpl.paynowOut(ref(7), PAYEES.hawkers[0]!), -price(350, 600));
        if (rnd() < 0.15 * campus) add(d, tpl.paynowOut(ref(7), PAYEES.hawkers[1]!), -price(400, 650));
        if (rnd() < 0.45 * campus) add(d, tpl.netsQr(ref(15), pick(PAYEES.stalls)), -price(250, 800));
        if (wk ? rnd() < 0.65 : rnd() < 0.3) add(d, tpl.busMrt(ref(9)), -cents(99, 240, 1));
        if (rnd() < 0.11 * mood) add(d, tpl.card("7-ELEVEN NTU HALL"), -price(180, 900, 5));
        if (rnd() < 0.1 * mood) add(d, tpl.card("KOI THE NTU"), -price(390, 620));
        if (rnd() < (exams ? 0.38 : 0.08 + 0.03 * (year - 2067)) * mood) add(d, tpl.card(pick(["GRABFOOD", "FOODPANDA"])), -price(1250, 2890, 5));
        if (rnd() < (1 - campus) * 0.5) add(d, tpl.card(pick(UNI.cafes)), -price(650, 2200, 5)); // eating out when off campus
        if (!wk && rnd() < 0.22 * mood) add(d, tpl.card("SHAW THEATRES JEM"), -1350);
      }
      for (let i = 0; i < Math.round(4 * mood); i++) add(int(1, n), tpl.card("NTUC FAIRPRICE NTU"), -price(1200, 5800, 5));
      for (let i = 0; i < Math.round(2 * mood) + (year - 2067); i++) add(int(1, n), tpl.card("GRAB RIDES"), -price(900, 2400, 5));
      for (let i = 0; i < Math.round(2 * mood); i++) add(int(1, n), tpl.card("SHOPEE"), -price(890, 6500, 5));
      if (rnd() < 0.3 * mood) add(int(1, n), tpl.card("UNIQLO JURONG POINT"), -cents(2990, 12_990, 100));

      // Planted events (always kept, never skipped by the low-balance guard).
      if (m === 1 || m === 8) { // start of each semester
        add(6, tpl.bill(ref(7), "NTU HALL OF RESIDENCE FEES"), -(48_000 + 2000 * (year - 2067)), true);
        add(11, tpl.card("POPULAR BOOKSTORE NTU"), -cents(4000, 12_000, 10), true);
      }
      const key = `${year}-${m}`;
      const trip = (flight: number, hotel: number, tours: number) => {
        add(8, tpl.card("SCOOT"), -flight, true); add(9, tpl.card("AGODA"), -hotel, true); add(10, tpl.card("KLOOK TRAVEL"), -tours, true);
      };
      if (key === "2068-6") trip(26_800, 31_000, 14_500);                          // first holiday trip
      if (key === "2069-3") add(14, tpl.card("PHONE HUB"), -119_900, true);         // new phone
      if (key === "2069-9") add(19, tpl.card("DENTAL CLINIC NTU"), -18_000, true);
      if (key === "2069-10") add(3, tpl.card("TICKETMASTER"), -24_800, true);       // concert
      if (key === "2069-12") trip(41_200, 52_000, 18_800);                          // year-end trip: spends more than she earns
      if (key === "2070-4") add(22, tpl.card("GRADSHOTS STUDIO"), -22_000, true);
      if (key === "2070-6") trip(68_000, 74_000, 26_000);                           // graduation trip
      if (key === "2070-10") { add(17, tpl.card("SHAW THEATRES JEM"), -1350, true); add(17, tpl.card("SHAW THEATRES JEM"), -1350, true); } // charged twice
      if (key === "2070-12") add(20, tpl.card("SKYLINE CO-LIVING"), -90_000, true); // brand-new merchant in the latest month: room deposit

      // Stable order: by day, credits first within a day, then insertion order.
      const ordered = plan.map((p, i) => ({ p, i })).sort((a, b) => a.p.day - b.p.day || Number(b.p.cents > 0) - Number(a.p.cents > 0) || a.i - b.i).map((x) => x.p);
      const opening = bal;
      const rows: Row[] = [];
      for (const p of ordered) {
        if (p.cents < 0 && bal + p.cents < 2000 && !p.planted) continue; // never overdraw on filler spends
        bal += p.cents;
        if (bal < 0) throw new Error(`balance negative in ${year}-${m}`);
        rows.push({ day: p.day, description: p.description, cents: p.cents, balanceCents: bal });
      }
      out.push({ year, month: m, openingCents: opening, closingCents: bal, rows });
    }
  }
  return out;
}
