---
date: 2026-06-14
topic: demo-dashboard
---

# Demo dashboard: a true all-surfaces demo at demo.html

## Summary

Build a dedicated `demo.html` that mounts every Tamper Signal browser surface
(status light, badge, the Data tab with "Take your data", inspector console)
over the demo chain, with a tamper toggle that flips them all green↔red at once
and a live in-browser export round-trip. Promote it as the front-door demo in the
nav; demote the homepage `#demo` to a teaser that links to it. Fully client-side
with a "Reset demo" button, no server.

## Problem Frame

The good demos are buried. The nav's "live demo" only scrolls to the homepage
`#demo` block, which shows a single surface (the status light) on a mock
dashboard. The four real surface demos (`badge/light.html`, `badge.html`,
`table.html`, `console.html`) live behind one card in the "explore" grid, three
clicks from anyone's attention. A visitor never sees the badge, the verified Data
tab, the console, the export, or the format-agnostic round-trip in one place, so
the product looks smaller than it is. The portability round-trip especially is
hard to grasp from prose; it wants to be watched.

## Key Decisions

- **`demo.html` is the front-door demo hub.** It holds the full interactive
  dashboard. The homepage `#demo` shrinks to a teaser (a live light plus a clear
  CTA to the full demo). The nav and the "Every piece, working" explore card both
  point to `demo.html`. The four `badge/*.html` pages stay reachable as
  deep-links, but `demo.html` is the entry.

- **Fully client-side, per-visitor, with a "Reset demo" button.** No server, no
  database, no shared state, no hourly reset. The demo resets per visitor on
  reload or button press. This reframes the original "resets every hour" idea: an
  hourly reset only makes sense for a shared backend sandbox, which would
  contradict the product's no-server claim. A stateless client-side demo
  *demonstrates that claim by existing*.

- **The tamper toggle swaps pre-baked chains, not free-edited data.** It flips the
  whole dashboard between the committed `examples/chains` fixtures (intact,
  tampered, gap), reusing the homepage switcher pattern, and drives every mounted
  surface at once. Free-form cell editing is out of v1.

- **The export round-trip is live in the browser.** Clicking "Take your data"
  downloads the bundle, and a panel re-verifies the same data as a different
  format using Web Crypto, showing the matching Semantic hash and a green light,
  with no server. The import / re-attest half is a copy-pasteable CLI snippet,
  because signing needs the private key and cannot run in the browser.

- **Export is disabled in the tampered state.** Consistent with the shipped Data
  tab (a verified bundle is offered only when green or yellow), so the live
  round-trip runs from green. The page names why, which is itself a teaching
  moment.

## Key Flows

- F1. Land on the dashboard
  - **Trigger:** A visitor opens `demo.html`.
  - **Steps:** All four surfaces mount over the demo chain and verify in the
    visitor's browser; the dashboard shows the verified (green) state.
  - **Covered by:** R1, R11

- F2. Flip the tamper toggle
  - **Trigger:** The visitor toggles to tampered (or the gap/yellow state).
  - **Steps:** Every surface re-renders from the swapped pre-baked chain at once —
    the light goes red, the badge red, the Data tab shows "not the attested data,"
    the console names the broken link.
  - **Covered by:** R5, R6

- F3. Export round-trip
  - **Trigger:** From the green state, the visitor clicks "Take your data."
  - **Steps:** The bundle (or rows-only file) downloads, and the round-trip panel
    re-verifies the same data as a different format in-browser, showing the
    matching hash and green. A CLI snippet shows the import / re-attest half.
  - **Covered by:** R7, R8, R9

- F4. Reset
  - **Trigger:** The visitor clicks "Reset demo" (or reloads).
  - **Steps:** The dashboard returns to the pristine verified state and clears the
    round-trip panel.
  - **Covered by:** R12

## Requirements

**Page and navigation**

- R1. `demo.html` mounts all four surfaces (status light, badge, Data tab with the
  "Take your data" export control, inspector console) over the demo chain.
- R2. The nav promotes `demo.html` as a first-class item; the current "live demo"
  entry links to it rather than scrolling to the homepage block.
- R3. The homepage `#demo` section becomes a teaser (a live light plus a clear CTA
  to `demo.html`) rather than the full demo.
