# UPDATE.md: Data Lineage Receipts MVP

Implementation spec for evolving `tamper-evident-verification` from a single-computation hash demo into a **signed data lineage chain** for analytics pipelines: platform export (xlsx) -> transform(s) -> dashboard, with verifiable receipts at every stage.

Read this whole file before writing code. Where this spec is explicit, follow it exactly (especially canonicalization and signing). Where it is silent, make the simple choice and document it in code comments.

---

## 1. Context and goal

**Problem:** A marketing team downloads a large xlsx export from a social media tool (Sprinklr, Meta, etc.), runs it through LLM-generated ("vibe coded") transform scripts, and renders it in a live dashboard. Today there is no way to prove the dashboard numbers descend from the original export, or to locate where a discrepancy was introduced.

**Goal:** A chain of signed receipts. Each pipeline stage emits a receipt containing the hash of its input, the hash of its code, the hash of its output, and human-legible control totals. Receipts link because each stage's input hash must equal the prior stage's output hash. A verifier replays the chain and reports PASS, or FAIL with the exact broken link.

**This proves continuity, not correctness.** If the source export is wrong, the chain faithfully verifies wrong numbers. Do not write copy in code, docs, or UI that claims otherwise.

**Non-goals for this MVP:**
- No external anchoring (Sigstore, RFC 3161 timestamps). Leave a `// FUTURE:` comment where it would attach.
- No database, no server-side state, no auth. Receipts are files on disk.
- No C2PA integration.
- Do not modify or fix the existing Luhn intro (`intro.html`, `intro.js`, `intro.css`). It is being retired from the demo path.

---

## 2. Repo restructure

Move the existing demo into `legacy/` unchanged. New structure:

```
/
├── legacy/                  # existing intro.*, index.html, script.js, style.css, app.py, server.js
├── lineage/
│   ├── __init__.py
│   ├── canonical.py         # canonicalization + semantic hashing
│   ├── totals.py            # control totals
│   ├── keys.py              # Ed25519 keygen, load, sign, verify
│   ├── receipts.py          # manifest/receipt creation + chain verification
│   ├── cli.py               # command-line entry points
│   └── wrapper.py           # transform decorator
├── badge/
│   ├── badge.html           # standalone demo page hosting the badge
│   └── badge.js             # chain re-verification in browser (Web Crypto Ed25519)
├── examples/
│   ├── make_sample_export.py  # generates sample_export.xlsx (see §8)
│   ├── transform_clean.py     # sample vibe-coded transform 1
│   └── transform_aggregate.py # sample vibe-coded transform 2
├── tests/
│   └── test_lineage.py
├── pyproject.toml
├── README.md                # rewrite, see §9
└── .gitignore               # must include *.key, keys/, node_modules, .env, dist
```

Cleanup while restructuring: delete `index.js` and `dist/` (it is a stale copy of source), and remove the `build` script from `package.json`. Rename package to `lineage-receipts`.

**Python:** 3.11+. Dependencies: `openpyxl` (xlsx parsing), `cryptography` (Ed25519). Nothing else. No pandas.

---

## 3. Canonicalization and semantic hashing (`canonical.py`)

This is the most failure-prone part. Two hashes exist per data artifact:

**Evidence hash:** SHA-256 of the raw file bytes, computed once at ingest, never recomputed downstream. Anchors the original artifact.

**Semantic hash:** SHA-256 of the canonicalized *data content*. Must be stable across format round-trips (xlsx re-save, xlsx -> CSV, xlsx -> JSON) so long as the values are unchanged. Rules, in order:

1. Parse the first worksheet (or a named sheet via parameter) into rows of cells. First row = headers.
2. **Headers:** strip whitespace, lowercase, collapse internal whitespace runs to a single underscore. `"Total  Spend (USD)"` -> `"total_spend_(usd)"`. Reject duplicate headers after normalization with a clear error.
3. **Cell normalization by type:**
   - Strings: Unicode NFC normalization, strip leading/trailing whitespace. Empty string stays empty string.
   - Numbers: convert to `decimal.Decimal`, quantize to 6 decimal places (`ROUND_HALF_EVEN`), serialize as a string with no trailing zeros beyond the quantization (use `str(d.normalize())` but guard against scientific notation; write a helper that always emits plain decimal notation). Integers serialize without a decimal point.
   - Dates/datetimes: ISO 8601. Date-only values as `YYYY-MM-DD`, datetimes as UTC `YYYY-MM-DDTHH:MM:SSZ`. Naive datetimes are assumed UTC.
   - Booleans: `true` / `false`.
   - Empty/None: JSON `null`.
   - Formula cells: use the cached computed value openpyxl returns with `data_only=True`. If no cached value exists, treat as null and count it in `null_counts`.
