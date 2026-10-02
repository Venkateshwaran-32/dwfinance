# dwfinance visual system

Locked on 2026-10-02. Tokens live in `src/app/globals.css`; fonts in `src/app/layout.tsx`.

## Look
Banking app: soft white cards on a light grey page, one flat DBS-red header block, pill buttons.
Reference for type and shapes: wise.com (one loud display face, calm body, big rounded cards).

## Colour
| Token | Value | Use |
|---|---|---|
| `--bg` | #F5F6F8 | page |
| `--surface` | #FFFFFF | cards |
| `--accent` | #E2231A | the header block, primary buttons, "needs your attention". Nothing else. |
| `--text` / `--text-dim` | #15171C / #646B76 | text; on the dashboard, spending amounts are ink |
| `--danger` | #B00020 | money out in transaction tables (Statements) |
| `--highlight` | #FFF1B8 | matched rows when the other rows are shown too |
| calendar scale | #FDE3E0 to #8F0D12, `--pos` | Spending calendar only: red by rank of the day's spending, green when more came in than out, dashed white for no transactions |
| `--pos` | #0A7D33 | money in, saved (bold in transaction tables) |
| category colours | `src/lib/category-colors.ts` | one fixed colour per category in every chart and list |

## Type
| Role | Font | Where |
|---|---|---|
| Display | Bricolage Grotesque 800, tight tracking (`--font-display`, class `.num-hero`) | h1, brand, hero numbers only |
| Everything else | Inter 400/500/600 (`--font-body`) | body, h2-h4 (600), buttons, tables |
| Amounts | body font, `font-variant-numeric: tabular-nums` (`.amount`, `.mono`) | no monospace |

Money is always `S$` with 2 decimals via `formatCents` (`src/lib/money.ts`).

## Shape
Cards: 24px radius, no border, soft shadow (`.card`, `.card-pad`). Buttons: pills (`.btn`, `.btn.ghost`).
Inputs: 12px radius. Content links: ink, bold, 2px underline. One heading style per card (`.card-title`, `.card-sub`).

## Ban list
Cards inside cards. Instruction hints ("click a slice", "hover a flow"). Red as a data colour. Monospace numbers.
Equal-weight tile grids for unequal facts. Emoji or symbol glyphs. Inline hex colours in components.

## Motion
Decorative art only: slow float, 6-8s loops, off under `prefers-reduced-motion`, hidden under 640px.
