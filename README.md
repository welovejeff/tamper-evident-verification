# lineage-receipts

A signed data lineage chain for analytics pipelines. A marketing team downloads a large xlsx export from a social tool (Sprinklr, Meta, and the like), runs it through LLM-generated transform scripts, and renders it in a live dashboard. Today there is no way to prove the dashboard numbers descend from the original export, or to locate where a discrepancy was introduced. This project gives each pipeline stage a signed receipt containing the hash of its input, the hash of its code, the hash of its output, and human-legible control totals. Receipts link because each stage's input hash must equal the prior stage's output hash, and a verifier replays the chain and reports PASS, or FAIL with the exact broken link.

## Quick start

```bash
pip install -e .
lineage demo
```

`lineage demo` runs the whole pipeline end to end: it generates a messy sample export, ingests it, runs two transforms through the `@lineage_step` wrapper, verifies the chain (PASS), then tampers with the dashboard file and verifies again (FAIL, with the totals delta that pinpoints the change). It then serves a browser badge at `http://localhost:8000/badge/badge.html` that re-verifies the chain in your browser.

## Commands

```bash
lineage keygen --out keys/
lineage ingest sample_export.xlsx --origin "Sprinklr export, May 2026" --key keys/signing.key --out receipts/
lineage verify receipts/chain.json --pub keys/signing.pub --data dashboard.xlsx
```

Transforms record their own receipts by wrapping a list-of-dicts to list-of-dicts function:

```python
from lineage import lineage_step

@lineage_step(chain_dir="receipts/", key_path="keys/signing.key")
def transform_clean(records):
    return [r for r in records if r.get("campaign_name")]
```

The wrapper verifies the chain tail, asserts the input hash matches the tail's output hash (it refuses to run otherwise), runs the function, then signs and appends a receipt.

## Receipt shapes

Source manifest (ingest):

```json
{
  "kind": "source_manifest",
  "spec_version": "1.0",
  "created_at": "2026-06-09T14:30:00Z",
  "source": {
    "filename": "sprinklr_export_may.xlsx",
    "evidence_hash": "<sha256 of raw bytes>",
    "byte_size": 18734221,
    "declared_origin": "Sprinklr export, May 2026"
  },
  "semantic_hash": "<sha256 of canonical data>",
  "control_totals": { "row_count": 48212, "column_count": 9, "numeric_sums": {}, "date_ranges": {}, "null_counts": {} },
  "signature": { "alg": "ed25519", "key_fingerprint": "...", "value": "<hex>" }
}
```

Transform receipt:

```json
{
  "kind": "transform_receipt",
  "spec_version": "1.0",
  "created_at": "...",
  "transform": { "name": "transform_clean", "code_hash": "<sha256 of source>", "code_file": "examples/transform_clean.py" },
  "input_semantic_hash": "<equals previous receipt's output hash>",
  "output_semantic_hash": "...",
  "output_control_totals": { },
  "signature": { }
}
```

Two hashes exist per artifact. The **evidence hash** is SHA-256 of the raw file bytes, computed once at ingest to anchor the original file. The **semantic hash** is SHA-256 of the canonicalized data content, stable across format round-trips (xlsx re-save, xlsx to CSV, xlsx to JSON) so long as the values are unchanged. Row order is not part of integrity: rows are sorted before hashing.

## Browser badge

`badge/badge.js` exports `renderLineageBadge(containerEl, chainUrl, pubKeyHex)`. It fetches the chain and every receipt, re-verifies all signatures with Web Crypto Ed25519, and re-checks every hash link. It re-links hashes only; it does not re-canonicalize xlsx in the browser. If the browser lacks Ed25519 it renders an amber "verification unsupported" state.

![Lineage badge: green intact chain and red broken chain](badge/badge-demo.png)

## What this proves, and what it does not prove

This proves **continuity, not correctness**. The chain shows that the dashboard numbers descend from the ingested export through a known sequence of code, and it locates the exact stage where a number changed unexpectedly. If the source export is itself wrong, the chain faithfully verifies wrong numbers. It is not a data-quality tool and makes no claim about whether the source data is accurate.

## Relation to OpenLineage, dbt, and Great Expectations

OpenLineage and dbt model lineage and transformations at the warehouse and orchestration layer; Great Expectations validates data quality against declared expectations. This project is narrower and lighter: a signed, file-based receipt chain that a small analytics team can drop in front of an ad-hoc xlsx-to-dashboard pipeline to get cryptographic continuity without a database, a server, or a metadata catalog. It is a complement for the gap before those tools are in place, not a replacement for them.

## Legacy demo

The original Luhn and single-computation hash demo now lives unchanged in `legacy/` and is no longer on the main path.
