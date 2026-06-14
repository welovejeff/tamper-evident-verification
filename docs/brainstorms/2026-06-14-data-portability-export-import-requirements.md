---
date: 2026-06-14
topic: data-portability-export-import
---

# Data portability: verified export and import

## Summary

Make data portability a first-class Tamper Signal capability. The Data tab gets a
client-side "Take your data" export that produces either a verified zip bundle (the
native file plus its chain and receipts, re-verifiable offline) or a bare rows-only
file. A companion import re-ingests a file to update the source, in two modes:
replace (a fresh signed chain) or append-period (the next run, judged by the
existing tolerance bands). Ships as one unit with a round-trip demo, a
data-portability blog post, and a docs sweep.

## Problem Frame

Every BI tool lets you download a CSV. None of them let you take the *proof* with
the data. The moment data leaves the dashboard it becomes an unattested blob, and
the trust the chain established evaporates at the export button. That is the exact
seam this product exists to close.

The differentiator is already real and shipping: the Semantic hash is
format-agnostic, so the same data exported as CSV and re-verified as JSON produces
the same hash and a green light. The primitives also already exist — `receipts
export` writes a canonical table, `mountReceiptTable` re-hashes rows in the browser,
and `ingest` re-signs a source in both Python and JS. What is missing is the
*surfaces*: export is CLI-only and JSON-only, the browser table has no download
affordance, and import has no dashboard or library entry point. The pieces are on
the bench; this assembles them into a portability story a user can see and a post
can argue.

## Key Decisions

- **Ship export and import together as one unit.** The "take it and bring it back"
  story is only whole when both halves exist on day one; this accepts the
  re-attestation UX risk in v1 rather than deferring import.

- **A verified bundle is a zip.** It holds the native data file alongside
  `chain.json` and the `receipts/` directory, so it stays one artifact that cannot
  get separated in transit, and a recipient re-verifies it offline with the existing
  `receipts verify` unchanged. The file inside is still a genuine CSV/xlsx. Rows-only
  export is the bare native file with no proof attached.

