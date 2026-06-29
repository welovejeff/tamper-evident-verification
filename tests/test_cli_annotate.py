"""Tests for `receipts annotate` (plan U2)."""

from __future__ import annotations

import json

from tamper_signal.annotations import read_annotations, resolve_annotations
from tamper_signal.cli import main
from tamper_signal.receipts import read_chain, verify_signature

from test_cli_agent_ergonomics import _seed_chain


def _targets(tmp_path):
    chain = read_chain(str(tmp_path / "receipts" / "chain.json"))
    return set(chain["receipt_hashes"].values())


def test_annotate_writes_signed_annotation_bound_to_tail(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    public_hex = _seed_chain(tmp_path)
    code = main(["annotate", "receipts/chain.json", "--reason", "fixed the spend total",
                 "--author", "Jeff", "--key", "keys/signing.key"])
    assert code == 0

    raw = read_annotations("receipts")
    assert len(raw) == 1
    assert verify_signature(raw[0], public_hex)  # the on-disk record verifies

    resolved = resolve_annotations(raw, public_hex, _targets(tmp_path))
    assert len(resolved) == 1
    assert resolved[0]["reason"] == "fixed the spend total"
    assert resolved[0]["author"] == "Jeff"


def test_annotate_json_surface(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    capsys.readouterr()
    code = main(["annotate", "receipts/chain.json", "--reason", "r", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 0
    assert payload["hash"] and payload["target"]
    assert payload["annotation"].endswith(".json")


def test_annotate_correction_supersedes(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    public_hex = _seed_chain(tmp_path)
    main(["annotate", "receipts/chain.json", "--reason", "hasty", "--json"])
    first_hash = json.loads(capsys.readouterr().out)["hash"]
    main(["annotate", "receipts/chain.json", "--reason", "corrected", "--supersedes", first_hash, "--json"])
    capsys.readouterr()

    resolved = resolve_annotations(read_annotations("receipts"), public_hex, _targets(tmp_path))
    assert len(resolved) == 2
    by_hash = {a["_hash"]: a for a in resolved}
    assert by_hash[first_hash]["_superseded"] is True


def test_annotate_empty_chain_errors(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "receipts").mkdir()
    (tmp_path / "receipts" / "chain.json").write_text(
        json.dumps({"spec_version": "1.2", "public_key": "00", "receipts": [], "receipt_hashes": {}}),
        encoding="utf-8",
    )
    code = main(["annotate", "receipts/chain.json", "--reason", "r"])
    assert code == 1
    assert "empty" in capsys.readouterr().err.lower()
