"""Tests for the lineage-receipts MVP. Run with `pytest`."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from lineage.canonical import (
    canonicalize,
    decimal_to_plain_string,
    load_xlsx,
    normalize_headers,
    semantic_hash,
    write_xlsx,
)
from lineage.keys import generate_keys, load_private_key, public_hex_from_private
from lineage.receipts import (
    build_source_manifest,
    build_transform_receipt,
    code_hash_of,
    output_hash_of,
    verify_chain,
    verify_signature,
)
from lineage.totals import control_totals
from lineage.wrapper import ChainTailMismatch, lineage_step

from decimal import Decimal


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------
def sample_records() -> list[dict]:
    return [
        {"date": dt.date(2026, 5, 1), "campaign_name": "a", "impressions": 100, "spend_usd": 10.5},
        {"date": dt.date(2026, 5, 2), "campaign_name": "b", "impressions": 200, "spend_usd": 20.25},
        {"date": dt.date(2026, 5, 3), "campaign_name": "c", "impressions": 300, "spend_usd": 30.0},
    ]


@pytest.fixture
def keypair(tmp_path):
    generate_keys(str(tmp_path / "keys"))
    private = load_private_key(str(tmp_path / "keys" / "signing.key"))
    return private, public_hex_from_private(private)


# ---------------------------------------------------------------------------
# 1. Round-trip stability
# ---------------------------------------------------------------------------
def test_round_trip_xlsx_and_memory(tmp_path):
    records = sample_records()
    mem_hash = semantic_hash(records)

    path1 = str(tmp_path / "a.xlsx")
    write_xlsx(records, path1)
    disk_hash = semantic_hash(load_xlsx(path1))

    # Re-save what openpyxl parsed, then hash again.
    reparsed = load_xlsx(path1)
    path2 = str(tmp_path / "b.xlsx")
    write_xlsx(reparsed, path2)
    resave_hash = semantic_hash(load_xlsx(path2))

    assert mem_hash == disk_hash == resave_hash


# ---------------------------------------------------------------------------
# 2. Sensitivity
# ---------------------------------------------------------------------------
def test_changing_a_cell_changes_hash():
    base = semantic_hash(sample_records())
    changed = sample_records()
    changed[0]["impressions"] = 101
    assert semantic_hash(changed) != base


def test_reordering_rows_does_not_change_hash():
    base = semantic_hash(sample_records())
    reordered = list(reversed(sample_records()))
    assert semantic_hash(reordered) == base


# ---------------------------------------------------------------------------
# 3. Number edge cases
# ---------------------------------------------------------------------------
def test_int_float_text_number_hash_identically():
    a = [{"x": 1}]
    b = [{"x": 1.0}]
    c = [{"x": "1"}]
    assert semantic_hash(a) == semantic_hash(b) == semantic_hash(c)


def test_float_quantizes_stably():
    a = [{"x": 0.1 + 0.2}]
    b = [{"x": 0.3}]
    assert semantic_hash(a) == semantic_hash(b)


def test_no_scientific_notation():
    assert decimal_to_plain_string(Decimal("1E+2")) == "100"
    assert decimal_to_plain_string(Decimal("1000000")) == "1000000"
    assert decimal_to_plain_string(Decimal("0.0000001")) == "0"  # below quantum
    assert "E" not in canonicalize([{"x": 1e20}]).decode()
    assert "e" not in canonicalize([{"x": 0.0000003}]).decode().replace("headers", "")


def test_duplicate_headers_rejected():
    with pytest.raises(ValueError):
        normalize_headers(["Spend", "spend"])


# ---------------------------------------------------------------------------
# 4. Signature
# ---------------------------------------------------------------------------
def test_valid_chain_verifies(keypair):
    private, public_hex = keypair
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx",
        evidence_hash="00",
        byte_size=1,
        declared_origin="t",
        semantic_hash=semantic_hash(records),
        records=records,
        private_key=private,
    )
    assert verify_signature(manifest, public_hex)
    result = verify_chain([manifest], public_hex)
    assert result.ok


def test_flipped_signature_byte_fails(keypair):
    private, public_hex = keypair
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    sig = manifest["signature"]["value"]
    flipped = ("f" if sig[0] != "f" else "0") + sig[1:]
    manifest["signature"]["value"] = flipped
    assert not verify_signature(manifest, public_hex)


def test_wrong_key_fails(tmp_path):
    generate_keys(str(tmp_path / "ka"))
    generate_keys(str(tmp_path / "kb"))
    a = load_private_key(str(tmp_path / "ka" / "signing.key"))
    b_pub = public_hex_from_private(load_private_key(str(tmp_path / "kb" / "signing.key")))
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=a,
    )
    assert not verify_signature(manifest, b_pub)


# ---------------------------------------------------------------------------
# 5. Chain linking + totals delta
# ---------------------------------------------------------------------------
def _identity_chain(private, public_hex):
    """Source + two identity transforms, all hashing the same records."""
    records = sample_records()
    h = semantic_hash(records)
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=h, records=records, private_key=private,
    )
    r1 = build_transform_receipt(
        name="t1", code_hash="c1", code_file="f.py",
        input_semantic_hash=h, output_semantic_hash=h,
        output_records=records, private_key=private,
    )
    r2 = build_transform_receipt(
        name="t2", code_hash="c2", code_file="f.py",
        input_semantic_hash=h, output_semantic_hash=h,
        output_records=records, private_key=private,
    )
    return records, [manifest, r1, r2]


def test_tampered_intermediate_caught_at_link_with_delta(keypair):
    private, public_hex = keypair
    records, chain = _identity_chain(private, public_hex)

    # Tamper the middle receipt's output (spend up by 5) and re-sign it, so its
    # signature stays valid but link 1->2 breaks.
    tampered_records = [dict(r) for r in records]
    tampered_records[0]["spend_usd"] = float(tampered_records[0]["spend_usd"]) + 5
    new_hash = semantic_hash(tampered_records)
    chain[1] = build_transform_receipt(
        name="t1", code_hash="c1", code_file="f.py",
        input_semantic_hash=output_hash_of(chain[0]),
        output_semantic_hash=new_hash,
        output_records=tampered_records, private_key=private,
    )

    result = verify_chain(chain, public_hex)
    assert not result.ok
    assert result.broken_link == 2  # link 1 -> 2 breaks
    report = "\n".join(result.lines)
    assert "spend_usd" in report  # the totals delta names the changed column


# ---------------------------------------------------------------------------
# 6. Code hash
# ---------------------------------------------------------------------------
def test_editing_function_changes_code_hash():
    def f(records):
        return records

    def f_edited(records):
        # different body
        return list(records)

    assert code_hash_of(f) != code_hash_of(f_edited)


# ---------------------------------------------------------------------------
# 7. Wrapper guard
# ---------------------------------------------------------------------------
def test_wrapper_rejects_mismatched_input(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generate_keys("keys")
    private = load_private_key("keys/signing.key")
    public_hex = public_hex_from_private(private)

    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    from lineage.receipts import write_chain, write_receipt, SOURCE_RECEIPT_NAME

    write_receipt("receipts", SOURCE_RECEIPT_NAME, manifest)
    write_chain("receipts", [SOURCE_RECEIPT_NAME], public_hex)

    @lineage_step(chain_dir="receipts", key_path="keys/signing.key")
    def step(records):
        return records

    # Feeding data that does not match the chain tail must raise before running.
    wrong = sample_records()
    wrong[0]["impressions"] = 9999
    with pytest.raises(ChainTailMismatch):
        step(wrong)

    # Matching data appends a receipt successfully.
    out = step(records)
    assert out == records


# ---------------------------------------------------------------------------
# Hardening (from PR review)
# ---------------------------------------------------------------------------
def test_control_totals_accepts_non_normalized_keys():
    # canonicalize() supports non-normalized keys, so totals must agree.
    records = [
        {"Total Spend (USD)": 10, "Channel": "fb"},
        {"Total Spend (USD)": 20, "Channel": "ig"},
    ]
    totals = control_totals(records)
    assert totals["numeric_sums"]["total_spend_(usd)"] == "30"
    assert totals["column_count"] == 2


def test_verify_returns_false_on_malformed_hex():
    from lineage.keys import verify

    # Non-hex public key / signature must fail, not raise.
    assert verify("not-hex", b"msg", "also-not-hex") is False
    assert verify("00" * 32, b"msg", "zz") is False


def test_read_receipt_blocks_path_traversal(tmp_path):
    from lineage.receipts import read_receipt

    (tmp_path / "secret.txt").write_text("{}", encoding="utf-8")
    chain_dir = tmp_path / "receipts"
    chain_dir.mkdir()
    with pytest.raises(ValueError):
        read_receipt(str(chain_dir), "../secret.txt")


def test_line_separators_kept_literal_for_js_parity():
    # RFC 8785 keeps chars >= 0x20 literal; JS JSON.stringify does NOT escape
    # U+2028/U+2029 either (verified: it emits the literal char). So Python must
    # also keep them literal for the canonical bytes to match the browser.
    from lineage.canonical import canonical_json_bytes

    out = canonical_json_bytes({"o": "x\u2028y\u2029z"})
    assert "\\u2028" not in out.decode("utf-8")
    assert b"\xe2\x80\xa8" in out  # literal UTF-8 of U+2028
    assert b"\xe2\x80\xa9" in out  # literal UTF-8 of U+2029


def test_unicode_origin_signs_and_verifies(keypair):
    # A receipt field containing U+2028 must still round-trip through signing.
    private, public_hex = keypair
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1,
        declared_origin="May 2026\u2028export", semantic_hash=semantic_hash(records),
        records=records, private_key=private,
    )
    assert verify_signature(manifest, public_hex)


def test_verify_signature_fails_closed_on_bad_body(keypair):
    # A malformed body (float leaf) must verify as False, not raise.
    private, public_hex = keypair
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    manifest["unexpected_float"] = 1.5  # not part of the signed body shape
    assert verify_signature(manifest, public_hex) is False


def test_totals_delta_survives_bad_decimal():
    from lineage.totals import totals_delta

    up = {"numeric_sums": {"spend": "10"}}
    down = {"numeric_sums": {"spend": "not-a-number"}}
    lines = totals_delta(up, down)  # must not raise
    assert any("spend" in line for line in lines)


def test_accessors_are_defensive():
    from lineage.receipts import (
        input_hash_of,
        output_hash_of,
        stage_name_of,
        totals_of,
    )

    # Missing fields return sentinels, and output != input sentinel so two
    # malformed receipts never look "linked".
    assert output_hash_of({}) != input_hash_of({"kind": "transform_receipt"})
    assert totals_of({"kind": "x", "output_control_totals": "not-a-dict"}) == {}
    assert stage_name_of({"kind": "transform_receipt"}) == "<unknown>"
    assert stage_name_of("not-a-dict") == "<unknown>"


def test_verify_chain_does_not_crash_on_malformed_receipt(keypair):
    # An invalid-signature receipt that is also missing fields must produce a
    # clean failure report (using the fallbacks), not raise.
    _private, public_hex = keypair
    bogus = {"kind": "transform_receipt", "signature": {"value": "00"}}
    result = verify_chain([bogus], public_hex)
    assert not result.ok
    assert any("SIGNATURE INVALID" in line for line in result.lines)


def test_negative_zero_collapses():
    from decimal import Decimal

    assert decimal_to_plain_string(Decimal("-0.0")) == "0"
    assert decimal_to_plain_string(Decimal("-0.0000001")) == "0"  # quantizes to 0
    # -0.0 and 0.0 must hash identically.
    assert semantic_hash([{"x": -0.0}]) == semantic_hash([{"x": 0.0}])


def test_wrapper_refuses_to_extend_broken_chain(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generate_keys("keys")
    private = load_private_key("keys/signing.key")
    public_hex = public_hex_from_private(private)
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    from lineage.receipts import write_chain, write_receipt, SOURCE_RECEIPT_NAME

    # Corrupt the manifest's signature so the existing chain fails verification.
    manifest["signature"]["value"] = "00" * 64
    write_receipt("receipts", SOURCE_RECEIPT_NAME, manifest)
    write_chain("receipts", [SOURCE_RECEIPT_NAME], public_hex)

    @lineage_step(chain_dir="receipts", key_path="keys/signing.key")
    def step(records):
        return records

    with pytest.raises(ChainTailMismatch):
        step(records)


def test_wrapper_appends_linked_receipt(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generate_keys("keys")
    private = load_private_key("keys/signing.key")
    public_hex = public_hex_from_private(private)
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    from lineage.receipts import write_chain, write_receipt, SOURCE_RECEIPT_NAME, load_receipts

    write_receipt("receipts", SOURCE_RECEIPT_NAME, manifest)
    write_chain("receipts", [SOURCE_RECEIPT_NAME], public_hex)

    @lineage_step(chain_dir="receipts", key_path="keys/signing.key")
    def passthrough(records):
        return records

    passthrough(records)
    chain = load_receipts("receipts")
    assert len(chain) == 2
    assert verify_chain(chain, public_hex).ok