4. **Row ordering:** sort rows lexicographically by the tuple of all normalized cell string values, columns in normalized-header alphabetical order. (Deterministic regardless of source row order; document in a comment that this means row order is NOT part of integrity.)
5. **Serialization:** build `{"headers": [...sorted...], "rows": [[...cells in sorted-header order...], ...]}` and serialize per **RFC 8785 JCS**. Implement minimal JCS yourself (sorted keys, no whitespace, UTF-8); since all leaf values are strings/null/booleans by this point, you do not need JCS number serialization edge cases. Add a comment stating that assumption.
6. SHA-256 over the UTF-8 bytes -> lowercase hex.

The same `canonicalize(records) -> bytes` function must accept a list-of-dicts (in-memory data between transforms), so a transform's output hashes identically whether it lives in memory or was written to disk and re-parsed. **Test this property explicitly.**

---

## 4. Control totals (`totals.py`)

Computed on canonicalized data, included in every manifest/receipt:

```json
{
  "row_count": 48212,
  "column_count": 9,
  "numeric_sums": {"impressions": "1284003.17", "spend_(usd)": "98441.02"},
  "date_ranges": {"date": {"min": "2026-05-01", "max": "2026-05-31"}},
  "null_counts": {"campaign_name": 3}
}
```

- `numeric_sums`: every column where >= 90% of non-null values parsed as numeric. Sums as quantized decimal strings (same helper as §3), never floats.
- `date_ranges`: every column where >= 90% of non-null values parsed as dates.
- `null_counts`: only columns with at least one null.

Purpose: hashes say "broken", totals say "how broken" (e.g. 22 rows silently dropped). Keep them human-legible.

---

## 5. Keys and signing (`keys.py`)

- Ed25519 via the `cryptography` library.
- `lineage keygen --out keys/` writes `signing.key` (PKCS8 PEM, private) and `signing.pub` (raw 32-byte public key, hex in a `.pub` text file; raw hex chosen so `badge.js` can import it directly with Web Crypto).
- Signing: canonical JCS bytes of the receipt body (everything except the `signature` block) -> Ed25519 sign -> hex.
- `keys/` and `*.key` must be in `.gitignore`. Print a warning at keygen time: "Private key written to keys/signing.key. Do not commit it."
- A key fingerprint (first 16 hex chars of SHA-256 of the public key bytes) is embedded in every signature block so the verifier picks the right key.

---

## 6. Receipts and chain (`receipts.py`, `cli.py`, `wrapper.py`)

All receipts are JSON files in a `receipts/` directory created next to the data, named `000_source.json`, `001_<transform_name>.json`, ... The chain file `chain.json` is just an ordered list of receipt filenames plus the public key hex.

**Source manifest (ingest):**

```json
{
  "kind": "source_manifest",
  "spec_version": "1.0",
  "created_at": "2026-06-09T14:30:00Z",
  "source": {
    "filename": "sprinklr_export_may.xlsx",
    "evidence_hash": "<sha256 of raw bytes>",
    "byte_size": 18734221,
    "declared_origin": "Sprinklr export, May 2026"   // free text from --origin flag
  },
  "semantic_hash": "<sha256 of canonical data>",
  "control_totals": { ... },
  "signature": {"alg": "ed25519", "key_fingerprint": "...", "value": "<hex>"}
}
```

**Transform receipt:**

```json
{
  "kind": "transform_receipt",
  "spec_version": "1.0",
  "created_at": "...",
  "transform": {
    "name": "transform_clean",
    "code_hash": "<sha256 of inspect.getsource() of the transform function>",
    "code_file": "examples/transform_clean.py"
  },
  "input_semantic_hash": "<must equal previous receipt's semantic/output hash>",
  "output_semantic_hash": "...",
  "output_control_totals": { ... },
  "signature": { ... }
}
```

**`wrapper.py`:** a decorator `@lineage_step(chain_dir="receipts/")`. The wrapped function takes list-of-dicts, returns list-of-dicts. The decorator: verifies the existing chain tail, asserts the input's semantic hash matches the tail's output hash (hard error if not), runs the function, hashes `inspect.getsource()` of the *undecorated* function (use `__wrapped__` via `functools.wraps`), computes output hash + totals, signs, appends the receipt, updates `chain.json`.

**CLI commands** (via `pyproject.toml` entry point `lineage`):

- `lineage keygen --out keys/`
- `lineage ingest <file.xlsx> --origin "..." --key keys/signing.key --out receipts/`
- `lineage verify receipts/chain.json --pub keys/signing.pub [--data <current.xlsx>]`
- `lineage demo` (runs the full §8 demo end to end)

