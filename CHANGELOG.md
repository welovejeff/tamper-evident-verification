# Changelog

All notable changes to Tamper Signal are recorded here. The Python (`tamper-signal` on PyPI) and JavaScript (`tamper-signal` on npm) packages are versioned in lockstep and produce interchangeable chains.

## 2.1.0

One light, one room. The outcome of a full design review of the browser UI: the chain viewer, the data table, and the inspector console were three separately mounted surfaces; 2.1 unifies everything behind the untouched status light into ONE robust, data-table-first surface — **the Signal Room** — and makes shipping it the structural default. Backward compatible: every 2.0 subpath, mount signature, element, and emitted event keeps working; the shims are scheduled for removal only at 3.0, where `./table` and `./console` keep resolving to the room presets permanently.

### Added

- **`badge/room.js` / `tamper-signal/room`** — `mountSignalRoom(el, chainUrl, pubKey?, opts?)` and `<tamper-signal-room>` (usable straight from React JSX; `room.d.ts` ships the typing). A fixed six-region skeleton — verdict strip, adaptive headline, provenance rail, table plane with a pinned signed control-totals row, inspector/log/custody drawers, export footer — whose prominence adapts to the verdict while the DOM never reorders. Green earns silence and leads with the attested rows; yellow leads with located caveat cards (each with a "show me" that lands on the gap's ghost node, the tail receipt, or the drifted column); red leads with the break exhibit in business numbers (metric | expected | found | Δ). A stale `table.json` is its own honest state — `NOT THE ATTESTED DATA`, a hatched wrench band with the exact re-run command, the intact rail rendered green — deliberately distinct from tampering; a *missing* `table.json` is not a verdict at all (grey slab, chain verdict intact). The event log reproduces the CLI verifier line for line; the chain-of-custody drawer carries the full timeline layer (chain-tail binding, signature gating, unsigned-annotation withholding) with no counts anywhere outside the opened drawer. Deep links (`#break`, `#receipt=`, `#caveat=`, `#column=`, `#custody`, `#log`, `?focus=auto`) are scroll/expand hints only, honored only when the room's own fresh verification agrees.
- **The attach helpers now serve the room** at `${assetsPrefix}/receipts` and pre-wire the light's `receiptsHref` to it with `?focus=auto` — one call structurally ships the light with a live room behind it, and the light's "view receipts →" never dead-ends in raw JSON. New return fields `roomUrl` and `roomSnippet` (an inline embedded room for host-rendered Data tabs); `room=False` / `{ room: false }` opts out (not recommended; the light will link to raw JSON). `${assetsPrefix}/console` stays reachable, serving the room with its rail open.
- **A verification memo in the shared core** — concurrent `verifyReceipts` calls with the same chain URL, trusted keyset, and drift flag share one in-flight run, and a completed result is reused for 250ms (hard below the 1000ms minimum watch interval), so a light and a room on one page fetch the chain and run Ed25519 once per refresh cycle. Different keysets never share a result. `invalidateVerification(chainUrl?)` busts synchronously; the room's re-verify always does.
- **Evidence export at red** — the room's "Take your data" footer offers an evidence bundle (chain + receipts + the browser verifier's transcript) when the chain is broken, so the failure itself is portable; the verified bundle is still offered only for attested green/yellow data, and can now opt in `timeline.json` and the verification transcript.
- `tamper-signal assets` (both stacks) now vendors `room.js` alongside the other five surfaces.
- **The export step is automatable** — `rebuildChain({ exportTable: true })` (Node) and `@receipt_step(..., write_table=True)` on the final stage (Python) write `table.json` as the last pipeline step, so the room's landing plane cannot go stale on a rebuild. And when a published `table.json` does go stale, both verify CLIs print a one-line stderr reminder naming the re-run command (absence stays silent, `--json` stdout is untouched, and the chain verdict and exit code never change).

### Changed

- **`tamper-signal/table` and `tamper-signal/console` are room-backed shims.** `mountReceiptTable` / `mountReceiptConsole` / `<tamper-signal-table>` keep their exact signatures, attributes, handle shapes, and the `tamper-signal:state` contract (`{state, attested, strict}`, host gate `strict && (state === "red" || !attested)`), but now render the room's table/console presets — same data, same claims, upgraded frame; verdict wording changes to the canonical vocabulary shared with the light. Anyone pinned to the exact old pixels pins 2.0.x. The shims dynamic-import `room.js` and fail loudly (a panel naming the re-run-assets command) if a vendored directory is missing it.
- The state emitted at a broken chain now always carries `attested: false` — a byte-match against the tail of a broken chain is a hollow claim.

### Fixed

- **The unverifiable badge state wore amber.** `renderReceiptBadge`'s capability fallback ("could not load", "unsupported browser") was styled with the yellow verdict's color, violating the grey-is-not-a-verdict rule; it is now grey. (`renderReceiptBadge` itself is deprecated — mount the light with the room behind it — and will be removed in 3.0.)
- **The committed coverage-gap fixture verified red, not yellow.** `examples/chains/gap/chain.json` recorded the renamed receipt's hash under its old filename (`002_aggregate.json` instead of `003_aggregate.json`), so every surface pointed at the "yellow" demo chain actually showed `receipt file mismatch` since receipt-hash enforcement landed.

