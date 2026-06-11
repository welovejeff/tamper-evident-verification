"""Tests for the agent-ergonomics CLI commands: init, verify --json, doctor."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tamper_signal.canonical import semantic_hash
from tamper_signal.cli import main
from tamper_signal.keys import generate_keys, load_private_key, public_hex_from_private
from tamper_signal.receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    read_receipt,
    write_chain,
    write_receipt,
)

from test_tamper_signal import sample_records


def _seed_chain(tmp_path) -> str:
    """Write keys + a one-receipt chain in tmp_path; return public hex."""
    generate_keys(str(tmp_path / "keys"))
    private = load_private_key(str(tmp_path / "keys" / "signing.key"))
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    write_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME, manifest)
    write_chain(str(tmp_path / "receipts"), [SOURCE_RECEIPT_NAME], public_hex_from_private(private))
    return public_hex_from_private(private)


# ---------------------------------------------------------------------------
# receipts init
# ---------------------------------------------------------------------------
def test_init_scaffolds_and_is_idempotent(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["init"]) == 0
    out = capsys.readouterr().out
    assert "generated" in out and "Next:" in out
    assert (tmp_path / "keys" / "signing.key").exists()
    assert (tmp_path / "receipts").is_dir()
    gitignore = (tmp_path / ".gitignore").read_text()
    assert "keys/" in gitignore and "*.key" in gitignore

    # Second run: nothing regenerated, no duplicate gitignore lines.
    key_bytes = (tmp_path / "keys" / "signing.key").read_bytes()
    assert main(["init"]) == 0
    assert (tmp_path / "keys" / "signing.key").read_bytes() == key_bytes
    assert (tmp_path / ".gitignore").read_text().count("keys/") == 1


def test_init_appends_to_existing_gitignore(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".gitignore").write_text("node_modules\n")
    assert main(["init"]) == 0
    lines = (tmp_path / ".gitignore").read_text().splitlines()
    assert "node_modules" in lines and "keys/" in lines and "*.key" in lines


# ---------------------------------------------------------------------------
# receipts verify --json
# ---------------------------------------------------------------------------
def test_verify_json_green(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    code = main(["verify", "receipts/chain.json", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 0
    assert payload["verdict"] == "green"
    assert payload["exit_code"] == 0
    assert payload["receipts"] == 1
    assert payload["broken_link"] is None
    assert payload["stages"] == ["source"]
    assert payload["final_row_count"] == len(sample_records())


def test_verify_json_red_carries_structured_break(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    public_hex = _seed_chain(tmp_path)
    # Tamper the receipt without re-signing: signature failure, red. Rewriting
    # the chain keeps its recorded receipt hashes current, so the failure
    # surfaces at the signature layer this test targets (the hash layer has
    # its own test in test_tier4_hardening).
    receipt = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    receipt["semantic_hash"] = "0" * 64
    write_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME, receipt)
    write_chain(str(tmp_path / "receipts"), [SOURCE_RECEIPT_NAME], public_hex)

    code = main(["verify", "receipts/chain.json", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 1
    assert payload["verdict"] == "red"
    assert any("SIGNATURE INVALID" in line for line in payload["report"])


def test_verify_json_yellow_lists_caveats(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    other = tmp_path / "other"
    generate_keys(str(other))
    code = main(["verify", "receipts/chain.json", "--pub", str(other / "signing.pub"), "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["verdict"] == "yellow"
    assert any("unrecognized signing key" in c for c in payload["caveats"])


# ---------------------------------------------------------------------------
# receipts doctor
# ---------------------------------------------------------------------------
def test_doctor_passes_on_healthy_setup(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    main(["init"])
    _seed_chain(tmp_path)
    assert main(["doctor"]) == 0
    assert "All checks passed." in capsys.readouterr().out


def test_doctor_fails_without_key(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    code = main(["doctor"])
    out = capsys.readouterr().out
    assert code == 1
    assert "receipts init" in out  # the fix is named


def test_doctor_fails_on_broken_chain(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    main(["init"])
    _seed_chain(tmp_path)
    receipt = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    receipt["signature"]["value"] = "00" * 64
    write_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME, receipt)
    assert main(["doctor"]) == 1
    assert "chain verifies" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# receipts export (the verified Data tab document)
# ---------------------------------------------------------------------------
def test_export_writes_canonical_document_matching_final_receipt(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    records = sample_records()
    data = tmp_path / "current.json"
    data.write_text(json.dumps([
        {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()}
        for r in records
    ]), encoding="utf-8")

    assert main(["export", "--chain", "receipts/chain.json", "--data", str(data)]) == 0
    document = json.loads((tmp_path / "receipts" / "table.json").read_text())
    assert set(document) == {"headers", "rows"}
    assert len(document["rows"]) == len(records)

    # The document hashes to exactly the final receipt's output hash.
    from tamper_signal.canonical import canonical_json_bytes
    import hashlib

    receipt = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    assert hashlib.sha256(canonical_json_bytes(document)).hexdigest() == receipt["semantic_hash"]


def test_export_refuses_mismatched_data(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    data = tmp_path / "wrong.json"
    data.write_text('[{"a": 1}]', encoding="utf-8")
    assert main(["export", "--chain", "receipts/chain.json", "--data", str(data)]) == 1
    assert not (tmp_path / "receipts" / "table.json").exists()
    assert "Refusing to export" in capsys.readouterr().err