**`verify` output contract.** Checks, in order: every receipt's signature; every link (receipt N input hash == receipt N-1 output hash); if `--data` is given, that the file's semantic hash matches the final receipt's output hash. On failure, exit code 1 and pinpoint the break:

```
✗ CHAIN BROKEN at link 1 -> 2 (transform_aggregate)
  expected input hash a3f1...9c  (output of transform_clean)
  found    input hash 77b2...d4
  Control totals delta vs upstream: row_count 48212 -> 48190 (-22), spend_(usd) -98.40
```

The totals delta line is computed by comparing the totals of adjacent receipts and printing only changed entries. This is the diagnosability feature; do not skip it.

---

## 7. Browser badge (`badge/`)

A self-contained verification widget. No build step, no framework, no localStorage.

- `badge.js` exports `renderLineageBadge(containerEl, chainUrl, pubKeyHex)`. Fetches `chain.json` and each receipt, re-verifies all signatures with Web Crypto Ed25519 (`crypto.subtle.importKey("raw", ...)`; if the browser lacks Ed25519, render an amber "verification unsupported in this browser" state rather than failing silently), re-checks all hash links (hash re-linking only; the browser does not re-canonicalize xlsx).
- Collapsed state (green): `✓ Verified · Sprinklr export, May 2026 · 48,212 rows · 2 transforms · chain intact`
- Collapsed state (red): `✗ Chain broken at transform_aggregate` and expanding shows the totals delta.
- Expanded state: one row per receipt: stage name, timestamp, short hashes, row count.
- `badge.html`: minimal page that loads a `receipts/` directory and renders the badge, used for the demo screenshot. Keep styling minimal and professional (no gradients, no emoji in the badge itself other than the ✓/✗ state mark).

---

## 8. Demo scenario (`lineage demo` and `examples/`)

1. `make_sample_export.py` generates `sample_export.xlsx`: ~5,000 rows of fake social data (date, campaign_name, channel, impressions, clicks, spend_usd), seeded RNG for reproducibility, including deliberate mess: a few null campaign names, mixed date formats, numbers stored as text in ~1% of cells.
2. `transform_clean.py`: drops rows with null campaign_name, coerces text-numbers. (This drops rows: the totals delta between receipt 0 and 1 should visibly show it. That is a feature; the demo narrative is "the receipt caught the silent row drop".)
3. `transform_aggregate.py`: groups by channel + date, sums impressions/clicks/spend.
4. `lineage demo` runs: keygen -> ingest -> both transforms via the wrapper -> verify (prints PASS) -> then tampers (edits one spend value in the intermediate output, re-runs verify) -> prints the FAIL output with the broken link and totals delta.

The PASS-then-FAIL console transcript is the acceptance demo.

---

## 9. README rewrite

Replace the README with: the problem statement from §1 (one paragraph), quick start (`pip install -e . && lineage demo`), the receipt JSON shapes, the badge screenshot placeholder, an explicit **"What this proves / what it does not prove"** section (continuity vs. correctness, verbatim point from §1), and a short "Relation to OpenLineage / dbt / Great Expectations" note positioning this as a lightweight signed alternative for small analytics teams, not a replacement. Keep the legacy demo mentioned in one line at the bottom. No em dashes anywhere in the README or in UI copy.

---

## 10. Tests (`tests/test_lineage.py`)

Must pass with `pytest`:

1. **Round-trip stability:** xlsx -> canonical hash == same data re-saved as xlsx by openpyxl -> canonical hash == in-memory list-of-dicts -> canonical hash.
2. **Sensitivity:** changing one cell value changes the semantic hash; reordering rows does NOT.
3. **Number edge cases:** `1`, `1.0`, `"1"` (text-number after coercion) hash identically; `0.1 + 0.2` style floats quantize stably; no scientific notation ever appears in serialized output.
4. **Signature:** valid chain verifies; flipping one byte of any signature fails; signing with key A and verifying with key B fails.
5. **Chain linking:** tampering with an intermediate output is caught at the correct link index; the totals delta in the error names the changed column.
6. **Code hash:** editing the transform function source changes `code_hash`.
7. **Wrapper guard:** feeding the wrapper data whose hash does not match the chain tail raises before the transform runs.

## 11. Definition of done

- `lineage demo` produces the PASS-then-FAIL transcript on a clean clone with only `pip install -e .`.
- All §10 tests green.
- `badge.html` renders green over the demo receipts and red after the tamper step.
- No private key material in the repo; `.gitignore` covers it.
- README rewritten per §9.