### Notes

- One canonical verdict vocabulary now lives in the core (`VOCAB`), copied verbatim from the untouched `light.js` and drift-tested, so the pill, the room's strip, the event log, and the CLI speak identical words. `badge/light.js` and `badge/light-react.js` are byte-identical to 2.0.0.

## 2.0.0

Data provenance: the chain grows a memory and a chain-of-custody surface, and can keep a **live source** under the same signed continuity. Two tracks land together — the on-disk provenance layer (Phase A) and the live-source watcher (Phase B). Fully backward compatible: existing chains verify unchanged, and every new surface is additive and opt-in.

### Added — provenance & chain of custody

- **Signed annotations** — `tamper-signal annotate` attaches a signed reason (and optional self-declared author) to a specific receipt by its content hash, so the note is tamper-evident and cannot be silently retargeted. Corrections supersede a prior note by hash; nothing is ever overwritten.
- **Published provenance timeline** — `tamper-signal timeline` writes a narrow `timeline.json` (imports, changes, their top-level totals, and any signed annotations) for the console. It is chain-tail-bound and, when a key is available, signed; the verdict still comes from `chain.json`, never from the timeline.
- **Provenance console** — the browser console now renders the chain of custody as its default view: imports, changes, and signed reasons, as an additive layer that never affects the verdict.
- **CLI-local custody view** — `tamper-signal custody` shows run cadence and archived prior chains, each re-verified, without publishing that CLI-local history.
- **Enforced verified table** — the `<tamper-signal-table>` surface ties the shown data to the verified chain.

### Added — live-source watcher

- **`tamper-signal watch`** (behind the `pip install "tamper-signal[watch]"` extra) polls a live HTTP/JSON-API or RSS/Atom feed and keeps it on the same signed chain: new data auto-appends, but a retroactive change to an already-settled period — or a slow drift that cumulatively breaches the declared band — is **withheld** as a signed pending event for a human, never signed unattended. A `--daemon`/`--interval` loop is available; the recommended deployment is the stateless tick under a systemd timer / cron.
- **`tamper-signal review`** lists, accepts, or rejects withheld changes; each acceptance signs its own human reason bound to the committed receipt, and commits the exact reviewed candidate. The console surfaces pending changes in a distinct "awaiting review" section.
- **Hardened by design** — the fetch is SSRF-validated (an affirmative `is_global` gate covering IPv4-mapped and NAT64 embedded addresses, redirects off, TLS verified, byte + wall-clock caps); RSS is parsed through `defusedxml` (billion-laughs / XXE rejected); feed change-detection uses a full-content fingerprint, never a replayable `ETag`/`304`; and the source-reset commit is crash-safe (a torn write is journaled and rolled forward, so the unattended path never self-inflicts a false-RED).

### Changed

- **The command is now `tamper-signal` on both stacks.** The Python CLI previously installed as `receipts`; it now installs as `tamper-signal` (matching the Node CLI and the package name), with the same subcommands and exit codes. `receipts` is kept as a **deprecated alias** that still works and prints a one-line notice on each run; it is scheduled for removal in 3.0. `python -m tamper_signal` is unaffected. No receipt bytes, chain format, or JSON output changed.

### Notes

- The watcher's `watch` and `review` commands are Python-only for now, as are `anchor`, `custody`, and `doctor`; the chains they produce are ordinary signed manifests and run snapshots that the JavaScript stack reads and verifies unchanged. Node anchoring is planned for 2.1. See `AGENTS.md` §5c for the watcher runbook and a hardened systemd unit.

## 1.7.2

Integration-pass fixes: smooth the first hour for an integrator copy-pasting the runbook, from a fresh `pip install` through mounting the verified table.

### Added

- **`tamper-signal assets`** copies the bundled browser surfaces (`light.js`, `badge.js`, `element.js`, `table.js`, `console.js`) into a project, default `--out badge/`, so vendoring no longer means digging through `site-packages` or `node_modules`. `--json` reports the destination and the files written.
- **`<tamper-signal-table>` web component**, the parallel of `<tamper-signal>` for the verified Data tab. Importing `tamper-signal/table` (or vendored `badge/table.js`) registers it; attributes are `chain` (required), `table` (table.json URL), and `max-rows`. Previously only `mountReceiptTable(...)` was available and the element was documented but never defined.
- **`python -m tamper_signal`** as a PATH-independent entry point. When pip installs the `receipts` console script into a bin directory that is not on PATH (common on the python.org framework Python), every `receipts <args>` works as `python3 -m tamper_signal <args>`.

### Changed

- **`tamper-signal export` accepts the chain as a positional argument** (`tamper-signal export receipts/chain.json --data ...`), matching `tamper-signal verify` and the Node CLI. The `--chain` flag still works; the positional wins when both are given. The runbook's documented `export` command now runs as written.
- **`tamper-signal serve` reports a busy port cleanly** — `port <n> is already in use — try tamper-signal serve --port <n>`, exit 1 — instead of dumping a raw `OSError` traceback. The startup banner now prints the served root URL rather than appending `/chain.json` to it.

