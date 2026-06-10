# Direction 01 — The Inline Status Light

## Rationale
Vibe-coded dashboards all look the same: light, rounded, pastel, trustworthy-by-default.
That sameness is the opportunity. The light is a tiny dark instrument that refuses to adopt
the host's theme — mono type, near-black panel (`#0b0f14`), signal colors straight from
`animations/src/theme.ts`. Like a wax seal or a tamper sticker, its value comes from being
recognizable across *any* app: if you've seen it once, you can read it anywhere in under a
second. Green = done thinking about it. Yellow/red = the seal itself tells you where to look.

The pill never editorializes about the host's numbers; it only attests the chain. In the red
state it additionally outlines the one host metric fed by the broken stage ("tamper signal:
unverified value") — the instrument reaching into the host page is the demo's money shot.

## Where the light lives
Default: right end of the host header, after the host's own controls — the slot users already
scan for account/status chrome. Fallbacks, in order: floating bottom-right corner badge
(no-header SPAs), and a static inline strip above the first chart (emails/exports). It should
always be the **only** dark element on the page; if the host app is dark-themed, the pill
inverts to a light panel to preserve the foreign-object effect.

## Why the seal aesthetic
- Trust marks work by consistency, not by blending in (padlock icon, blue check, UL sticker).
- The deliberate theme clash is an honesty signal: this element is *not* produced by the
  dashboard it judges. A verifier styled by the thing it verifies is less credible.
- Mono + short hashes (`4c81…d7`, same SHORT() form as `badge/badge.js`) read as "instrument,"
  not "widget," and stay consistent with the animations/blog material.

## API sketch
```js
// light.js — same contract as renderReceiptBadge(containerEl, chainUrl, pubKeyHex)
mountTamperSignal(hostEl, "/receipts/chain.json", pubKeyHex?)
// React: <TamperSignal chain="/receipts/chain.json" />
```
- Reuses badge.js verification core verbatim (Ed25519 via Web Crypto, canonical JSON,
  hash-link walk, totals delta). Only the rendering layer differs.
- States: `green` (sigs valid + links intact), `yellow` (loadable but incomplete: receipt
  coverage gap, unknown signing key, totals drift within links), `red` (hash mismatch or bad
  signature, with stage, expected/found hash, and totals delta from `totalsDelta()`).
- Python side needs zero code: serve the receipts dir statically + one template include.
- Optional `data-watch` attr: re-poll chain.json and pulse on state transitions.

## Open questions
1. Yellow taxonomy: coverage gap vs. unknown key vs. drift are very different severities —
   one amber state, or amber + distinct icons inside the popover?
2. Host metric flagging (red state) requires knowing which DOM nodes map to which chain
   columns. Manual `data-receipt-column` attrs? Ship without it for v1?
3. Dark-host inversion rule needs a real spec (luminance threshold? explicit `theme` prop?).
4. Popover currently shows last-verified time; should the pill itself decay (grey out) when
   the page has been open longer than some staleness budget?
5. Does the pill need a "verifying…" boot state for slow receipt fetches, and what does
   failure-to-load look like (badge.js uses amber "could not load chain")?

## Decisions (2026-06-10, v1 shipped as badge/light.js)
1. Yellow taxonomy: one amber state with a caveat list in the popover. The pill sub-label
   names the first caveat ("coverage gap" / "unknown key" / "totals drift"). The verifier
   detects coverage gaps (numbering jumps) and unrecognized signing keys; totals drift is
   opt-in (`warnDrift` / `--warn-drift`) because filters and aggregations legitimately move
   totals. Distinct severities stay open for v2.
2. Host metric flagging: shipped in v1 via manual `data-receipt-column` attrs. On red, the
   light flags elements whose column appears in the broken link's totals delta
   (numeric_sums / null_counts; row and column counts have no single column to point at).
3. Dark-host inversion: explicit `theme: "light"` option for now, no luminance detection.
4. Staleness decay: not built. The popover shows verified-at time; `watch` re-verifies on
   an interval and pulses on state transitions.
5. Boot and failure states: built. "CHECKING · verifying" on boot, then "UNVERIFIED ·
   <reason>" as the capability fallback (chain failed to load, or no Web Crypto Ed25519).
   It renders grey, never the yellow color: a fallback is not a verdict.
