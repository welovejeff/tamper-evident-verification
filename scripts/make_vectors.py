"""Regenerate the cross-language golden vectors at node/test/vectors.json.

The vectors are the contract between the Python canonicalization
(tamper_signal/canonical.py) and the Node port (node/canonical.js): for each
entry, both sides must produce byte-identical canonical JSON and the same
semantic hash. Entries may also carry optional "bucket_column" and
"period_buckets" fields (spec 1.2) describing the per-UTC-day buckets
control_totals computes for the same records; consumers that do not know
those fields ignore them.

Typed values are encoded with markers so the JSON file stays declarative:

    {"__date__": "YYYY-MM-DD"}              -> datetime.date / JS Date (midnight UTC)
    {"__datetime__": "YYYY-MM-DDTHH:MM:SSZ"} -> datetime.datetime / JS Date

Canonicalization never moves inside a spec bump that only adds totals fields,
so this script fails loudly if any pre-existing entry's semantic hash drifts
from the frozen value recorded below (semantic hashes cover the canonical
bytes, so hash equality implies byte equality).

Run from the repo root: python scripts/make_vectors.py
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tamper_signal.canonical import canonicalize, semantic_hash
from tamper_signal.totals import control_totals

OUT_PATH = Path("node/test/vectors.json")
UTC = dt.timezone.utc

# Semantic hashes frozen when each entry was first committed. A regeneration
# that moves any of these is a canonicalization change, not a totals change,
# and must be treated as a spec-breaking bug until proven otherwise.
FROZEN_HASHES = {
    "mixed types, shuffled rows, numeric text, dates":
        "64b96900ef4e99d550bc3382dcfc64afb39c26c247835366bd8e0d55107d1c8c",
    "float artifacts, negative zero, big ints, exponent text":
        "ef0590333cb71cf5beca635897a16b6edcfd67ff0bfcc1c6c431bf95fe5d3a5d",
    "unicode NFD input, whitespace trim, empty string vs null":
        "844ff5f0d41ddc17ee9937a59e68a43e143954c17dc1e5d2bb700d6ed887ab74",
    "header normalization and union of keys":
        "8a41089d5444c9ce8887f654c40a768ff0472f5e16638bedf3a432b28ef3b9b2",
    "midnight datetime collapses to date; real timestamp keeps time":
        "9c7c3f0f2885b729f63f7c1f1130af8f09016c2c90739d71aa98e1f1ac31e31d",
    "tiny values quantize half-even at six places":
        "154bbdb4556dd3f8ad90a68c9c3c07c0a32c602c357da87db9bda04198e28325",
}


def _vector_inputs() -> list[dict[str, Any]]:
    """Every vector's name, records (typed), and whether to emit buckets."""
    return [
        {
            "name": "mixed types, shuffled rows, numeric text, dates",
            "records": [
                {"date": dt.date(2026, 5, 3), "campaign_name": "c",
                 "impressions": 300, "spend_usd": 30.0, "active": True},
                {"date": dt.date(2026, 5, 1), "campaign_name": "a",
                 "impressions": "100", "spend_usd": "10.50", "active": False},
                {"date": dt.date(2026, 5, 2), "campaign_name": None,
                 "impressions": 200, "spend_usd": 20.25, "active": None},
            ],
        },
        {
            "name": "float artifacts, negative zero, big ints, exponent text",
            "records": [
                {"x": 0.30000000000000004, "y": -0.0,
                 "z": 1000000000000000, "w": "1e3"},
                {"x": 0.3, "y": 0, "z": "1000000000000000", "w": 1000},
            ],
        },
        {
            "name": "unicode NFD input, whitespace trim, empty string vs null",
            "records": [
                {"col": "café", "note": "  padded  ",
                 "empty": "", "missing": None},
            ],
        },
        {
            "name": "header normalization and union of keys",
            "records": [
                {"Total  Spend (USD)": 10, "Channel": "fb"},
                {"total spend (usd)": "20.0", "Channel": "ig", "extra": "x"},
            ],
        },
        {
            "name": "midnight datetime collapses to date; real timestamp keeps time",
            "records": [
                {"a": dt.datetime(2026, 5, 1, 0, 0, 0, tzinfo=UTC),
                 "b": dt.datetime(2026, 5, 1, 13, 45, 9, tzinfo=UTC)},
            ],
        },
        {
            "name": "tiny values quantize half-even at six places",
            "records": [
                {"a": "0.0000005", "b": "0.0000015", "c": 4e-07, "d": "-0.0000005"},
            ],
        },
        # --- spec 1.2 bucket entries -------------------------------------
        {
            "name": "bucketing: typed-date column with numeric sums",
            "buckets": True,
            "records": [
                {"day": dt.date(2026, 5, 1), "amount": "10.50", "category": "a"},
                {"day": dt.date(2026, 5, 1), "amount": 5, "category": "b"},
                {"day": dt.date(2026, 5, 2), "amount": 20, "category": None},
                {"day": None, "amount": 1, "category": "c"},
            ],
        },
        {
            "name": "bucketing: same data as ISO strings matches typed dates",
            "buckets": True,
            "records": [
                {"day": "2026-05-01", "amount": "10.50", "category": "a"},
                {"day": "2026-05-01", "amount": 5, "category": "b"},
                {"day": "2026-05-02", "amount": 20, "category": None},
                {"day": None, "amount": 1, "category": "c"},
            ],
        },
        {
            "name": "bucketing: midnight datetime collapses into its bare-date bucket",
            "buckets": True,
            "records": [
                {"day": dt.date(2026, 5, 2), "amount": 1},
                {"day": dt.datetime(2026, 5, 2, 0, 0, 0, tzinfo=UTC), "amount": 2},
                {"day": "2026-05-02 00:00", "amount": 3},
                {"day": dt.datetime(2026, 5, 1, 23, 30, 0, tzinfo=UTC), "amount": 4},
            ],
        },
    ]