### Docs

- The runbook (`AGENTS.md`) standardizes manual-vendor asset paths on `/badge/`, adds a note that the browser surfaces verify over HTTP and not from `file://`, documents source-only chains (a valid chain with zero transforms and exactly what it does and does not attest), and adds an install note for the "`receipts: command not found`" PATH case. Its "rules for the copy you write" section is reframed so a summarizing agent reads it as guidance about product copy, not as constraints on its own output.

### Added

- **`--json` on `tamper-signal ingest`, `export`, and `doctor`** (and the Node `tamper-signal ingest` / `export`), completing the structured surface that `verify`, `diff`, `log`, and `anchor` already had. `ingest --json` reports the source filename, evidence and semantic hashes, row/column counts, the signed tolerance, and the source-manifest path; `export --json` reports the output path, counts, data hash, and whether a bundle was written; `doctor --json` reports each check (`name`, `ok`, `fix`), the warnings, and an overall `all_passed`. Failures under `--json` print a structured `{"ok": false, "error": ...}` object on stdout. The Python and Node payloads are key-identical for every shared command; `doctor` is Python-only, since the Node CLI has no `doctor` command.
- **`band` and `settle_hours` in `log --json`**, surfaced per run entry from each run's signed tolerance declaration (omitted on runs that declared none).
- **A colored, human-facing CLI.** The verdict renders as a green/amber/red `●` light that agrees with the exit code and the verdict word; `doctor` check glyphs and `diff` / totals deltas are colored by direction (increase green, decrease red, sign always printed); secondary detail like hashes is dimmed; and `tamper-signal init` shows a first-run banner.

### Notes

- **Color never corrupts machine output.** ANSI is emitted only when stdout is an interactive terminal and is never present in `--json` output or when stdout is piped or redirected. It honors `NO_COLOR` (force off, wins over everything), `FORCE_COLOR` (force on past the TTY check), and a `--no-color` flag. A regression test in each stack asserts that no escape sequence appears under `--json` or a non-TTY pipe, even with color forced on.
- The color layer is a small dependency-free helper in each stack (`tamper_signal/color.py`, `node/color.js`) with an identical palette and gating rule, so the two CLIs read as one product. No new runtime dependency, no spec change, no change to receipt bytes.

## 1.7.0

Data portability: take the attested data out with its proof, and bring an updated file back.

### Added

- **`tamper-signal export --bundle` / `tamper-signal export --bundle`** writes a verified bundle: a store-only zip holding the data file plus `chain.json` and its receipts, byte for byte, plus a `README.md` of verify instructions, so a recipient who has never used Tamper Signal can run `tamper-signal verify chain.json` offline. Bare `export` still writes `table.json`.
- **"Take your data" in the verified Data tab** (`mountReceiptTable`): a client-side export of the attested data as a verified bundle or a bare rows-only file, in csv/tsv/json/ndjson (xlsx routes through the Python CLI). The bundle is offered only when the data is attested and the light is green or yellow; rows-only always reads as unverified.
- **`tamper-signal ingest --as replace|period` / `tamper-signal ingest --as ...`** imports a file to update the source. `replace` (default) re-signs a fresh chain and archives the prior one under `receipts/archive/<tail>/`. `period` continues the chain's run history as the next period, judged against prior snapshots through the prior run's signed tolerance band; it requires a trusted signer (`--pub` to trust a key other than the chain's) and refuses an untrusted one rather than appending silently.

### Notes

- The Semantic hash is format-agnostic, so a CSV exported from a bundle re-verifies as JSON and the light stays green. Numeric-looking text canonicalizes to its number, so leading zeros and trailing decimals do not survive a round trip.

## 1.6.0

Period-over-period continuity: the receipt chain gains a memory and a sense of normal, so the light stays trustworthy on the pipelines people actually run on a schedule.

### Added

- **`tamper-signal diff`** compares two runs (or the current chain against the latest archived run) and names what moved: per-stage code-hash changes plus a structured control-totals delta, including date ranges and changed period buckets. Read-only.
- **`tamper-signal log`** renders a per-metric trend across archived runs at day, week, month, or quarter granularity. Read-only.
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
- **Published receipts now carry daily-granularity bucket keys** when a date column is present, which discloses the date range a dataset covers. Serving stays local: `tamper-signal serve` and the framework helpers do not expose `receipts/history/`.

### Fixed

- Forced LF line endings via `.gitattributes`. A receipt chain commits to the sha256 of each receipt file's raw bytes, so a Windows checkout with `core.autocrlf=true` could rewrite committed chains and make valid tamper-signal verify as broken. They are now byte-stable on every platform.

### Notes

- The claim is unchanged: this proves **continuity, not correctness**. Tolerance bands are the producer's signed, declared expectation of normal movement, never a statement that the data is right.
- Deferred to a future release: a `suggest-bands` helper, per-metric band overrides, a browser trend view, history retention/pruning, and a snapshot mini-chain for cheap history tamper-evidence (run history is honestly weaker evidence than the chain itself).
