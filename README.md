<sub>tamper-signal</sub>

# The light is green, the data is clean.

[![PyPI](https://img.shields.io/pypi/v/tamper-signal)](https://pypi.org/project/tamper-signal/) [![npm](https://img.shields.io/npm/v/tamper-signal)](https://www.npmjs.com/package/tamper-signal) [![Socket Badge (npm)](https://badge.socket.dev/npm/package/tamper-signal/2.0.0)](https://socket.dev/npm/package/tamper-signal/overview/2.0.0) [![Socket Badge (PyPI)](https://badge.socket.dev/pypi/package/tamper-signal/2.0.0)](https://socket.dev/pypi/package/tamper-signal/overview/2.0.0) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Your social team exports a month of TikTok performance data. Someone vibe-codes a dashboard on top of it with an AI assistant in an afternoon. It looks great. Then a transform silently drops 22 rows, or the model hallucinates an aggregation, and the numbers in front of your boss are wrong. Nothing in that workflow catches it. This is the missing verification layer: every stage of the pipeline signs a receipt for what went in and what came out, and one command (or a badge on the dashboard itself) tells you whether the chain is intact, or exactly where it broke and by how much.

**Live demo:** [tampersignal.com](https://tampersignal.com/) re-verifies a real committed receipt chain in your browser: swap in a tampered chain or an untrusted key and watch the light catch it.

**Pointing a coding agent at this repo?** `AGENTS.md` is the full integration runbook: install, keygen, ingest, wrap transforms, mount the signal, verify. Tell your agent "add tamper signal" and it will find it.

## The problem

Vibe-coded pipelines fail silently. AI-generated transform scripts work most of the time, and when they don't, they don't crash. They drop rows. They double-count. They coerce a column wrong and quietly shift every total. The dashboard still renders. The chart still looks plausible. Nobody re-checks 48,000 rows by hand.

Traditional answers (warehouse lineage, dbt, data-quality suites) assume infrastructure a small team running xlsx-to-dashboard doesn't have. This is the lightweight version: signed receipts as files on disk, no database, no server, no catalog.

## The traffic light

The badge and the verifier reduce the whole chain to one state:

- 🟢 **Green.** Every link in the receipt chain verifies. Every signature is valid. The data made it from the original export to the dashboard unchanged.
- 🟡 **Yellow.** Verifiable, but with caveats: gaps in receipt coverage, an unrecognized signing key, or control-total drift that needs a human look.
- 🔴 **Red.** Chain broken. A hash doesn't match at a specific link. You get the exact stage and the control-totals delta (e.g. `row_count 48212 -> 48190 (-22)`).

![The inline status light cycling green, yellow, and red inside a host dashboard, then flagging the unverified metric](docs/media/light.gif)

*The inline status light: a small dark instrument in your dashboard's header. When the chain breaks, it reaches into the page and flags the exact metric that no longer descends from the source.*

Honest status: all three verdicts are implemented in `tamper-signal verify` and the browser surfaces. Yellow today covers two detectable caveats (a coverage gap in the receipt numbering, and signatures that only verify under the chain's embedded key rather than the key you trust) plus opt-in control-total drift via `--warn-drift`. The animations in this README are renders of the design mockups in `designs/`; the interfaces they depict have since shipped and, as of 2.1, unified. The surfaces also render a separate grey state ("could not load" or "verification unsupported in this browser"); that is a capability fallback that says nothing about the chain, not the yellow verdict.

## One light, one room

The browser UI is two things, always shipped together. **The light** (`badge/light.js`) is the whole footprint on your dashboard: a small dark pill in the header. **The room** (`badge/room.js`, since 2.1) is the one surface behind it, where the pill's "view receipts →" lands: the attested data table as the landing plane — re-hashed in the viewer's browser against the final receipt — with the chain as a provenance rail, the break exhibit in business numbers when something is wrong, and the receipt inspector, CLI-mirror event log, chain-of-custody timeline, and "Take your data" evidence export one drawer away. Green earns silence; the layout leads with whatever the verdict demands. The attach helpers serve the room automatically and wire the light to it, so the default integration is both halves in one call. (`tamper-signal/table` and `tamper-signal/console` from 2.0 keep working as room presets.)

## 60-second quickstart

Python 3.11+. Open source (MIT).

```bash
pip install tamper-signal
git clone https://github.com/welovejeff/tamper-evident-verification && cd tamper-evident-verification
tamper-signal demo
```

`tamper-signal demo` runs the whole story end to end: generates a deliberately messy sample export, ingests it, runs two AI-written-style transforms, verifies the chain (PASS), then tampers with one spend value and verifies again (FAIL, pinpointing the broken link and the totals delta). It finishes by serving the badge at `http://localhost:8000/badge/badge.html` so you can see green, yellow, and red side by side.

> **`tamper-signal: command not found`?** pip installed the script into a bin directory that is not on PATH (common on the python.org framework Python, the default macOS download). Either run it through the same interpreter, `python3 -m tamper_signal verify ...` (works as a drop-in for every `tamper-signal ...` command), or link it onto PATH once: `sudo ln -sf "$(python3 -c 'import sysconfig;print(sysconfig.get_path("scripts"))')/tamper-signal" /usr/local/bin/tamper-signal`.

## CLI

```bash
tamper-signal init                 # scaffold: keys, .gitignore safety, receipts dir (idempotent)
tamper-signal ingest sample_export.xlsx --origin "TikTok export, May 2026" --key keys/signing.key --out receipts/
tamper-signal verify receipts/chain.json --pub keys/signing.pub --data dashboard.xlsx
tamper-signal diff                 # compare two runs: code-hash changes and totals deltas (read-only)
tamper-signal log                  # archived run history as a per-metric trend across runs (read-only)
tamper-signal doctor               # integration self-check with actionable fixes
tamper-signal serve                # serve receipts/ on localhost with CORS (dev only)
tamper-signal assets --out badge/  # vendor the browser surfaces (light/badge/element/table/console/room.js) into a project
tamper-signal annotate --reason "backfill approved" --author dana   # sign a reason onto a receipt (chain of custody)
tamper-signal watch --config feed.json --out receipts/   # poll a live feed onto the chain (needs [watch]; see below)
```

`--pub` repeats for key rotation (any trusted key verifies), and `TAMPER_SIGNAL_KEY` can carry the PEM private key in CI so no key file touches disk. `ingest` and `verify --data` accept .xlsx, .csv, .tsv, .json (array of objects), and .ndjson; the semantic hash is identical across formats, so an xlsx ingest verifies against a CSV copy of the same data. `verify` exits with the traffic light: 0 green, 1 red, 2 yellow (verifies, with caveats). Add `--warn-drift` to also flag any control-totals movement across links as a caveat; it is off by default because filters and aggregations legitimately move totals. `--json` emits a structured verdict (schema in `AGENTS.md`) for CI and coding agents.

For a recurring refresh of the same report, declare a tolerance at ingest with `--band` (default 5%) and `--settle` (default 72h), optionally keyed off a date column with `--bucket-column`. The declaration is signed into the source manifest. Every non-red `verify` then archives a run snapshot under `receipts/history/`, and the next verify judges this run against that memory: recent buckets may drift within the band, settled buckets (older than the window) may not, and any breach is a yellow caveat. `tamper-signal diff` and `tamper-signal log` read that history (both read-only, exit 0) to show what moved between runs and the per-metric trend across them. History is CLI-local and weaker evidence than the chain: it stays out of `receipt_hashes` and anchoring, and `serve` never exposes it.

Transforms record their own receipts by wrapping any list-of-dicts to list-of-dicts function:

```python
from tamper_signal import receipt_step

@receipt_step(chain_dir="receipts/", key_path="keys/signing.key")
def transform_clean(records):
    return [r for r in records if r.get("campaign_name")]
```

The wrapper verifies the chain tail first, refuses to run if the input hash doesn't match it, runs the function, then signs and appends a receipt. Transforms can also take and return pandas DataFrames; frames are hashed as records and pass through untouched.

## JavaScript pipelines

The same receipts, native to Node (18.17+): `npm install tamper-signal` provides a `tamper-signal` CLI (keygen, ingest, verify, with the same exit codes) and a programmatic API. Chains are interchangeable across the two stacks; the canonicalization is byte-identical, proven by golden vectors generated from the Python side.

```js
import { receiptStep, loadCsv } from "tamper-signal";

const clean = receiptStep(
  (records) => records.filter((r) => r.campaign_name !== null),
  { chainDir: "receipts/", keyPath: "keys/signing.key" }
);
const output = await clean(loadCsv("export.csv"));
```

JavaScript reads .csv, .tsv, .json, and .ndjson; spreadsheets go through the Python CLI. The browser surfaces ship in the same package: `tamper-signal/light`, `tamper-signal/room`, `tamper-signal/element`, `tamper-signal/react` (plus the 2.0 `tamper-signal/table` and `tamper-signal/console`, now room presets).

## How the chain works

```
TikTok/Sprinklr export.xlsx
        |
        v
  [ingest] ──────────> 000_source.json        evidence hash + semantic hash + totals, signed
        |
        v
  [transform_clean] ─> 001_transform_clean.json    input hash == previous output hash
        |
        v
  [transform_agg]  ──> 002_transform_aggregate.json
        |
        v
  dashboard data  <─── tamper-signal verify: walk every link, check every signature
```

Each receipt contains the SHA-256 of its input, the SHA-256 of the transform's source code, the SHA-256 of its output, and human-legible control totals (row counts, numeric sums, date ranges, null counts). Receipts link because each stage's input hash must equal the prior stage's output hash. Everything is signed with Ed25519; `chain.json` is just an ordered list of receipt files plus the public key.

Two hashes exist per artifact. The **evidence hash** anchors the raw file bytes at ingest. The **semantic hash** covers the canonicalized data content, stable across format round-trips (xlsx re-save, xlsx to CSV, xlsx to JSON) so long as the values are unchanged. Row order is not part of integrity: rows are sorted before hashing.

When verification fails, you don't get a shrug. You get the link:

```
✗ CHAIN BROKEN at link 1 -> 2 (transform_aggregate)
  expected input hash a3f1...9c  (output of transform_clean)
  found    input hash 77b2...d4
  Control totals delta vs upstream: row_count 48212 -> 48190 (-22), spend_(usd) -98.40
```

Hashes say "broken." Totals say "how broken."

## The badge

`badge/badge.js` exports `renderReceiptBadge(containerEl, chainUrl, pubKeyHex)`. Drop it into any web frontend, point it at your `receipts/chain.json`, and it re-verifies the whole chain client-side with Web Crypto Ed25519: every signature, every hash link. No build step, no framework, no server-side trust. The badge re-checks hash links only; it does not re-canonicalize xlsx in the browser.

![Receipt badge: green intact chain and red broken chain](badge/badge-demo.png)

Green collapsed state reads like: `✓ Verified · TikTok export, May 2026 · 48,212 rows · 2 transforms · chain intact`. Expanding shows one row per receipt.

## The signal: an inline status light

`badge/light.js` is the v1 dashboard UI: a small dark pill that mounts in your header, runs the same in-browser verification as the badge, and shows the verdict as the light. It deliberately refuses to adopt your dashboard's theme; like a tamper sticker, its value comes from being recognizable anywhere. One call:

```html
<script type="module">
  import { mountTamperSignal } from "/badge/light.js";
  mountTamperSignal(document.querySelector("header"), "/receipts/chain.json");
</script>
```

React, with a bundler: `import { TamperSignal } from "tamper-signal/react"` and `<TamperSignal chain="/receipts/chain.json" />`. Everything else (Vue, Svelte, plain HTML): import `tamper-signal/element` and write `<tamper-signal chain="/receipts/chain.json"></tamper-signal>`.

The pill expands to a popover: the per-stage table when green, the caveat list when yellow, the broken link with its totals delta when red. In the red state the light also reaches into the page: give any metric element a `data-receipt-column="spend_usd"` attribute, and if that column moved at the broken link the element gets outlined and tagged `tamper signal: unverified value`. Mark up your metrics once and the light flags the exact number that no longer descends from the source.

Options on the fourth argument: `watch` (re-verify every N ms and pulse on transitions), `warnDrift`, `receiptsHref`, and `surface: "dark"` so the pill inverts to stay the one foreign object on a dark host (`surface` describes your page; `invert: true` is a shortcut for it, and the deprecated `theme: "light"` is the same thing). `tamper-signal demo` serves a live three-state example at `http://localhost:8000/badge/light.html`.

One-call framework helpers serve the receipts directory and the browser files together and hand back the mounting snippet: `tamper_signal.flask_ext.attach(app)`, `tamper_signal.fastapi_ext.attach(app)`, and `tamperSignal(app)` from `tamper-signal/express`. Streamlit apps get a server-side-verified pill and table caption via `tamper_signal.streamlit_ext` (labeled as the weaker check it is).

## Dashboards should show their work

We think any dashboard built on verified data should let you see the data. Not a tooltip, not an export-on-request: a Data tab, right next to the charts, showing the raw verified table the pretty numbers came from. If the chain is intact and the light is green, there is no reason to hide the rows, and if you find yourself wanting to hide them, that's worth sitting with. A chart asks you to believe; a table lets you check. Green light, open table: that's the whole standard.

It ships: `tamper-signal export` writes the canonical table document next to the chain (refusing data that does not match the final receipt), and `mountReceiptTable(el, "/receipts/chain.json")` from `badge/table.js` (npm: `tamper-signal/table`) renders it after re-hashing it in the viewer's browser against the final receipt. VERIFIED means the rows on screen are byte-for-byte the attested data; a stale or edited table.json renders dimmed under a "not the attested data" strip, and a broken chain flags the columns that moved at the break. Live demo: `badge/table.html`.

![The Data tab: the dashboard flips to a dark raw-table view where a broken chain is localized to the views column](docs/media/data-tab.gif)

*Design preview: install the verification layer and your dashboard grows a Data tab. When the chain breaks, the break is localized to the column and total that no longer verify, right in the table.*

## Take your data with you

Verified data should be portable, proof and all. `tamper-signal export --bundle` (or `tamper-signal export --bundle`) writes a verified bundle: a zip of the data file plus `chain.json` and its receipts, kept byte for byte, so whoever you send it to runs `tamper-signal verify chain.json` and gets the same light, offline. In the browser, the Data tab's "Take your data" control exports the attested data client-side as that bundle or as a bare rows-only file (csv/tsv/json/ndjson; xlsx routes through the Python CLI). Because the semantic hash is format-agnostic, a CSV you export here re-verifies as JSON and the light stays green; numeric-looking text canonicalizes to its number, so leading zeros and trailing decimals do not survive the round trip.

To bring an updated file back, `tamper-signal ingest --as replace|period`. `replace` (the default) re-signs a fresh chain and archives the prior one under `receipts/archive/`. `period` continues the chain's run history as the next period, judged against prior runs through the prior run's signed tolerance band; it continues only under a trusted signer (`--pub` to trust a key other than the chain's) and refuses an untrusted one rather than appending silently. Re-attestation is never silent: the importer's identity is recorded, and an unrecognized signer stays yellow.

## The console

The light answers "is it fine?"; the console answers "where, exactly, and by how much?" `mountReceiptConsole(el, "/receipts/chain.json")` from `badge/console.js` (npm: `tamper-signal/console`) renders the chain as an inspectable pipeline: links carry the hash they proved, a break severs the link with the break card pinned at it, coverage gaps appear as ghost nodes at their position, and the event log mirrors `tamper-signal verify` line for line. Every attach helper also serves it ready-made at `/tamper-signal/console`. Live demo: `badge/console.html`.

![The verification console: a pipeline of signed receipts where a tampered stage severs the chain at the exact link](docs/media/console.gif)

*The verification console: calm when green, surgical when red.*

Below the pipeline the console renders the **chain of custody**: the imports and changes, each signed reason attached to the receipt it explains (`tamper-signal annotate`), and any changes **awaiting human review**. It is an additive layer over the published `timeline.json` — it never feeds the verdict above.

## Live-source watcher (optional)

When the source is a live feed rather than a file you re-export by hand, the watcher keeps it on the same signed chain. `tamper-signal watch` (behind `pip install "tamper-signal[watch]"`) polls an HTTP/JSON-API or RSS/Atom endpoint, judges the new data against the declared band/settle, and **auto-appends only a clean change**. A retroactive edit to an already-settled period — or a slow drift that cumulatively breaches the band — is never signed unattended: it is withheld as a signed *pending event* and paused for a human.

```bash
pip install "tamper-signal[watch]"
tamper-signal watch --config feed.json --key keys/watch.key --out receipts/   # one tick
tamper-signal review                                                          # list withheld changes
tamper-signal review accept <hash> --reason "confirmed by finance"            # sign off + commit
```

The fetch is SSRF-hardened (public hosts only, redirects off, TLS verified, byte + wall-clock caps; RSS parsed through `defusedxml`), change detection uses a full-content fingerprint rather than a trust-me `ETag`, and the unattended commit is crash-safe. The recommended deployment is the stateless tick under a systemd timer or cron, so the signing key is not resident between runs — see `AGENTS.md` §5c for a hardened unit. `watch`/`review` are Python-only today; the chains they write are read and verified by the JavaScript stack unchanged.

## Anchoring (optional)

`pip install "tamper-signal[anchor]"`, then `tamper-signal anchor` signs the exact bytes of chain.json into the public Sigstore transparency log under your OIDC identity (browser login locally, automatic in GitHub Actions). Because chain.json records the sha256 of every receipt file, the anchor covers the receipts themselves, not just their names. `tamper-signal verify --anchor` then proves this exact chain, receipts included, existed at the logged time, independent of the signing key, closing the "whoever holds the key can quietly re-sign everything" gap for the moments that matter. A missing anchor is a yellow caveat; a chain that changed after anchoring is red.

## What this proves, and what it doesn't

This proves **continuity, not correctness**. It can't tell you the data is right, but it can prove nobody changed it. The chain shows the dashboard numbers descend from the ingested export through a known sequence of code, and it locates the exact stage where a number changed unexpectedly. If the source export is itself wrong, the chain faithfully verifies wrong numbers. It is not a data-quality tool.

Also worth knowing: the signing key lives on your machine, and day to day that local Ed25519 keypair is the root of trust. Anyone holding the key can sign a fresh, internally consistent chain; anchoring (above) is what closes that gap when it matters.

## Roadmap

- **Richer yellow taxonomy.** Yellow currently detects coverage gaps, unrecognized signing keys, and opt-in totals drift. Distinct severities and smarter drift heuristics are open questions (see `designs/01-NOTES.md`).


## Relation to OpenLineage, dbt, and Great Expectations

Those tools model lineage and quality at the warehouse and orchestration layer. This is narrower and lighter: a signed, file-based receipt chain you can drop in front of an ad-hoc, vibe-coded xlsx-to-dashboard pipeline without a database, a server, or a metadata catalog. A complement for the gap before those tools are in place, not a replacement.

## Contributing

Open source under the MIT license (see `LICENSE`), designed to be added to any vibe-coded data project. The Python package is in `tamper_signal/`, tests in `tests/` (run `pytest`), examples in `examples/`, the badge in `badge/`. Issues and PRs welcome. The original Luhn hash demo lives unchanged in `legacy/` and is off the main path.
