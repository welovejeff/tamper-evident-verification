# Changelog

All notable changes to Tamper Signal are recorded here. The Python (`tamper-signal` on PyPI) and JavaScript (`tamper-signal` on npm) packages are versioned in lockstep and produce interchangeable chains.

## Unreleased

Integration-pass fixes: smooth the first hour for an integrator copy-pasting the runbook, from a fresh `pip install` through mounting the verified table.

### Added

- **`receipts assets` / `tamper-signal assets`** copies the bundled browser surfaces (`light.js`, `badge.js`, `element.js`, `table.js`, `console.js`) into a project, default `--out badge/`, so vendoring no longer means digging through `site-packages` or `node_modules`. `--json` reports the destination and the files written.
- **`<tamper-signal-table>` web component**, the parallel of `<tamper-signal>` for the verified Data tab. Importing `tamper-signal/table` (or vendored `badge/table.js`) registers it; attributes are `chain` (required), `table` (table.json URL), and `max-rows`. Previously only `mountReceiptTable(...)` was available and the element was documented but never defined.
- **`python -m tamper_signal`** as a PATH-independent entry point. When pip installs the `receipts` console script into a bin directory that is not on PATH (common on the python.org framework Python), every `receipts <args>` works as `python3 -m tamper_signal <args>`.

### Changed

- **`receipts export` accepts the chain as a positional argument** (`receipts export receipts/chain.json --data ...`), matching `receipts verify` and the Node CLI. The `--chain` flag still works; the positional wins when both are given. The runbook's documented `export` command now runs as written.
- **`receipts serve` reports a busy port cleanly** — `port <n> is already in use — try receipts serve --port <n>`, exit 1 — instead of dumping a raw `OSError` traceback. The startup banner now prints the served root URL rather than appending `/chain.json` to it.

### Docs

- The runbook (`AGENTS.md`) standardizes manual-vendor asset paths on `/badge/`, adds a note that the browser surfaces verify over HTTP and not from `file://`, documents source-only chains (a valid chain with zero transforms and exactly what it does and does not attest), and adds an install note for the "`receipts: command not found`" PATH case. Its "rules for the copy you write" section is reframed so a summarizing agent reads it as guidance about product copy, not as constraints on its own output.

### Added

- **`--json` on `receipts ingest`, `export`, and `doctor`** (and the Node `tamper-signal ingest` / `export`), completing the structured surface that `verify`, `diff`, `log`, and `anchor` already had. `ingest --json` reports the source filename, evidence and semantic hashes, row/column counts, the signed tolerance, and the source-manifest path; `export --json` reports the output path, counts, data hash, and whether a bundle was written; `doctor --json` reports each check (`name`, `ok`, `fix`), the warnings, and an overall `all_passed`. Failures under `--json` print a structured `{"ok": false, "error": ...}` object on stdout. The Python and Node payloads are key-identical for every shared command; `doctor` is Python-only, since the Node CLI has no `doctor` command.
- **`band` and `settle_hours` in `log --json`**, surfaced per run entry from each run's signed tolerance declaration (omitted on runs that declared none).
- **A colored, human-facing CLI.** The verdict renders as a green/amber/red `●` light that agrees with the exit code and the verdict word; `doctor` check glyphs and `diff` / totals deltas are colored by direction (increase green, decrease red, sign always printed); secondary detail like hashes is dimmed; and `receipts init` shows a first-run banner.

### Notes

- **Color never corrupts machine output.** ANSI is emitted only when stdout is an interactive terminal and is never present in `--json` output or when stdout is piped or redirected. It honors `NO_COLOR` (force off, wins over everything), `FORCE_COLOR` (force on past the TTY check), and a `--no-color` flag. A regression test in each stack asserts that no escape sequence appears under `--json` or a non-TTY pipe, even with color forced on.
- The color layer is a small dependency-free helper in each stack (`tamper_signal/color.py`, `node/color.js`) with an identical palette and gating rule, so the two CLIs read as one product. No new runtime dependency, no spec change, no change to receipt bytes.

## 1.7.0

Data portability: take the attested data out with its proof, and bring an updated file back.

### Added

