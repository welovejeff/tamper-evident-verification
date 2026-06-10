# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## The receipt chain

### Receipt
A cryptographically signed record that one pipeline stage emits, capturing a fingerprint of the data it received, the code it ran, the data it produced, and that stage's Control totals. Receipts are plain files on disk; no database or server is involved.

### Chain
The ordered sequence of Receipts for a pipeline, verified link by link: each Receipt's input fingerprint must equal the previous Receipt's output fingerprint, and every signature must check. A chain has exactly two honest endpoints — intact or broken — and a broken chain is reported at the exact link that failed.

### Evidence hash
The fingerprint of an artifact's raw bytes, taken once at ingest. It anchors the original file exactly as exported and is never recomputed downstream.

### Semantic hash
The fingerprint of an artifact's canonicalized data content, stable across format round-trips (re-save, format conversion) so long as the values are unchanged. Row order is not part of integrity; rows are sorted before hashing. The Evidence hash answers "is this the same file"; the Semantic hash answers "is this the same data."

### Control totals
Human-legible aggregates (row counts, numeric sums, date ranges, null counts) recorded in every Receipt. Hashes say a chain is broken; Control totals say how broken — the delta between stages quantifies what changed.

## Verification verdicts

### Continuity
The property this system proves: the data behind a result descends from the original export through a known sequence of code, unchanged. Continuity is explicitly not correctness — a chain over wrong source data verifies faithfully. The product's one forbidden claim is that verification "ensures accuracy."

### The light
The user-facing verdict, expressed as a traffic light. Green: every link in the Chain verifies and every signature checks ("The light is green, the data is clean"). Yellow: the chain is verifiable but carries caveats — coverage gaps, an unrecognized signing key, or Control-total drift — and a human should look. Red: the Chain is broken at a specific link, with the expected and found fingerprints and the Control-totals delta. Yellow never blames; red points rather than panics.
