"""Cross-format portability integrity (U7).

The bundle/byte round-trip (export --bundle -> unzip -> verify green, byte-exact
on Windows) is covered by the export tests in test_cli_agent_ergonomics.py, which
run on the windows-latest CI matrix. This file pins the format-agnostic guarantee:
a file reconstructed from the attested canonical document, in any client-side
format, re-ingests to the SAME Semantic hash -- so a CSV exported here and
re-verified as JSON stays green (AE2, R16). It also pins the known round-trip
caveat: numeric-looking text collapses to its number, so leading zeros and
trailing decimals do not survive a round-trip.
"""

from __future__ import annotations

import csv
import io
import json

import pytest

from tamper_signal.canonical import canonical_document, load_records, semantic_hash

from test_tamper_signal import sample_records


def _serialize(doc: dict, fmt: str) -> str:
    """Reconstruct a native-format file from a canonical document, the way the
    browser 'Take your data' export does (badge/room.js serializeDoc)."""
    headers, rows = doc["headers"], doc["rows"]

    def cell(v):
        if v is None:
            return ""
        if v is True:
            return "true"
        if v is False:
            return "false"
        return str(v)

    if fmt == "json":
        return json.dumps([dict(zip(headers, r)) for r in rows])
    if fmt == "ndjson":
        return "\n".join(json.dumps(dict(zip(headers, r))) for r in rows)
    out = io.StringIO()
    writer = csv.writer(out, delimiter="\t" if fmt == "tsv" else ",")
    writer.writerow(headers)
    for r in rows:
        writer.writerow([cell(c) for c in r])
    return out.getvalue()


@pytest.mark.parametrize("fmt", ["csv", "tsv", "json", "ndjson"])
def test_reconstructed_file_reingests_to_attested_hash(tmp_path, fmt):
    records = sample_records()
    expected = semantic_hash(records)  # the attested hash
    doc = canonical_document(records)  # what the browser holds

    path = tmp_path / f"reconstructed.{fmt}"
    path.write_text(_serialize(doc, fmt), encoding="utf-8")

    # Re-ingesting the reconstructed file (in ANY format) yields the same hash:
    # export as one format, re-verify as another, the light stays green.
    assert semantic_hash(load_records(str(path))) == expected


def test_all_reconstructed_formats_share_one_hash(tmp_path):
    records = sample_records()
    doc = canonical_document(records)
    hashes = set()
    for fmt in ("csv", "tsv", "json", "ndjson"):
        path = tmp_path / f"r.{fmt}"
        path.write_text(_serialize(doc, fmt), encoding="utf-8")
        hashes.add(semantic_hash(load_records(str(path))))
    assert len(hashes) == 1, "every client-side format must reconstruct to one hash"


def test_numeric_text_collapse_is_a_known_round_trip_caveat():
    # "030" and "30.00" canonicalize to the number 30, so leading zeros and
    # trailing decimals do not survive a round-trip. Pinned so the blog/docs
    # caveat stays true and a future canonicalization change is caught here.
    styled = [{"id": "030", "amount": "30.00"}]
    plain = [{"id": "30", "amount": "30"}]
    assert semantic_hash(styled) == semantic_hash(plain)
