# Battery payback

Which home battery pays for itself on your own meter data, once saldering ends in 2027? The page replays a year of hourly grid use and solar surplus through several home batteries (HomeWizard, Marstek, Zendure, Anker, EcoFlow, Sessy), each at every size it comes in, ranks them by profit, and shows what the chosen one saves per year, month and day.

Built with Vite and TypeScript, with no runtime dependencies. It's a static site, so it deploys to Vercel (or any static host) with no server code.

## Your data stays in your browser

First-time visitors get a start screen with three choices: fetch their data, upload a file, or explore a made-up sample household (also linkable as `/sample`). Returning visitors go straight to their stored results. The two ways to load your own data:

- **From their energy supplier, with a bookmarklet.** They drag a button to their bookmarks bar, log in to their supplier's site and click the bookmark. The bookmarklet runs there, in their own logged-in browser: it fetches the past year of hourly usage from the supplier's own API, opens this site in a new tab and hands the data over with `postMessage`. If that tab can't be reached (a popup blocker, for example), the data downloads as a CSV to upload instead. This site's server never sees a login or a meter reading, and the supplier only sees the same requests its own site makes. Clicking the bookmark again later fetches only the new days.
- **By uploading a CSV** with `timestamp,import_kwh,export_kwh`, one row per hour (ISO timestamps with an offset, for example `2026-06-01T12:00:00+02:00`).

Whatever is loaded is kept in `localStorage`, so the page shows the visitor's own numbers next time. They can download it as CSV or forget it from the "Load your data" dialog.

Supported suppliers: **Greenchoice**. See [Adding a supplier](#adding-a-supplier).

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:5173. In development the supplier list also has a **Demo supplier** that serves the sample household from http://127.0.0.1:5173, a different origin, so you can try the whole bookmarklet flow without an account: drag its button to your bookmarks bar, open http://127.0.0.1:5173 and click the bookmark.

```bash
npm test          # Vitest: simulation, Greenchoice parsing, dataset merging, message validation
npm run build     # type-check, then build to dist/
npm run sample    # regenerate public/data/sample-hourly.csv
```

## Deploy to Vercel

Import the repository in Vercel. It detects Vite and builds with `npm run build` into `dist/`; no settings or environment variables are needed. `vercel.json` sends every path that isn't a file to `index.html`, so links like `/sample` survive a reload.

## Paths

| Path | Shows |
| --- | --- |
| `/` | The start screen, or straight to `/results` when this browser has stored data |
| `/sample` | The results for the made-up sample household |
| `/results` | The results for your stored data |
| `/import/<supplier>` | Where the bookmark opens the tool to hand over your data |

Old links with `#sample` or `#import=<supplier>` are rewritten to these paths. The routing is `src/router.ts`, using the browser's History API.

## Adding a supplier

1. Create `src/providers/<id>/info.ts` with the supplier's `id`, `name`, `origin` (where the bookmarklet runs, for example `https://mijn.greenchoice.nl`) and `loginUrl`.
2. Create `src/providers/<id>/bookmarklet.ts` that calls `runBookmarklet` from `src/bookmarklet/runtime.ts` with a `fetchHours(range, onProgress)` that returns `[timestamp, importKwh, exportKwh]` rows for that supplier. Keep it polite: a few requests at a time, as the supplier's own site would make. `src/providers/greenchoice/` is the reference.
3. Add it to `PROVIDERS` in `src/providers/index.ts`, importing the bookmarklet with the `?bookmarklet` suffix. `plugins/bookmarklet.ts` bundles and minifies it into the link.
4. Add parsing tests with a trimmed real response, like `tests/import.test.ts` does for Greenchoice.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Page markup |
| `src/main.ts` | Wires the controls and renders every block |
| `src/simulate.ts` | CSV parsing, battery simulation and cost comparison (no DOM) |
| `src/charts.ts` | Dependency-free SVG charts and tooltips |
| `src/import.ts` | Loading data (sample, upload, bookmarklet handoff, local storage) and which screen shows |
| `src/router.ts` | Paths, Back and Forward, old hash links |
| `src/start.ts` · `src/start.css` | The start screen |
| `src/dataset.ts` | Stored dataset: merge, clean and save |
| `src/bookmarklet/` | Shared bookmarklet runtime and the message protocol with the page |
| `src/providers/` | One folder per supplier, plus the dev-only demo |
| `plugins/bookmarklet.ts` | Vite plugin that turns `?bookmarklet` imports into a minified script string |
| `public/data/` | Battery specs and prices, 2027 tariff presets, the sample household |
| `scripts/generate-sample.ts` | Generates the sample household |
| `tests/` | Vitest tests |

## Data formats

- **Tariffs** (`public/data/tariffs-2027.csv`): one row per supplier contract: `scenario,supplier,contract,import_eur_kwh,feedin_eur_kwh,feedin_cost_eur_kwh,net_export_eur_kwh,source_url,checked,note`. Grid prices include VAT and energy tax; `net_export_eur_kwh` is what a kWh sent back is worth after feed-in costs, the figure the calculation uses. The picker groups rows by `supplier` and shows `note`, the source and `checked` under it.
- **Batteries** (`public/data/batteries.csv`): one row per battery. Add a row to compare another one.
  - **Specs:** `unit_kwh`, `usable_share`, `charge_kw`, `discharge_kw`, `max_power_kw`, `standby_w`, `rated_cycles`, `warranty_years`.
  - **Efficiency curve:** `rte_200`, `rte_500`, `rte_800`, `rte_max`, the round-trip efficiency at 200 W, 500 W, 800 W and full power, as Tweakers measures it. Leave the low-power columns empty when only an 800 W figure is known; they're then estimated from the average drop Tweakers found.
  - **Combining units:** `power_scales` (1 if each extra unit adds power, 0 if it only adds storage) and `max_units`.
  - **Costs:** `first_unit_eur`, `extra_unit_eur`, `install_eur`.
  - **Meter:** `meter` (what the battery needs to read the grid meter), `meter_eur` (0 when included), `homewizard_p1` (1 if a HomeWizard P1 meter can stand in for it) and `meter_source`.
  - **Provenance:** `capacity_source`, `efficiency_source` and `standby_source` (`tweakers`, `review`, `manufacturer` or `assumed`), `price_source`, `review_url`, `notes`.
