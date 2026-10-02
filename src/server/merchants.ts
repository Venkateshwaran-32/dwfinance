import "server-only";

export type Cat = { category: string; subcategory?: string };

// Pull a clean merchant/payee out of verbose DBS/POSB narration.
//  "Point-of-Sale Transaction or Proceeds NETS QR PAYMENT 6090.. TO: XIAO LONG BAO" -> "XIAO LONG BAO"
//  "Debit Card Transaction 7-ELEVEN-LUBRITRADE BL SI SINGAPORE"                      -> "7-ELEVEN-LUBRITRADE BL"
//  "INCOMING PAYNOW REF 95.. FROM: MISHRA AKSHAT"                                    -> "MISHRA AKSHAT"
export function cleanMerchant(description: string, counterparty?: string | null): string {
  const cp = (counterparty || "").trim();
  if (cp && !/^\d+$/.test(cp) && cp.length > 1) { const c = tidy(cp); if (c.length > 1) return c; }
  let s = description || "";
  const m = s.match(/(?:TO|FROM)[:\s]+(.+)$/i);
  if (m) s = m[1];
  const out = tidy(s);
  if (out.length > 1) return out;
  // Nothing meaningful left (pure transfer with only a ref) -> a typed label, never raw gibberish.
  if (/funds? ?transfer|giro|interbank|\bFT\d/i.test(description)) return "Bank transfer";
  if (/paynow/i.test(description)) return "PayNow transfer";
  return (description || "").trim().slice(0, 40);
}

