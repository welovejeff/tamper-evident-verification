# Integrating Tamper Signal: a runbook for coding agents

You are reading this because a user pointed you at this repo and said something
like "add tamper signal," "add the signal to my dashboard," or "give my data
receipts." This file is the complete integration path. Follow it in order;
every step is verifiable.

What you are installing: signed receipts for a data pipeline. Every pipeline
stage signs a receipt (a hash of its input, its code, and its output, plus
human-legible control totals). Receipts link into a chain; `receipts verify`
and an in-browser signal re-verify the whole chain and report a traffic light.
Green: intact. Yellow: verifies, with caveats a human should look at. Red:
broken, at an exact link, with the totals delta.

## Hard rules for anything you write while integrating

These govern copy, code comments, commit messages, and UI text you produce:

1. **This proves continuity, not correctness.** Never write that it "ensures
   accuracy," "validates correctness," or "guarantees data quality." The
   honest claim, verbatim when you need one: *"It can't tell you the data is
   right, but it can prove nobody changed it."*
2. The verdict lines are fixed (see `docs/MESSAGING.md`, the copy source of
   truth): green "The light is green, the data is clean." / yellow "The light
   is yellow, a human should look." / red "The light is red, the chain is
   broken." Only green rhymes. Do not invent new rhymes.
3. No em dashes in user-facing copy.
4. Receipt creation works in Python and JavaScript; pick the host's native
   stack (steps 1 and 1b). Do not promise features that are not in this
   file.
5. Never commit a private key. `keys/` and `*.key` belong in .gitignore.

## 1. Install (Python pipelines)

Requires Python 3.11+.

```bash
pip install tamper-signal
```

(Installing from source also works:
`pip install git+https://github.com/welovejeff/tamper-evident-verification.git`)

This provides the `receipts` CLI and the `tamper_signal` Python package.
Verify: `receipts --help` exits 0. JavaScript-only project? Use step 1b and
the JS equivalents; the two stacks produce interchangeable chains.

## 1b. Install (JavaScript pipelines)

Requires Node 18.17+.

```bash
npm install tamper-signal
```

This provides the `tamper-signal` CLI and the programmatic API. The CLI
implements **keygen, ingest, verify, and export** (exit codes 0 green, 1 red,
2 yellow):

```bash
tamper-signal keygen --out keys/
tamper-signal ingest export.csv --origin "TikTok export, May 2026" --out receipts/
tamper-signal verify receipts/chain.json --pub keys/signing.pub --data current.csv
tamper-signal export receipts/chain.json --data current.csv   # writes receipts/table.json
```

Programmatic API:

```js
import { receiptStep, loadCsv } from "tamper-signal";

const clean = receiptStep(
  (records) => records.filter((r) => r.campaign_name !== null),
  { chainDir: "receipts/", keyPath: "keys/signing.key", codeFile: "pipeline.js" }
);
const output = await clean(loadCsv("export.csv"));
```

`receiptStep` wraps a sync or async records -> records function with the same
contract as Python's `receipt_step`: verify the chain tail first, refuse
foreign input, sign and append a receipt. TypeScript declarations ship for
every entry point, so imports like `tamper-signal/react` resolve with no
`TS7016`.

### Rebuild on data change (idempotent)

`receiptStep` appends; re-running the same build throws `ChainTailMismatch`,
because the chain tail is now the transform's output, not the source it expects
as input. To rebuild cleanly when the source data changes, reset the chain to
its source first. Two supported ways:

```js
import { ingestFile, receiptStep, rebuildChain } from "tamper-signal";

// One call: re-ingest the source (resetting the chain), then run the stages.
await rebuildChain({
  file: "export.csv",
  stages: [normalize, dropBlankCampaign],
  chainDir: "receipts/",
  keyPath: "keys/signing.key",
});

// Or compose it: ingestFile() resets the chain to the source, then your
// receiptStep stages append fresh from a known tail.
const { records } = ingestFile({ file: "export.csv", chainDir: "receipts/", keyPath: "keys/signing.key" });
const clean = receiptStep(dropBlankCampaign, { chainDir: "receipts/", keyPath: "keys/signing.key" });
await clean(records);
```

`ingestFile` is the programmatic `tamper-signal ingest`: it rewrites
`chain.json` to list only the source, so each rebuild starts from a known tail.

### Emit table.json for the Data tab

`tamper-signal export <chain.json> --data <file>` writes the canonical table
document and refuses unless the data hashes to the final receipt. The same
document is available programmatically:

