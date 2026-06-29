"""Tests for the narrow published provenance timeline (plan U3)."""

from __future__ import annotations

import json

from tamper_signal.canonical import semantic_hash
from tamper_signal.cli import main
from tamper_signal.keys import load_private_key, public_hex_from_private
from tamper_signal.receipts import (
    build_transform_receipt,
    read_chain,
    read_receipt,
    verify_signature,
    write_chain,
    write_receipt,
)

from test_cli_agent_ergonomics import _seed_chain
from test_tamper_signal import sample_records


def _read_timeline(tmp_path):
    return json.loads((tmp_path / "receipts" / "timeline.json").read_text())


def test_timeline_lists_import_and_signed_annotation(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    public_hex = _seed_chain(tmp_path)
    main(["annotate", "receipts/chain.json", "--reason", "source looks right", "--author", "Jeff"])
    capsys.readouterr()
    assert main(["timeline", "receipts/chain.json"]) == 0

    doc = _read_timeline(tmp_path)
    assert doc["kind"] == "timeline"
    chain = read_chain(str(tmp_path / "receipts" / "chain.json"))
    # Bound to the chain tail (the console's integrity check).
    assert doc["chain_tail"] == chain["receipt_hashes"][chain["receipts"][-1]]
    assert doc["entries"][0]["kind"] == "import"
    annotations = doc["entries"][0]["annotations"]
    assert annotations[0]["reason"] == "source looks right"
    assert annotations[0]["author"] == "Jeff"
    assert annotations[0]["self_declared"] is True
    # The whole document is signed under the chain key (key on disk).
    assert verify_signature(doc, public_hex)


def test_timeline_omits_per_day_buckets_and_date_ranges(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    main(["timeline", "receipts/chain.json"])
    doc = _read_timeline(tmp_path)
    for entry in doc["entries"]:
        assert "period_buckets" not in entry["totals"]
        assert "date_ranges" not in entry["totals"]


def test_timeline_renders_change_entry_with_row_delta(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    private = load_private_key("keys/signing.key")
    public_hex = public_hex_from_private(private)
    source = read_receipt("receipts", "000_source.json")
    fewer = sample_records()[:1]
    transform = build_transform_receipt(
        name="aggregate", code_hash="ab" * 16, code_file="pipeline.py",
        input_semantic_hash=source["semantic_hash"],
        output_semantic_hash=semantic_hash(fewer),
        output_records=fewer, private_key=private,
    )
    write_receipt("receipts", "001_aggregate.json", transform)
    write_chain("receipts", ["000_source.json", "001_aggregate.json"], public_hex)

    assert main(["timeline", "receipts/chain.json"]) == 0
    doc = _read_timeline(tmp_path)
    assert [e["kind"] for e in doc["entries"]] == ["import", "change"]
    change = doc["entries"][1]
    assert change["stage"] == "aggregate"
    assert change["code_hash"] == "ab" * 16
    assert change["row_delta"] == len(fewer) - len(sample_records())


def test_timeline_json_surface(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    capsys.readouterr()
    assert main(["timeline", "receipts/chain.json", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["entries"] == 1
    assert payload["signed"] is True
    assert payload["chain_tail"]
    assert payload["output"].endswith("timeline.json")