- **`receipts export --bundle` / `tamper-signal export --bundle`** writes a verified bundle: a store-only zip holding the data file plus `chain.json` and its receipts, byte for byte, plus a `README.md` of verify instructions, so a recipient who has never used Tamper Signal can run `receipts verify chain.json` offline. Bare `export` still writes `table.json`.
- **"Take your data" in the verified Data tab** (`mountReceiptTable`): a client-side export of the attested data as a verified bundle or a bare rows-only file, in csv/tsv/json/ndjson (xlsx routes through the Python CLI). The bundle is offered only when the data is attested and the light is green or yellow; rows-only always reads as unverified.
- **`receipts ingest --as replace|period` / `tamper-signal ingest --as ...`** imports a file to update the source. `replace` (default) re-signs a fresh chain and archives the prior one under `receipts/archive/<tail>/`. `period` continues the chain's run history as the next period, judged against prior snapshots through the prior run's signed tolerance band; it requires a trusted signer (`--pub` to trust a key other than the chain's) and refuses an untrusted one rather than appending silently.

### Notes

- The Semantic hash is format-agnostic, so a CSV exported from a bundle re-verifies as JSON and the light stays green. Numeric-looking text canonicalizes to its number, so leading zeros and trailing decimals do not survive a round trip.

## 1.6.0

Period-over-period continuity: the receipt chain gains a memory and a sense of normal, so the light stays trustworthy on the pipelines people actually run on a schedule.

### Added

- **`receipts diff` / `tamper-signal diff`** compares two runs (or the current chain against the latest archived run) and names what moved: per-stage code-hash changes plus a structured control-totals delta, including date ranges and changed period buckets. Read-only.
- **`receipts log` / `tamper-signal log`** renders a per-metric trend across archived runs at day, week, month, or quarter granularity. Read-only.
- **Tolerance declarations at ingest** (`--band`, `--settle`, `--bucket-column`), signed into the source manifest. A producer declares how much a period normally moves; the default band is 5% day over day inside a 72 hour settling window. The declaration is covered by the manifest signature, so it cannot be loosened after the fact.
- **Two-zone judgment** in verify, active only when a declaration and run history are present: maturing buckets may drift within the band and stay green; settled buckets are frozen and any movement trips yellow. Cross-run anomalies are always yellow, never red. New typed caveats: `band_breach`, `settled_movement`, `bucket_removed`, `bucket_loss`, `columns_changed`.
- **Per-period bucketed control totals** in receipts, keyed off the data's date column (detected, or named via `--bucket-column`). This is what lets verification tell yesterday's maturing data apart from a three-week-old value that should never move.
- **`caveat_details`** in the `verify --json` payload: a structured, per-bucket companion to the flat `caveats` strings.
- **Python `ingest_file()`** library function, so a programmatic pipeline can declare tolerance without shelling out to the CLI (parity with the JS `ingestFile` options).
- TypeScript declarations for the new surfaces (`DiffResult`, `LogResult`, `CaveatDetail`, `JudgeCrossRunResult`, snapshot and tolerance types) and the missing package-root re-exports.

### Changed

- **Spec version 1.1 to 1.2.** This is additive: canonicalization is unchanged, so semantic hashes do not move, and chains recorded under 1.0 and 1.1 still verify green. The bump records that receipts may now carry period buckets.
- With no tolerance declaration, verification behaves exactly as in 1.5.1. The new judgment is strictly opt-in.

### New default behavior worth noting

- **Run history accrues automatically.** Every non-red CLI verify now archives a compact, content-addressed run snapshot to `receipts/history/` (signed when a signing key is available). This is what `diff`, `log`, and the two-zone judgment read. The write never fails a verdict and degrades to a notice on a read-only filesystem, but it is a new side effect of `verify` for existing users. Add `receipts/history/` to version control or `.gitignore` to taste.
- **Published receipts now carry daily-granularity bucket keys** when a date column is present, which discloses the date range a dataset covers. Serving stays local: `receipts serve` and the framework helpers do not expose `receipts/history/`.

### Fixed

- Forced LF line endings via `.gitattributes`. A receipt chain commits to the sha256 of each receipt file's raw bytes, so a Windows checkout with `core.autocrlf=true` could rewrite committed chains and make valid receipts verify as broken. They are now byte-stable on every platform.

### Notes

- The claim is unchanged: this proves **continuity, not correctness**. Tolerance bands are the producer's signed, declared expectation of normal movement, never a statement that the data is right.
- Deferred to a future release: a `suggest-bands` helper, per-metric band overrides, a browser trend view, history retention/pruning, and a snapshot mini-chain for cheap history tamper-evidence (run history is honestly weaker evidence than the chain itself).