```js
import { canonicalDocument } from "tamper-signal";
import { writeFileSync } from "node:fs";
writeFileSync(
  "public/receipts/table.json",
  JSON.stringify(canonicalDocument(finalRecords), null, 2) + "\n"
);
```

### Serving the browser surfaces

The browser files are the same package: `tamper-signal/light`,
`tamper-signal/badge`, `tamper-signal/element`, `tamper-signal/table`,
`tamper-signal/console`, `tamper-signal/react`. For any static bundler (Vite,
CRA, SvelteKit, Astro, or plain HTML), serve the `receipts/` directory at
`/receipts/` — e.g. copy it into `public/receipts/` as part of the build. The
chain embeds its `public_key`, so the badge is zero-config. Express/Connect
apps can serve receipts and assets in one call with `tamper-signal/express`.

### Input formats and xlsx

JS reads **.csv / .tsv / .json / .ndjson / .jsonl**. It does **not** read
`.xlsx` — and the canonical "social export → dashboard" file usually arrives as
`.xlsx`. The semantic hash is identical across formats, so either convert the
`.xlsx` to CSV first, or ingest it once with the Python CLI (`pip install
tamper-signal`); the resulting chain verifies interchangeably on the JS side.

### What is Python-only

`tamper-signal` does not implement these `receipts` subcommands. On a JS-only
project, use the equivalent and skip the rest of this runbook's Python commands:

| `receipts` (Python) | JavaScript |
| --- | --- |
| `receipts init` | `tamper-signal keygen`; `receipts/` is created on first `ingest` (no scaffold command) |
| `receipts ingest` | `tamper-signal ingest` / `ingestFile()` |
| `receipts verify` | `tamper-signal verify` / `verifyChain()` |
| `receipts export` | `tamper-signal export` / `canonicalDocument()` |
| `receipts serve` | your bundler's static server, or `tamper-signal/express` |
| `receipts doctor` | `tamper-signal verify` (exit 0 = healthy); confirm the key is gitignored yourself |
| `receipts anchor` | Python-only today (transparency-log anchoring) |

CI signing works here too: `TAMPER_SIGNAL_KEY` (PEM contents of the private
key) wins over any key path, same semantics as the Python side (step 5).
`tamper-signal verify --json` emits the same structured verdict as the Python CLI.

## 2. Scaffold the project (once)

```bash
receipts init
```

Idempotent. Generates `keys/signing.key` (private, PEM; never commit) and
`keys/signing.pub` (raw hex; safe to commit), adds `keys/` and `*.key` to
.gitignore, creates `receipts/`, and prints exactly what it did. The pieces
are also available separately (`receipts keygen --out keys/`).

## 3. Start the chain at the source export

```bash
receipts ingest path/to/export.xlsx --origin "TikTok export, May 2026" \
  --key keys/signing.key --out receipts/
```

`--origin` is free text describing where the file came from; it appears in the
signal's UI, so write it for humans. Input formats: .xlsx/.xlsm (Python only),
.csv, .tsv, .json (array of objects), .ndjson/.jsonl. The semantic hash is
identical across formats, so an xlsx ingest verifies against a CSV or JSON
copy of the same data. This writes `receipts/000_source.json` and
`receipts/chain.json`.

## 4. Wrap every transform stage

```python
from tamper_signal import receipt_step

@receipt_step(chain_dir="receipts/", key_path="keys/signing.key")
def transform_clean(records):
    return [r for r in records if r.get("campaign_name")]
```

Contract: the function takes and returns either a list of dicts or a pandas
DataFrame (frames are hashed as records and pass through the function
untouched; NaN becomes the canonical null). The wrapper verifies the existing
chain first, refuses to run if the input data does not descend from the chain
tail (`ChainTailMismatch`), then signs and appends a receipt for the stage.

If a stage cannot fit the list-of-dicts contract, leave it unwrapped and tell
the user that stage is not attested. Do not fabricate a receipt for work the
wrapper did not observe.

## 5. Verify from the command line

```bash
receipts verify receipts/chain.json --pub keys/signing.pub --data path/to/dashboard_data.xlsx
```

Exit codes are the traffic light: **0 green, 1 red, 2 yellow**. `--data` is
optional and checks the file the dashboard actually reads against the final
receipt. `--warn-drift` additionally flags any control-totals movement across
links (only for pipelines expected to preserve totals).

Key rotation: `--pub` repeats. Old chains stay green while new receipts sign
under a new key: `receipts verify chain.json --pub new.pub --pub old.pub`. A
signature valid under any trusted key is trusted; the browser surfaces accept
a list the same way (the `<tamper-signal>` element takes a space-separated
`pub-key` list).

