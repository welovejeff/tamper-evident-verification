# Direction 3 — The Enforced Data Tab

## Rationale
The other two directions decorate the dashboard; this one changes its shape. Installing
lineage-receipts means your dashboard grows a permanent second tab — the raw table behind
every chart. The stance is the feature: no chart without an inspectable table, and the
table is where verification *points*. A green badge floating in a corner says "trust us";
a forced Data tab says "look for yourself." The tab flip is staged as flipping a cabinet
open — the whole window goes dark, sans-serif becomes mono, marketing becomes wiring.
Same app, suddenly showing its receipts.

Design choices worth defending:
- The injected tab keeps our mono/dark identity even inside the host's light tab bar
  (mono label, 🧾, traffic dot, "· lineage-receipts" micro-attribution). It should look
  slightly foreign — that's honest about what it is.
- The verification dot lives ON the tab label, so even users who never click it see
  state change from the Dashboard view. Red is visible before you open the cabinet.
- Totals row is pinned and labeled "control totals, signed" — totals are computed over
  the full verified set, not the 15 visible rows. The break detail reads like a diff:
  expected / found / Δ / row count Δ.

## How injection works
- **Node**: `lineageReceipts(app, { chain: "receipts/chain.json" })` — Express/Next
  middleware serves `/__data` (the tab content + verifier JS) and injects a small
  script into the host's HTML responses that registers the tab in (or creates) the
  nav bar. React flavor: `<LineageProvider>` wraps the app, `useLineageTab()` mounts
  the route; charts registered via `<VerifiedChart table={...}>` feed the table view.
- **Python**: Flask/FastAPI extension adds the `/__data` route + a Jinja include
  (`{% include "lineage/tab.html" %}`) for the tab button; Streamlit/Dash get a
  first-class component (`lineage.data_tab(chain_path)`).
- Verification always re-runs client-side (same as badge.js): fetch chain.json,
  check hash links + ed25519 signatures in the browser. The tab never trusts the
  server's claim that the server is honest.

## How granular verification can honestly get
We verify **file/stage-level hashes + signed column control totals** (sums, row counts).
We do NOT have per-row or per-cell signatures, so:
- Green means: the chain of artifacts is intact and totals match — continuity, not
  source correctness (same caveat as the badge).
- Red localizes to *column + total + stage*: "views expected 1,284,003, found
  1,259,114, Δ −24,889, rows −22, broke after stage 1." The full-column tint says
  "the discrepancy lives somewhere in this column," not "these cells are forged."
- Yellow is for chain gaps: a stage that emitted no receipt makes its *derived*
  columns unverifiable; raw columns stay verified. Copy says "unverifiable," never
  "tampered."
The table view's job is to make hash-level facts *locatable*, not to overclaim
per-cell crypto. The footer states this limit explicitly in the UI.

## Open questions
1. Tab injection vs. host routing: SPAs with client routers may fight the injected
   tab — do we require a one-line component mount as the supported path?
2. Big data: 48k rows can't ship to the browser. Paginate from a verified parquet
   slice? Then visible rows are samples — how do we keep "this table IS the chart" true?
3. Which control totals? Sum/count are cheap; do we add per-column min/max/checksum
   so more tamper shapes are catchable?
4. Can the host theme the Data tab? Proposal: colors no, structure no — the tab being
   visually ours is part of the tamper-evidence.
5. Multi-chart dashboards: one Data tab with a table per chart, or sub-tabs per source?
