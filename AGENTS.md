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

This provides the `tamper-signal` CLI (keygen / ingest / verify, exit codes
0 green, 1 red, 2 yellow) and the programmatic API:

```js
import { receiptStep, loadCsv } from "tamper-signal";

const clean = receiptStep(
  (records) => records.filter((r) => r.campaign_name !== null),
  { chainDir: "receipts/", keyPath: "keys/signing.key", codeFile: "pipeline.js" }
);
const output = await clean(loadCsv("export.csv"));
```

`receiptStep` wraps a sync or async records -> records function with the
same contract as Python's `receipt_step`: verify the chain tail first,
refuse foreign input, sign and append a receipt. The browser files are the
same package: `tamper-signal/light`, `tamper-signal/badge`,
`tamper-signal/element`, `tamper-signal/react`. JS reads .csv/.tsv/.json/
.ndjson; only the Python side reads .xlsx.

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

Add `--json` to get a structured verdict instead of the text report. Parse
this rather than scraping text:

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
  "report": ["human-legible lines"]
}
```

`broken_link` and `data_mismatch` are null unless the verdict is red.

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

Any other framework, or plain HTML: the web component. Import
`tamper-signal/element` (or vendor `badge/element.js`, which needs light.js
and badge.js beside it) and write one tag:

```html
<tamper-signal chain="/receipts/chain.json"></tamper-signal>
```

Attributes mirror the options: `pub-key`, `watch`, `warn-drift`,
`receipts-href`, `theme`.

Static serving examples: Flask
`app = Flask(__name__, static_folder="receipts", static_url_path="/receipts")`;
FastAPI `app.mount("/receipts", StaticFiles(directory="receipts"))`; Express
`app.use("/receipts", express.static("receipts"))`. A purely static site can
copy `receipts/` into its public directory at build time. For local
development, `receipts serve` serves the directory on localhost with CORS
open and caching off.

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

## 8. The Data tab (when asked for table UI or views)

The project's stance: a dashboard built on verified data should show the
verified table, not just charts. If the user asks for the table UI, add a
"Data" tab next to the charts that renders the final stage's output (the same
file `--data` verifies), labeled with the current verdict. The design
reference is `designs/03-data-tab.html` with notes in `designs/03-NOTES.md`;
there is no packaged component yet, so build it in the host's own stack and
say so honestly.

## 9. Verify your work before reporting done

Run `receipts doctor` first: it checks the Python version, that the private
key exists and is not tracked by git, that .gitignore covers it, and that the
chain verifies; pass `--url http://localhost:PORT/chain.json` to also confirm
the receipts directory is reachable over HTTP. Every failure prints its fix.
Exit 0 means the integration is healthy. Then confirm the user-visible
surfaces:

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