CI signing: set `TAMPER_SIGNAL_KEY` to the PEM contents of the private key
(a repo secret) and the wrapper, ingest, and export sign without a key file
on disk. The env var wins over any `--key` path while set. The Node CLI
(`tamper-signal ingest`) honors the same env var with the same precedence.

Add `--json` to get a structured verdict instead of the text report (both
CLIs: `receipts verify --json` and `tamper-signal verify --json` emit the
same payload). Parse this rather than scraping text:

```json
{
  "verdict": "green | yellow | red",
  "exit_code": 0,
  "spec_version": "1.1",
  "receipts": 3,
  "transforms": 2,
  "stages": ["source", "clean", "aggregate"],
  "final_row_count": 304,
  "caveats": ["..."],
  "broken_link": {
    "link": [1, 2],
    "stage": "aggregate",
    "expected_input_hash": "...",
    "found_input_hash": "...",
    "totals_delta": ["row_count 4987 -> 304 (-4683)"]
  },
  "data_mismatch": null,
  "receipt_mismatch": null,
  "report": ["human-legible lines"],
  "anchor": ["anchor report lines; present only when --anchor is passed"]
}
```

`broken_link`, `data_mismatch`, and `receipt_mismatch` are null unless the
verdict is red, and all three stay null when red comes from an anchor
mismatch (the chain itself is intact; the reason is in `anchor` and
`report`). `receipt_mismatch` lists receipt files that no longer match the
sha256 chain.json records for them: a receipt was rewritten after the chain
was. With `--anchor`, the `anchor` array is added and the anchor outcome is
folded into `verdict`, `exit_code`, `caveats`, and `report` (a missing
anchor turns a green run yellow; a mismatch turns it red), so the payload
never contradicts itself.

### CI: verify the chain on every push

```yaml
# .github/workflows/tamper-signal.yml
name: tamper-signal
on: [push]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install tamper-signal
      - name: Verify the receipt chain
        run: |
          set +e
          receipts verify receipts/chain.json --json | tee verdict.json
          code=$?
          if [ "$code" = "2" ]; then
            echo "::warning::The light is yellow, a human should look: $(python -c 'import json;print("; ".join(json.load(open("verdict.json"))["caveats"]))')"
            exit 0
          fi
          exit $code
```

Exit 1 (red) fails the build; exit 2 (yellow) surfaces a warning annotation
without failing.

## 5b. Anchoring (optional, for disputes and audits)

The local keypair is the day-to-day root of trust; its known gap is that
whoever holds the key can re-sign a fresh chain. When existence-at-a-time
matters (client disputes, audits), anchor the chain in the public Sigstore
transparency log:

```bash
pip install "tamper-signal[anchor]"
receipts anchor                       # browser login locally; automatic in GitHub Actions
receipts verify receipts/chain.json --anchor
```

Agent note: run `receipts anchor` in CI (GitHub Actions and similar), where
an ambient OIDC credential makes it non-interactive. Outside CI it opens a
browser login and blocks until a human completes it; do not invoke it from
an unattended session.

The anchor covers receipt contents, not just names: chain.json records the
sha256 of every receipt file, and `verify` enforces those hashes, so a
receipt re-signed after anchoring is red even though chain.json itself did
not change. Chains written before 1.5.0 carry no receipt hashes; anchoring
them yields a yellow "anchor covers chain.json only" caveat until the
pipeline re-runs.

`anchor.json` (next to chain.json) records the Sigstore bundle plus the
identity and issuer used; `verify --anchor` enforces that identity, reports
the logged time on success, exits 2 when no anchor exists, and exits 1 when
the chain changed after anchoring. `receipts anchor --json` emits the anchor
record (identity, issuer, integrated time) as JSON for CI logs. An anchor
made with `--staging` is rejected at verify time unless you pass
`--anchor-staging`, so the anchor file cannot pick a weaker trust root. To
pin whose anchor is acceptable instead of trusting the recorded one, pass
`--anchor-identity` (and optionally `--anchor-issuer`); in CI that looks
like:

```bash
receipts verify receipts/chain.json --anchor \
  --anchor-identity "https://github.com/OWNER/REPO/.github/workflows/anchor.yml@refs/heads/main" \
  --anchor-issuer "https://token.actions.githubusercontent.com"
```

Re-anchor after every pipeline run that changes the chain. Honest scope: an
anchor proves this exact chain existed at the logged time under the recorded
identity, nothing more.