- R4. The "Every piece, working" explore card points to `demo.html`; the four
  `badge/*.html` pages remain reachable as deep-links.

**Tamper toggle and surfaces**

- R5. A tamper toggle flips the whole dashboard between verified and tampered
  states (green↔red, plus the gap/yellow state), driving every mounted surface at
  once.
- R6. The toggle swaps the pre-baked committed chains (`examples/chains`
  intact/tampered/gap); it does not free-edit data.

**Export round-trip**

- R7. The Data tab's "Take your data" export works live (verified bundle or
  rows-only), exactly as it does anywhere the Data tab mounts.
- R8. A round-trip panel re-verifies the exported data as a different format in the
  browser (Web Crypto), showing the matching Semantic hash and a green light, with
  no server.
- R9. The import / re-attest half of the round-trip is shown as a copy-pasteable
  CLI snippet, not a live browser action.
- R10. In the tampered (red) state, the verified-bundle export is disabled and the
  page makes clear you cannot export a verified bundle of tampered data.

**State and reset**

- R11. The demo is fully client-side and per-visitor: no server, database, or
  shared state.
- R12. A "Reset demo" button restores the pristine verified state and clears the
  round-trip panel; a reload does the same.

**Copy**

- R13. All demo copy obeys `docs/MESSAGING.md`: continuity not correctness, the
  "really running in your browser, not a mockup" framing, no banned words.

## Acceptance Examples

- AE1. Toggle drives every surface. **Covers R5, R6.** Given the dashboard is
  green, when the visitor toggles to tampered, then the light, badge, Data tab, and
  console all show the broken state at once; toggling back returns them all to
  green.
- AE2. Live round-trip stays green. **Covers R8.** Given the green state, when the
  visitor clicks "Take your data," then the bundle downloads and the round-trip
  panel shows the same data re-verified as a different format with a matching hash
  and a green light.
- AE3. No verified export of tampered data. **Covers R10.** Given the tampered
  state, when the visitor looks at the export control, then the verified-bundle
  option is disabled with a clear reason (rows-only may still download, marked
  unverified).
- AE4. Reset restores pristine state. **Covers R12.** Given the visitor has toggled
  to tampered and/or run the round-trip, when they click "Reset demo," then the
  dashboard returns to the pristine green state with the round-trip panel cleared.

## Scope Boundaries

**Deferred for later**

- Free-form cell editing to craft arbitrary tampered states (the pre-baked toggle
  is v1).
- Retiring the individual `badge/*.html` pages (kept as deep-links for now).

**Outside this product's identity**

- A shared or social sandbox, or any server-backed demo state (and the hourly
  reset it would require). It contradicts the no-server stance the demo exists to
  prove.
- Browser-native import / re-attest. Signing needs the private key; the round-trip's
  return leg is shown as a CLI snippet.

## Dependencies / Assumptions

- Reuses the shipped browser surfaces (`mountTamperSignal`, the badge, the console,
  and `mountReceiptTable` with its "Take your data" export control) and the
  committed demo chains under `examples/chains/`.
- Assumes verification and the export round-trip are fully client-side (Web
  Crypto), which the existing surfaces already are.

## Outstanding Questions

**Deferred to planning**

- Exact nav label and structure ("Demo" vs keeping "live demo"), and whether the
  homepage `#demo` teaser keeps the green/yellow/red switcher or shows a single
  live light.
- Layout and responsive composition of the four surfaces on one page.
- Whether the round-trip panel re-verifies the visitor's actual downloaded file or
  an in-memory copy (the download is likely a convenience over an in-memory
  re-verification).

## Sources / Research

- `index.html` — `#demo` mock dashboard with the green/yellow/red switcher and
  `mountTamperSignal` (~line 700), the `#explore` card grid (~line 619), and the
  nav (~line 411).
- `badge/light.html`, `badge/badge.html`, `badge/table.html`, `badge/console.html`
  — the four standalone surface demos.
- `badge/table.js` — `mountReceiptTable` and the "Take your data" export control
  (shipped in #42/#44).
- `examples/chains/{intact,tampered,gap}` — the committed demo fixtures the toggle
  swaps between.
- `docs/MESSAGING.md` — copy rules (continuity not correctness, banned words).
