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


# ---------------------------------------------------------------------------
# receipts ingest --band / --settle / --bucket-column (tolerance declaration)
# ---------------------------------------------------------------------------
DATED_CSV = "day,amount\n2026-05-01,10.5\n2026-05-01,4.5\n2026-05-02,20\n"
TWO_DATE_CSV = (
    "created,settled,amount\n"
    "2026-05-01,2026-05-03,1\n"
    "2026-05-02,2026-05-03,2\n"
)

# Manifest body keys before tolerance declarations existed; a no-flags ingest
# must produce exactly this set so undeclared chains stay byte-compatible.
PRE_TOLERANCE_MANIFEST_KEYS = {
    "kind", "spec_version", "created_at", "source",
    "semantic_hash", "control_totals", "signature",
}


def _ingest_with(tmp_path, csv_text: str, *flags: str) -> int:
    """Run `receipts ingest` over csv_text with extra flags; return exit code."""
    if not (tmp_path / "keys" / "signing.key").exists():
        generate_keys(str(tmp_path / "keys"))
    data = tmp_path / "export.csv"
    data.write_text(csv_text, encoding="utf-8")
    return main([
        "ingest", str(data),
        "--origin", "t",
        "--key", str(tmp_path / "keys" / "signing.key"),
        "--out", str(tmp_path / "receipts"),
        *flags,
    ])


def test_ingest_band_records_signed_tolerance_with_default_settle(tmp_path, capsys):
    assert _ingest_with(tmp_path, DATED_CSV, "--band", "5%") == 0
    out = capsys.readouterr().out
    assert "tolerance band 0.05, settle_hours 72" in out

    manifest = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    assert manifest["tolerance"] == {"band": "0.05", "settle_hours": 72}

    # The declaration is covered by the signature: verify passes as-is.
    code = main(["verify", str(tmp_path / "receipts" / "chain.json"), "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 0
    assert payload["verdict"] == "green"
    assert payload["caveats"] == []


def test_hand_editing_the_band_breaks_the_signature(tmp_path, capsys):
    assert _ingest_with(tmp_path, DATED_CSV, "--band", "5%") == 0
    capsys.readouterr()

    from tamper_signal.receipts import read_chain

    receipts_dir = str(tmp_path / "receipts")
    manifest = read_receipt(receipts_dir, SOURCE_RECEIPT_NAME)
    manifest["tolerance"]["band"] = "0.10"
    write_receipt(receipts_dir, SOURCE_RECEIPT_NAME, manifest)
    # Rewrite the chain so its recorded receipt hashes stay current and the
    # failure surfaces at the signature layer (the field is signed).
    chain = read_chain(str(tmp_path / "receipts" / "chain.json"))
    write_chain(receipts_dir, [SOURCE_RECEIPT_NAME], chain["public_key"])

    code = main(["verify", str(tmp_path / "receipts" / "chain.json"), "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 1
    assert payload["verdict"] == "red"
    assert any("SIGNATURE INVALID" in line for line in payload["report"])


def test_ingest_without_flags_writes_no_tolerance_and_verifies_clean(tmp_path, capsys):
    assert _ingest_with(tmp_path, DATED_CSV) == 0
    out = capsys.readouterr().out
    assert "tolerance" not in out

    manifest = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    assert "tolerance" not in manifest
    assert set(manifest) == PRE_TOLERANCE_MANIFEST_KEYS

    code = main(["verify", str(tmp_path / "receipts" / "chain.json"), "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 0
    assert payload["verdict"] == "green"
    assert payload["caveats"] == []


@pytest.mark.parametrize("band", ["-3%", "0", "0%", "banana", "150%", "5"])
def test_invalid_band_exits_1_and_writes_nothing(tmp_path, capsys, band):
    # --band=value form: argparse rejects bare values starting with "-".
    assert _ingest_with(tmp_path, DATED_CSV, f"--band={band}") == 1
    assert "invalid --band" in capsys.readouterr().err
    assert not (tmp_path / "receipts" / SOURCE_RECEIPT_NAME).exists()


@pytest.mark.parametrize("settle", ["0", "-5", "banana", "1.5h", "0d"])
def test_invalid_settle_exits_1_and_writes_nothing(tmp_path, capsys, settle):
    assert _ingest_with(tmp_path, DATED_CSV, f"--settle={settle}") == 1
    assert "invalid --settle" in capsys.readouterr().err
    assert not (tmp_path / "receipts" / SOURCE_RECEIPT_NAME).exists()


def test_settle_days_convert_to_hours_and_imply_default_band(tmp_path, capsys):
    assert _ingest_with(tmp_path, DATED_CSV, "--settle", "3d") == 0
    manifest = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    assert manifest["tolerance"] == {"band": "0.05", "settle_hours": 72}


def test_band_canonical_forms_are_pinned():
    # The canonical band form is the plain decimal string the totals
    # serializer produces; node/test/pipeline.test.js pins the same forms.
    from tamper_signal.cli import parse_band, parse_settle

    assert parse_band("5%") == "0.05"
    assert parse_band("5 %") == "0.05"
    assert parse_band("0.05") == "0.05"
    assert parse_band("0.050") == "0.05"
    assert parse_band("5.5%") == "0.055"
    assert parse_band("100%") == "1"
    assert parse_settle("3d") == 72
    assert parse_settle("72h") == 72
    assert parse_settle("72") == 72


def test_bucket_column_non_qualifying_exits_1_and_writes_nothing(tmp_path, capsys):
    assert _ingest_with(tmp_path, TWO_DATE_CSV, "--bucket-column", "amount") == 1
    assert "does not qualify" in capsys.readouterr().err
    assert not (tmp_path / "receipts" / SOURCE_RECEIPT_NAME).exists()


def test_bucket_column_declares_and_keys_the_period_buckets(tmp_path, capsys):
    # Two qualifying date columns: only the explicit declaration buckets.
    assert _ingest_with(tmp_path, TWO_DATE_CSV, "--bucket-column", "created") == 0
    manifest = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    assert manifest["tolerance"] == {
        "band": "0.05", "settle_hours": 72, "bucket_column": "created",
    }
    totals = manifest["control_totals"]
    assert totals["bucket_column"] == "created"
    assert set(totals["period_buckets"]) == {"2026-05-01", "2026-05-02"}


def test_tolerance_manifest_canonical_bytes_are_pinned_cross_stack():
    """A manifest body WITH tolerance canonicalizes to the same bytes in both
    stacks: node/test/pipeline.test.js pins this exact body to this hash."""
    import hashlib

    from tamper_signal.canonical import canonical_json_bytes

    body = {
        "kind": "source_manifest",
        "spec_version": "1.2",
        "created_at": "2026-06-12T00:00:00Z",
        "source": {
            "filename": "export.csv",
            "evidence_hash": "aa" * 32,
            "byte_size": 64,
            "declared_origin": "tolerance pin",
        },
        "semantic_hash": "bb" * 32,
        "control_totals": {
            "row_count": 2,
            "column_count": 2,
            "numeric_sums": {"amount": "15"},
            "date_ranges": {},
            "null_counts": {},
            "bucket_column": "day",
            "period_buckets": {
                "2026-05-01": {
                    "row_count": 2,
                    "numeric_sums": {"amount": "15"},
                    "null_counts": {},
                }
            },
        },
        "tolerance": {"band": "0.05", "settle_hours": 72, "bucket_column": "day"},
    }
    assert hashlib.sha256(canonical_json_bytes(body)).hexdigest() == (
        "1902cc6dd98a3150ffe5d6577753e5950a481386d1fb646d438d190282819732"
    )