## 6. Add the signal to the host UI

With a bundler, import straight from the npm package
(`import { mountTamperSignal } from "tamper-signal/light"`). Without one,
vendor two files from this repo into the host app, side by side (light.js
imports `./badge.js` relatively):

- `badge/badge.js` (verification core + the expandable badge)
- `badge/light.js` (the signal: the inline status light)

Serve the `receipts/` directory statically, then mount the signal in the host
header:

```html
<script type="module">
  import { mountTamperSignal } from "/static/light.js";
  mountTamperSignal(document.querySelector("header"), "/receipts/chain.json");
</script>
```

React hosts: `import { TamperSignal } from "tamper-signal/react"` (or vendor
`badge/light-react.js`), then `<TamperSignal chain="/receipts/chain.json" />`.

TypeScript: every subpath ships hand-written declarations (`types` conditions
in the `exports` map), so imports like `tamper-signal/react`, `/table`, and
`/light` resolve with no `TS7016`. The browser subpaths need only DOM types;
the Node entries (`.`, `/express`) expect `@types/node` as a normal Node
project already has.

Any other framework, or plain HTML: the web component. Import
`tamper-signal/element` (or vendor `badge/element.js`, which needs light.js
and badge.js beside it) and write one tag:

```html
<tamper-signal chain="/receipts/chain.json"></tamper-signal>
```

Attributes mirror the options: `pub-key`, `watch`, `warn-drift`,
`receipts-href`, `theme`.

Prefer the one-call attach helpers; each serves the receipts directory AND
the bundled browser assets, and returns a `snippet` to render once in the
layout (it mounts the signal into `header`, falling back to `body`):

```python
# Flask
from tamper_signal.flask_ext import attach
signal = attach(app, receipts_dir="receipts/")   # then: {{ signal.snippet | safe }}

# FastAPI
from tamper_signal.fastapi_ext import attach
signal = attach(app, receipts_dir="receipts/")
```

```js
// Express (or any Connect-style router)
import { tamperSignal } from "tamper-signal/express";
const signal = tamperSignal(app, { receiptsDir: "receipts/" });
// serve signal.snippet once in your layout
```

Next.js: copy `receipts/` into `public/receipts/` as part of the pipeline
run (the simplest correct path; receipts are plain files), then mount with
`<TamperSignal chain="/receipts/chain.json" />` from `tamper-signal/react`
in a client component, or the `<tamper-signal>` element in any layout.

Streamlit: `from tamper_signal.streamlit_ext import signal, verified_dataframe`.
These verify SERVER-SIDE with the Python verifier and the pill says so;
Streamlit cannot serve the receipts directory for the in-browser walk, and
faking the stronger claim would violate rule 1.

Every attach helper also serves the verification console at
`<assets_prefix>/console` (e.g. `/tamper-signal/console`): the chain as an
inspectable pipeline with the break pinned at the severed link, for the
dashboard's builder and for auditors. Mention it to the user when handing
over; it is the page to open when the light is anything but green.

Manual fallback when no helper fits: serve the directory statically (Flask
`static_folder="receipts"`, FastAPI `StaticFiles`, Express
`express.static("receipts")`), or copy `receipts/` into the public dir of a
static site at build time. For local development, `receipts serve` serves
the directory on localhost with CORS open and caching off.

Placement: the right end of the host header, after the host's own controls.
The pill is intentionally dark and mono; do not restyle it to match the host
theme (on a dark host, pass `{ theme: "light" }` instead). Options on the
fourth argument: `watch` (re-verify every N ms), `warnDrift`, `receiptsHref`,
`theme`.

The expandable badge (`renderReceiptBadge(el, "/receipts/chain.json")`) is the
alternative for pages with room for a full-width strip.

## 7. Let the signal flag broken metrics

Add `data-receipt-column="<column>"` to any metric element whose value comes
from a chain column. When the chain breaks, the signal outlines the elements
whose columns moved at the broken link and tags them "tamper signal:
unverified value."

Column names must match the normalized names in the receipts' control totals
(lowercased, spaces to underscores). Do not guess: read
`receipts/chain.json`, open the listed receipt files, and use the exact keys
under `control_totals.numeric_sums` / `null_counts`.