def _encode_value(value: Any) -> Any:
    """Encode one cell for the JSON file, marking typed dates/datetimes."""
    if isinstance(value, dt.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(UTC)
        return {"__datetime__": value.strftime("%Y-%m-%dT%H:%M:%SZ")}
    if isinstance(value, dt.date):
        return {"__date__": value.isoformat()}
    return value


def _encode_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: _encode_value(v) for k, v in record.items()} for record in records]


def main() -> int:
    vectors: list[dict[str, Any]] = []
    by_name: dict[str, dict[str, Any]] = {}
    for spec in _vector_inputs():
        records = spec["records"]
        entry: dict[str, Any] = {
            "name": spec["name"],
            "records": _encode_records(records),
            "canonical": canonicalize(records).decode("utf-8"),
            "semantic_hash": semantic_hash(records),
        }
        if spec.get("buckets"):
            totals = control_totals(records)
            if "period_buckets" not in totals:
                raise SystemExit(f"FAIL: no bucket column detected for {spec['name']!r}")
            entry["bucket_column"] = totals["bucket_column"]
            entry["period_buckets"] = totals["period_buckets"]
        vectors.append(entry)
        by_name[entry["name"]] = entry

    # Canonicalization must not move: every frozen hash must reproduce.
    moved = [
        name
        for name, expected in FROZEN_HASHES.items()
        if by_name[name]["semantic_hash"] != expected
    ]
    if moved:
        for name in moved:
            print(f"FAIL: semantic hash moved for vector {name!r}", file=sys.stderr)
            print(f"  frozen: {FROZEN_HASHES[name]}", file=sys.stderr)
            print(f"  now:    {by_name[name]['semantic_hash']}", file=sys.stderr)
        raise SystemExit("canonicalization changed; do NOT regenerate vectors over this")

    # Typed dates and the same data as ISO strings are one contract: identical
    # canonical bytes, identical hash, identical buckets.
    typed = by_name["bucketing: typed-date column with numeric sums"]
    strings = by_name["bucketing: same data as ISO strings matches typed dates"]
    if typed["semantic_hash"] != strings["semantic_hash"]:
        raise SystemExit("FAIL: typed-date and ISO-string vectors hash differently")
    if typed["period_buckets"] != strings["period_buckets"]:
        raise SystemExit("FAIL: typed-date and ISO-string vectors bucket differently")

    document = {
        "generated_by": (
            "python scripts/make_vectors.py (spec 1.2); "
            "run from the repo root to regenerate"
        ),
        "vectors": vectors,
    }
    OUT_PATH.write_text(
        json.dumps(document, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Wrote {OUT_PATH} ({len(vectors)} vectors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
