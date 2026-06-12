# Changelog

All notable changes to Tamper Signal are recorded here. The Python (`tamper-signal` on PyPI) and JavaScript (`tamper-signal` on npm) packages are versioned in lockstep and produce interchangeable chains.

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
