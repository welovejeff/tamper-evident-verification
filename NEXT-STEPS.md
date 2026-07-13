# Next Steps — Tamper Signal (formerly lineage-receipts)

> **Status update, 2026-07-11 (the Signal Room, 2.1.0):** the UI unification
> shipped — one light, one room (`badge/room.js`), table/console as
> room-backed shims, attach helpers serving the room and pre-wiring the
> light's `receiptsHref`. The deferred design-board items landed in the same
> release: `exportTable: true` on `rebuildChain()` / `write_table=True` on
> the final `@receipt_step` stage write `table.json` as the last pipeline
> step, and both verify CLIs print a stderr-only reminder when a published
> `table.json` went stale (absence stays deliberately silent — CLI-only
> projects never publish a table — and `--json` stdout is untouched).

Handoff outline for the next work session. Written 2026-06-10, after commit
`fa676bd` (the traffic-light repositioning) was pushed to main.

> **Status update, later on 2026-06-10:** items 1-3 are done and committed
> locally (not yet pushed): MIT LICENSE, the yellow verdict in `receipts
> verify` + badge.js (exit codes 0/1/2, caveats for coverage gaps and
> unrecognized keys, opt-in `--warn-drift`), and the inline status light
> (`badge/light.js`, React wrapper, live demo at
> `badge/light.html`, all states verified in-browser). Item 4 is half done:
> the blog post is written at
> `docs/blog/your-vibe-coded-dashboard-needs-receipts.md` with the explainer
> GIFs committed to docs/media; the TikTok VO recording still needs a human
> voice over `animations/out/*-vertical.mp4` using `animations/VO-SCRIPT.md`
> (all three vertical MP4s are rendered and ready). Items 5 and 6 remain.
> The yellow taxonomy open question was resolved as one amber state with a
> caveat list; decisions recorded in `designs/01-NOTES.md`.
>
> **Rename (later still on 2026-06-10):** the product is now **Tamper Signal**
> ("lineage" was retired as a brand word; rationale in `docs/MESSAGING.md`
> section 0). CLI is `receipts`, Python package/import is `tamper_signal`,
> pip name is `tamper-signal`, JS APIs are `mountTamperSignal` /
> `<TamperSignal />` / `renderReceiptBadge` / `verifyReceipts`, host attr is
> `data-receipt-column`. The repo slug and Pages URL are unchanged. The
> references to `lineage ...` commands and `mountLineageLight` below are
> historical. A GitHub Pages landing page with a live verification
> playground also shipped (index.html, examples/chains/, AGENTS.md).
>
> **Tier 1 shipped (2026-06-10, evening):** CSV/TSV/JSON/NDJSON ingest with a
> numeric-text canonicalization fix (spec 1.1), pandas DataFrame support in
> receipt_step, the <tamper-signal> web component, and the Node package
> (receiptStep, tamper-signal CLI, byte-identical canonicalization proven by
> golden vectors; chains interop across stacks). tamper-signal@1.2.0 is
> PUBLISHED ON NPM. Tiers 2-4 are GitHub issues #2-#14. Remaining release
> work: PyPI (needs an account + trusted-publisher config on pypi.org, then
> tag v1.2.x to trigger .github/workflows/release.yml), and an NPM_TOKEN
> secret or npm trusted publishing for future automated npm releases.
>
> **End of day 2026-06-10:** Tiers 2 and 3 shipped (v1.3.0, v1.4.0; PyPI
> auto-publishes; npm blocked on token permissions, issue #15). The TikTok
> VO is RECORDED (item 4 fully done). tampersignal.com DNS is fixed and
> serving; the TLS cert is provisioning, after which the in-browser demos
> work on the custom domain (Web Crypto needs a secure context) and
> "Enforce HTTPS" should be ticked in Pages settings. Remaining: Tier 4
> hardening issues #11-#14, npm token #15.

## Where things stand

- **Repo**: github.com/welovejeff/tamper-evident-verification (local: ~/Sites/tamper-evident-verification)
- **What it is**: signed data lineage receipts. Every pipeline stage signs a receipt; `lineage verify` reports an intact chain or the exact broken link with the control-totals delta. Python package in `lineage/`, browser badge in `badge/`, tests pass via `pytest`.
- **The story**: "The light is green, the data is clean." Green/red are shipped (verify + badge); yellow is designed, not built. The full copy system lives in `docs/MESSAGING.md`; domain vocabulary in `CONCEPTS.md`.
- **The honesty rule that governs everything**: this proves continuity, not correctness. Never claim it "ensures accuracy." There is no npm package yet; don't promise one.
- **Visual assets**: three explainer animations + three UI showcase GIFs in `animations/` (Remotion, nine outputs via `npm run render:all`). Showcase GIFs are committed in `docs/media/` and embedded in the README. UI mockups in `designs/` (3 HTML files + notes). VO script in `animations/VO-SCRIPT.md`.

## Next steps, in rough priority order

### 1. Add a LICENSE file (quick win, do first)
The README and repo description say "open source" but there is no LICENSE file,
so legally it isn't yet. Pick one (MIT fits the drop-in ethos) and commit it.

### 2. Implement the yellow state (core product work)
The designed-but-unshipped middle verdict: "The light is yellow, a human should look."
- Semantics (already settled, see README + `docs/MESSAGING.md`): receipt coverage
  gaps, unrecognized signing key, control-total drift. Yellow never blames; it asks for eyes.
- Surface it in `lineage verify` output and in `badge/badge.js` (note: the badge's
  existing amber state means "browser can't verify," a capability fallback — keep it
  distinct from the yellow verdict).
- Open question from `designs/01-NOTES.md`: yellow severity taxonomy.

### 3. Build the inline status light (v1 UI)
The chosen first UI direction (see `designs/01-inline-light.html` + `01-NOTES.md`).
It's nearly an evolution of the existing `badge/badge.js` verification core:
- API sketch: `mountLineageLight(el, "/receipts/chain.json")`, same arg contract
  as `renderLineageBadge`, plus a `<LineageLight />` React wrapper.
- The Data tab (`designs/03-*`) and verification console (`designs/02-*`) are the
  later tiers; their NOTES files carry the integration sketches and open questions.

### 4. Ship the content (marketing work, assets are ready)
- TikTok: record VO over `animations/out/problem-vertical.mp4`, `how-vertical.mp4`,
  `proof-vertical.mp4` using `animations/VO-SCRIPT.md` (timecoded; cold-open hook
  included). If out/ is empty, `cd animations && npm install && npm run render:all`.
- Blog post: embed `out/problem.gif`, `how.gif`, `proof.gif`. Title candidate from
  MESSAGING.md: "Your vibe-coded dashboard needs receipts." Don't promise npm.
- The tagline, secondary lines, and banned vocabulary are all in `docs/MESSAGING.md`.

### 5. Node package (roadmap)
Receipt creation for JS pipelines (the badge already verifies in any frontend).
Mirror the Python API: keygen / ingest / verify / a wrap-this-transform helper.
The JCS canonicalization in `badge/badge.js` is already byte-identical to Python's.

### 6. External anchoring (roadmap, later)
Sigstore transparency logs or RFC 3161 timestamps so a chain can't be silently
re-signed. Attachment points are marked `FUTURE:` in `lineage/keys.py` and
`lineage/receipts.py`. Closes the "local keypair is the whole root of trust" gap.

## Working conventions for the next session

- No em dashes in README or public copy (rule recorded in UPDATE.md and MESSAGING.md).
- Compounded learnings go in `docs/solutions/` via /ce-compound; check
  `docs/solutions/design-patterns/multi-format-remotion-scene-pattern.md` before
  touching the animations.
- Remotion scenes: all timing in seconds × fps, all sizing × scaleOf, no
  Math.random/Date.now. QA via `npx remotion still --frame=N`.
- Keep fake demo data coherent across artifacts: same shortHash seeds, same
  incident numbers (rows -22, views -24,889).