function tidy(s: string): string {
  const out = s
    .replace(/\b(Point-of-Sale Transaction( or Proceeds)?|Debit Card Transaction|Credit Card Transaction|NETS QR PAYMENT|NETS QR|PAYNOW (TRANSFER|TRANSACTION)|INCOMING PAYNOW|OUTGOING PAYNOW|PAYNOW|Funds? ?Transfer|GIRO Payment|GIRO|Bill Payment|Interbank|Advice|Proceeds)\b/gi, " ")
    .replace(/\bREF\b\s*\w+/gi, " ")
    .replace(/\b[A-Z]{1,4}\d{4,}[A-Z0-9]*\b/gi, " ")   // refs like FT260313IB01629348
    .replace(/\b\d{2,}-\d{2,}-[\dA-Za-z:]+\b/g, " ")    // account-like 102-16869-0:IB
    .replace(/:[A-Za-z]{1,4}\b/g, " ")                  // :IB suffix
    .replace(/\b\d{5,}\b/g, " ")                        // long bare numbers
    .replace(/\b(SI )?SINGAPORE\b|\bSGP?\b/gi, " ")
    .replace(/[^A-Za-z0-9&.'()/\- ]/g, " ")
    .replace(/\s{2,}/g, " ").trim();
  return out;
}

// Broad SG keyword rules — the instant, free first pass.
const RULES: { match: RegExp; cat: Cat; spendOnly?: boolean }[] = [
  { match: /food ?court|hawker|kopitiam|\bkopi\b|coffee ?shop|eating house|canteen|\bcafe\b|restaurant|bistro|bakery|\bbread\b|\bcake\b|chicken rice|\bnasi\b|\bmee\b|noodle|laksa|prata|\broti\b|dim ?sum|xiao long bao|din tai|hotpot|\bbbq\b|kfc|mcdonald|burger|pizza|subway|jollibee|starbucks|toast box|ya kun|old chang|bubble tea|\bkoi\b|liho|gong cha|drink ?stall|beverage|\bdrinks?\b|\bjuice\b|\bsnack|\bkiosk|\bmart food|thrive foods|foodini|\bfood\b|dining|\beat\b|sushi|ramen|\bthai\b|\bteh\b|seafood|chic-?a-?boo|swee choon|fairprice finest food/i, cat: { category: "Food & Dining" } },
  { match: /foodpanda|deliveroo|grabfood/i, cat: { category: "Food & Dining" } },
  { match: /ntuc|fairprice|cold storage|\bgiant\b|sheng siong|prime super|7-?eleven|cheers|provision|mustafa/i, cat: { category: "Groceries" } },
  { match: /\bgrab\b|gojek|\btada\b|comfort|\bcdg\b|\btaxi\b|\bmrt\b|\bbus\b|transit|ez-?link|simplygo|\bsmrt\b|\bsbs\b|\bshell\b|\besso\b|caltex|\bspc\b|petrol|parking|\berp\b|carpark/i, cat: { category: "Transport" } },
  { match: /sp ?group|sp ?services|city ?gas|\bpub\b|utilit/i, cat: { category: "Utilities" } },
  { match: /singtel|starhub|\bm1\b|circles|simba|myrepublic|\bgomo\b/i, cat: { category: "Telecom" } },
  // Housing / Education / Travel are SPEND-ONLY (see ruleCategorize): an employer like
  // "BRIGHTLEAF TUITION PTE LTD" paying a salary must never become an Education expense, and a hotel
  // refund is money in, not Travel. Housing precedes Education so "NTU HALL OF RESIDENCE FEES" is rent.
  // "\bhall\b" alone is deliberately absent: "7-ELEVEN NTU HALL" is a shop on campus, not housing.
  { spendOnly: true, match: /\brent\b|rent(al)? payment|co-?living|hall of residence|\bhall (fees?|rent)\b|\bhostel\b|landlord|property (mgmt|management)|town council|\bhdb\b|\bs&cc\b/i, cat: { category: "Housing" } },
  // Bookstores go to Education, not Shopping: in a student's statement a campus bookstore charge at
  // term start is overwhelmingly textbooks/stationery. Must sit above the Shopping rule ("popular").
  { spendOnly: true, match: /tuition fees?|school fees?|\buniversity\b|polytechnic|coursera|udemy|bookstore|book ?shop|textbook|exam fees?|course fees?|skillsfuture/i, cat: { category: "Education" } },
  { spendOnly: true, match: /\bscoot\b|singapore airlines|jetstar|air ?asia|\bairlines?\b|airways|cathay|agoda|booking\.com|airbnb|klook|trip\.com|expedia|\bhotels?\b|traveloka|\btravel\b/i, cat: { category: "Travel" } },
  { match: /shopee|lazada|amazon(?!\.com\/bill)|qoo10|zalora|uniqlo|\bikea\b|decathlon|challenger|courts|watsons|guardian|\bunity\b|sephora|don don|daiso|popular|kinokuniya|taobao|aliexpress/i, cat: { category: "Shopping" } },
  { match: /laptop|phone ?hub|electronics?|harvey norman|best denki|gain city/i, cat: { category: "Shopping" } },
  { match: /netflix|spotify|disney|youtube|apple\.com\/bill|\bicloud\b|google ?one|chatgpt|openai|notion|adobe|microsoft|dropbox|hbo|patreon|github/i, cat: { category: "Subscriptions" } },
  { match: /clinic|polyclinic|pharmacy|hospital|dental|medical|optical|spectacle|\bgp\b/i, cat: { category: "Health" } },
  { match: /salary|payroll|\bbonus\b|interest earned|dividend|gst voucher|cpf/i, cat: { category: "Income" } },
  { match: /\batm\b|cash withdrawal|cash deposit/i, cat: { category: "Cash" } },
];

export function normalizeKey(description: string, counterparty?: string | null): string {
  return cleanMerchant(description, counterparty).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 48)
    || (counterparty || description || "").toLowerCase().slice(0, 48);
}

// amountCents: pass it whenever known. Spend-only rules (Housing/Education/Travel) apply only to
// outgoing rows (amountCents < 0); with the direction unknown they are skipped rather than guessed.
export function ruleCategorize(description: string, counterparty?: string | null, amountCents?: number): Cat | null {
  const hay = `${cleanMerchant(description, counterparty)} ${description} ${counterparty ?? ""}`;
  const outgoing = amountCents !== undefined && amountCents < 0;
  for (const r of RULES) if ((!r.spendOnly || outgoing) && r.match.test(hay)) return r.cat;
  return null;
}

// PayNow/NETS-QR to a person or small stall — the DBS blind spot.
export function isPayNowToPerson(description: string, counterparty?: string | null): boolean {
  const hay = `${description} ${counterparty ?? ""}`;
  if (!/paynow|pay ?now|nets ?qr|fast transfer|fund(s)? transfer/i.test(hay)) return false;
  const m = cleanMerchant(description, counterparty);
  return /^[a-z][a-z0-9 .,'()/&-]{1,28}$/i.test(m) && m.split(/\s+/).length <= 5;
}

// Money sent to a named person by PayNow or bank transfer, for the "went to people" totals. Unlike isPayNowToPerson
// (which also covers NETS QR stall payments, for categorising), a NETS QR scan at a stall is a purchase, not a person.
export function isTransferToPerson(description: string, counterparty?: string | null): boolean {
  return isPayNowToPerson(description, counterparty) && !/nets ?qr/i.test(`${description} ${counterparty ?? ""}`);
}