- **Import supports two modes.** Replace re-ingests the file as a new source under
  the importer's key (a fresh chain). Append-period records the file as the next
  run, feeding the run history and tolerance-band judgment from period-over-period
  continuity (#32).

- **Naming is register-split.** The developer register keeps the precise verbs —
  the CLI stays `receipts export` and `receipts ingest`, and import maps onto the
  existing `ingest`. The plain register gets warmer copy: "Take your data" /
  "verified export" on the Data tab and "data you can take with you" in the blog. No
  working command is renamed.

- **v1 exports the full attested table only.** Export reuses the existing
  refuse-on-mismatch guard against the final receipt. Exporting a filtered or
  redacted view is deferred behind a future "attest a projection" primitive.

- **No bundle-specific anchor in v1.** Anchoring already witnesses `chain.json`, so
  a verified bundle transitively carries whatever anchor its chain already had, and
  export does not mutate the chain.

- **Append-period is a history-level judgment, not a chain extension.** Import always
  re-attests under the importer's key; the new period is recorded as a run snapshot
  and compared against prior snapshots via the tolerance bands. The system never
  claims one continuous chain across the import. The signer change surfaces through
  the existing "unrecognized signing key" yellow caveat — no new honesty surface is
  invented. This reuses the period-over-period machinery (#32), where run snapshots
  already sit outside the chain as weaker evidence.

## Actors

- A1. **Exporter** — the dashboard owner who takes their verified data out, as a
  bundle or a bare file.
- A2. **Recipient** — receives a verified bundle and re-verifies it offline, with no
  access to the original dashboard.
- A3. **Importer** — brings a file back to update the source (often the same person
  as A1).

## Key Flows

- F1. Export a verified bundle (client-side)
  - **Trigger:** A1 clicks "Take your data" on the Data tab and chooses verified
    bundle.
  - **Actors:** A1
  - **Steps:** The browser already holds the verified chain and table; it packages
    the native data file plus `chain.json` and `receipts/` into a zip and downloads
    it. csv/tsv/json/ndjson are produced client-side; xlsx routes through the Python
    path.
  - **Covered by:** R1, R2, R5, R6

- F2. Recipient re-verifies offline
  - **Trigger:** A2 receives a verified bundle on a machine with the `receipts` CLI.
  - **Actors:** A2
  - **Steps:** A2 unzips and runs `receipts verify chain.json`; the light reports
    green/yellow/red exactly as it would have in the source dashboard.
  - **Covered by:** R3, R4

- F3. Import — replace
  - **Trigger:** A3 imports an edited file to correct the source.
  - **Actors:** A3
  - **Steps:** Import re-ingests the file as a new source, signing a fresh chain
    under A3's key; the receipt records who re-attested and when; the prior chain is
    archived, not silently overwritten.
  - **Covered by:** R7, R8, R10, R11

- F4. Import — append-period
  - **Trigger:** A3 imports a fresh export as the next period's data.
  - **Actors:** A3
  - **Steps:** Import records the file as the next run and re-verifies drift through
    the declared tolerance bands; the light reports band/settled caveats as usual.
    The run is transparently attributed to A3's key.
  - **Covered by:** R9, R10, R11

## Requirements

**Export**

- R1. The Data tab offers a "Take your data" export with two outputs: a verified
  bundle and a bare rows-only file.
- R2. Export produces csv, tsv, json, and ndjson client-side; xlsx is produced via
  the Python path.
- R5. Export covers the full attested table and reuses the existing guard that
  refuses any data whose Semantic hash does not match the final receipt.

**Verified bundle**

- R3. A verified bundle is a zip containing the native data file, `chain.json`, and
  the `receipts/` directory.
- R4. A recipient re-verifies a bundle offline with `receipts verify` with no changes
  to the verification path.
- R6. A rows-only export is the bare native file and carries no proof; the UI makes
  the difference between the two outputs legible at the point of choice.

**Import**

- R7. Import in replace mode re-ingests the file as a new source, signing a fresh
  chain.
- R9. Import in append-period mode records the file as the next run snapshot and
  judges drift against prior snapshots through the declared tolerance bands (#32); it
  re-attests under the importer's key and surfaces any signer change via the existing
  unrecognized-key caveat rather than implying a continuous chain.
- R8. Replace archives the prior chain rather than silently overwriting it.

**Honesty and re-attestation**

- R10. Every import records who re-attested and when; re-attestation is never
  silent.
- R11. Import never launders unverified data into a green chain: imported data is
  attested under the importer's identity, and the verdict reflects that new identity
  (e.g., an unrecognized signing key stays yellow).

**Naming and copy**

- R12. The CLI keeps `receipts export` and `receipts ingest`; the plain-register UI
  and blog use "Take your data" / "verified export." All copy obeys MESSAGING.md
  (continuity not correctness; no banned words).

**Blog and demo**

- R13. A data-portability blog post argues the stance and uses the cross-format
  round-trip as its proof, in the established blog voice and register rules.
- R14. A round-trip demo page shows export as CSV, re-verify as JSON, and the light
  staying green.

**Docs**

- R15. README, on-site docs, CHANGELOG, llms.txt, and the FAQ are updated to cover
  export, import, and the verified bundle.

## Acceptance Examples

- AE1. Refuse mismatched export. **Covers R5.**
  - **Given** the Data tab data does not match the final receipt's output hash,
  - **When** A1 attempts a verified export,
  - **Then** export is refused with the expected-vs-found hashes, exactly as the CLI
    refuses today.

- AE2. Cross-format round trip stays green. **Covers R3, R4, R9.**
  - **Given** a verified bundle exported as CSV,
  - **When** the data is re-verified as JSON (CLI or append-period import),
  - **Then** the Semantic hash matches and the light is green.

- AE3. Append-period crosses a signer boundary. **Covers R10, R11.**
  - **Given** an append-period import signed under a key the dashboard does not
    recognize,
  - **When** the next-period run is judged,
  - **Then** the run is attributed to the importer's identity and the light reflects
    the unrecognized key (yellow), never a silent green.

- AE4. Rows-only carries no proof. **Covers R6.**
  - **Given** A1 chooses the rows-only output,
  - **When** the file is downloaded,
  - **Then** it is the bare native file with no chain or receipts, and the UI made
    clear it is unverified before download.

## Scope Boundaries

**Deferred for later**

- Filtered/redacted-view export — depends on a future "attest a projection"
  primitive (its own receipt over the shown columns/rows). v1 exports the full
  attested table only.
- A bundle-specific anchor option (witnessing the export event itself in the
  transparency log).

**Outside this product's identity**

- Any claim that an exported or re-imported file is *correct*. Portability moves
  attested data and its proof; it never asserts the numbers are right. Continuity,
  not correctness.

## Dependencies / Assumptions

- Builds on shipped primitives: `receipts export` (refuse-on-mismatch), the canonical
  table document, `mountReceiptTable`, and `ingest` (Python + JS).
- Append-period import depends on the period-over-period continuity machinery (#32):
  run history, period buckets, and tolerance bands.
- Assumes client-side zip construction is acceptable in the browser; xlsx remains a
  Python-path output.

## Outstanding Questions

**Deferred to planning**

- Where the import entry point lives (CLI flag shape, dashboard control, library
  function) and how replace-mode archival is stored.
- Whether the verified bundle needs a manifest/version marker beyond the existing
  `chain.json` for forward compatibility.

## Sources / Research

- `tamper_signal/cli.py` — `cmd_export` (refuse-on-mismatch, `table.json` output)
  and the `ingest` next-step hint.
- `badge/table.js`, `badge/table.d.ts` — `mountReceiptTable`, the verified Data tab.
- `tamper_signal/__init__.py`, `node/index.js` — `ingest` in both runtimes.
- `docs/MESSAGING.md` — two-register rule, banned words, continuity-not-correctness.
- `blog/show-your-work.html` — the redacted-projection idea (rhetorical, not yet
  built) that filtered-view export depends on.
- `CONCEPTS.md` — Semantic hash, Anchor, run snapshots, tolerance/settling.