**Only plain decimals are summed.** Control totals cover values that parse as
plain decimals — `12345`, `-3.5`, `2.4e6`. Thousands-grouped strings like
`"289,084"` or `"1 198 372"` (very common in real exports) are *not* coerced,
so their column never reaches `numeric_sums`, and a `data-receipt-column` on it
can never flag a change — silently. Grouping isn't auto-stripped on purpose: it
would diverge from the Python canonicalization and is locale-ambiguous (`"1,234"`
is 1234 or 1.234?). Fix it upstream with a signed normalize stage that strips
the separators before the receipt is written. `tamper-signal ingest` prints a
warning naming any such columns; programmatically, call `groupedNumericColumns(records)`.

## 8. The Data tab (when asked for table UI or views)

The project's stance: a dashboard built on verified data should show the
verified table, not just charts. Two steps:

1. After the pipeline runs, export the canonical table document:

   ```bash
   # Python
   receipts export --chain receipts/chain.json --data path/to/dashboard_data.xlsx
   # JavaScript
   tamper-signal export receipts/chain.json --data path/to/dashboard_data.csv
   ```

   This writes `receipts/table.json` and refuses if the data does not match
   the final receipt (the Data tab only ever shows attested data). Re-run it
   whenever the pipeline runs, or the tab will honestly report a stale table.
   In a JS build you can write it programmatically instead with
   `canonicalDocument(finalRecords)` (see step 1b).

2. Mount the table (vendor `badge/table.js` beside badge.js, or import
   `tamper-signal/table`):

   ```html
   <script type="module">
     import { mountReceiptTable } from "/static/table.js";
     mountReceiptTable(document.querySelector("#data-tab"), "/receipts/chain.json");
   </script>
   ```

The component re-hashes the served document in the viewer's browser and
compares it against the final receipt, so VERIFIED means the rows on screen
are byte-for-byte the attested data. It renders its own states: green, yellow
with caveats, chain broken (with the moved columns flagged), and "not the
attested data" when table.json is stale or edited. Design reference:
`designs/03-data-tab.html`.

## 9. Verify your work before reporting done

On a Python project, run `receipts doctor` first: it checks the Python version,
that the private key exists and is not tracked by git, that .gitignore covers
it, and that the chain verifies; pass `--url http://localhost:PORT/chain.json`
to also confirm the receipts directory is reachable over HTTP. Every failure
prints its fix. Exit 0 means the integration is healthy. (`doctor` is
Python-only; on a JS project, `tamper-signal verify receipts/chain.json` exits
0 when the chain is healthy, and you should confirm the private key is
gitignored yourself.) Then confirm the user-visible surfaces:

1. `receipts verify receipts/chain.json --pub keys/signing.pub` exits 0.
2. Load the host page: the pill reads `VERIFIED · chain intact` (click it for
   the per-stage popover).
3. Negative test without touching the user's real chain: this repo commits
   known-good fixtures under `examples/chains/` (`intact/` verifies green;
   `tampered/` is broken at link 1 -> 2). Point the signal at each to confirm
   both states render.
4. If the pill reads `UNVERIFIED · could not load chain`, the receipts
   directory is not being served at the URL you passed (or it is blocked by
   CORS). That state is a capability fallback, not a verdict.

## Troubleshooting

- `ChainTailMismatch` when running a wrapped transform: the data fed to the
  stage is not the previous stage's output. Re-run the pipeline from ingest;
  do not bypass the wrapper.
- Yellow with "unrecognized signing key": the `pubKeyHex` passed to the signal
  differs from the key embedded in chain.json. Pass the right trusted key, or
  omit the argument to trust the embedded key.
- The pill shows `UNVERIFIED · verification unsupported in this browser`: the
  browser lacks Web Crypto Ed25519. The signal says nothing about the chain in
  this state; verify from the CLI instead.

## Repo map

| Path | What it is |
|---|---|
| `tamper_signal/` | Python package: canonicalization, keys, receipts, verify, `receipt_step` |
| `node/` | JavaScript package: same API (`receiptStep`, `verifyChain`), interchangeable chains |
| `badge/badge.js` | Browser verification core + the receipt badge |
| `badge/light.js` | The signal (inline status light), `mountTamperSignal` |
| `badge/light-react.js` | `<TamperSignal />` React wrapper |
| `examples/chains/` | Committed known-good and known-broken demo chains |
| `designs/` | Working HTML mockups for the signal, console, and Data tab |
| `docs/MESSAGING.md` | Copy rules; the source of truth for any words you write |
| `docs/solutions/` | Documented solutions to past problems (bugs, patterns, conventions), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`); relevant when working in documented areas |
| `CONCEPTS.md` | Shared domain vocabulary (entities, named processes, status concepts); relevant when orienting to the codebase |
