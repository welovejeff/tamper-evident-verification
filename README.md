<sub>lineage-receipts</sub>

# The light is green, the data is clean.

Your social team exports a month of TikTok performance data. Someone vibe-codes a dashboard on top of it with an AI assistant in an afternoon. It looks great. Then a transform silently drops 22 rows, or the model hallucinates an aggregation, and the numbers in front of your boss are wrong. Nothing in that workflow catches it. This is the missing verification layer: every stage of the pipeline signs a receipt for what went in and what came out, and one command (or a badge on the dashboard itself) tells you whether the chain is intact, or exactly where it broke and by how much.

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

Honest status: the current MVP implements **green and red** (`lineage verify` PASS/FAIL plus the browser badge). Yellow is the designed next state, not shipped yet. The UI animations in this README (the light, the Data tab, the console) are design previews of the v1 interface, built from the working mockups in `designs/`. The badge does render an amber "verification unsupported" state today, but only for browsers without Web Crypto Ed25519; that is a capability fallback, not the yellow verdict.

## 60-second quickstart

Python 3.11+. Open source, `pip`-installable.

```bash
git clone <this repo> && cd tamper-evident-verification
pip install -e .
lineage demo
```

`lineage demo` runs the whole story end to end: generates a deliberately messy sample export, ingests it, runs two AI-written-style transforms, verifies the chain (PASS), then tampers with one spend value and verifies again (FAIL, pinpointing the broken link and the totals delta). It finishes by serving the badge at `http://localhost:8000/badge/badge.html` so you can see green and red side by side.

## CLI

```bash
lineage keygen --out keys/
lineage ingest sample_export.xlsx --origin "TikTok export, May 2026" --key keys/signing.key --out receipts/
lineage verify receipts/chain.json --pub keys/signing.pub --data dashboard.xlsx
```

Transforms record their own receipts by wrapping any list-of-dicts to list-of-dicts function:

```python
from lineage import lineage_step

@lineage_step(chain_dir="receipts/", key_path="keys/signing.key")
def transform_clean(records):
    return [r for r in records if r.get("campaign_name")]
```

The wrapper verifies the chain tail first, refuses to run if the input hash doesn't match it, runs the function, then signs and appends a receipt.

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
  dashboard data  <─── lineage verify: walk every link, check every signature
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

`badge/badge.js` exports `renderLineageBadge(containerEl, chainUrl, pubKeyHex)`. Drop it into any web frontend, point it at your `receipts/chain.json`, and it re-verifies the whole chain client-side with Web Crypto Ed25519: every signature, every hash link. No build step, no framework, no server-side trust. The badge re-checks hash links only; it does not re-canonicalize xlsx in the browser.

![Lineage badge: green intact chain and red broken chain](badge/badge-demo.png)

Green collapsed state reads like: `✓ Verified · TikTok export, May 2026 · 48,212 rows · 2 transforms · chain intact`. Expanding shows one row per receipt.

## Dashboards should show their work

We think any dashboard built on verified data should let you see the data. Not a tooltip, not an export-on-request: a Data tab, right next to the charts, showing the raw verified table the pretty numbers came from. If the chain is intact and the light is green, there is no reason to hide the rows, and if you find yourself wanting to hide them, that's worth sitting with. A chart asks you to believe; a table lets you check. Green light, open table: that's the whole standard.

![The Data tab: the dashboard flips to a dark raw-table view where a broken chain is localized to the views column](docs/media/data-tab.gif)

*Design preview: install the verification layer and your dashboard grows a Data tab. When the chain breaks, the break is localized to the column and total that no longer verify, right in the table.*

## What this proves, and what it doesn't

This proves **continuity, not correctness**. It can't tell you the data is right, but it can prove nobody changed it. The chain shows the dashboard numbers descend from the ingested export through a known sequence of code, and it locates the exact stage where a number changed unexpectedly. If the source export is itself wrong, the chain faithfully verifies wrong numbers. It is not a data-quality tool.

Also worth knowing: the signing key lives on your machine, and today that local Ed25519 keypair is the whole root of trust. Anyone holding the key can sign a fresh, internally consistent chain. External anchoring (below) is what closes that gap.

## Roadmap

- **Yellow state.** Surface "verifiable with caveats" in `verify` and the badge: receipt coverage gaps, unrecognized keys, control-total drift flagged for human review.
- **Node-native integration.** Today the pipeline tooling is Python (`pip install -e .`); the badge already runs in any web frontend. A Node package for receipt creation in JS pipelines is planned. There is no npm package yet.
- **External anchoring.** Sigstore transparency logs or RFC 3161 timestamps, so a chain can't be silently re-signed after the fact. The attachment points are already marked `FUTURE:` in `lineage/keys.py` and `lineage/receipts.py`.
- **Verification console.** A devtools-for-data window: the receipt chain as an inspectable pipeline, an event log of verify runs, and the break pinned at the severed link.

![The verification console: a pipeline of signed receipts where a tampered stage severs the chain at the exact link](docs/media/console.gif)

*Design preview of the verification console: calm when green, surgical when red.*

## Relation to OpenLineage, dbt, and Great Expectations

Those tools model lineage and quality at the warehouse and orchestration layer. This is narrower and lighter: a signed, file-based receipt chain you can drop in front of an ad-hoc, vibe-coded xlsx-to-dashboard pipeline without a database, a server, or a metadata catalog. A complement for the gap before those tools are in place, not a replacement.

## Contributing

Open source, designed to be added to any vibe-coded data project. The Python package is in `lineage/`, tests in `tests/` (run `pytest`), examples in `examples/`, the badge in `badge/`. Issues and PRs welcome. The original Luhn hash demo lives unchanged in `legacy/` and is off the main path.
