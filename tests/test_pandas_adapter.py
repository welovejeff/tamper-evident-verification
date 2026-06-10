"""pandas adapter tests. Skipped entirely when pandas is not installed."""

from __future__ import annotations

import pytest

pd = pytest.importorskip("pandas", reason="pandas adapter tests need pandas")

from tamper_signal.canonical import semantic_hash
from tamper_signal.keys import generate_keys, load_private_key, public_hex_from_private
from tamper_signal.receipts import build_source_manifest, verify_chain
from tamper_signal.totals import control_totals
from tamper_signal.wrapper import receipt_step

from test_tamper_signal import sample_records


def test_dataframe_hashes_like_native_records():
    from tamper_signal.adapters import dataframe_to_records

    records = sample_records()
    df = pd.DataFrame(records)
    assert semantic_hash(dataframe_to_records(df)) == semantic_hash(records)


def test_dataframe_nan_becomes_null():
    from tamper_signal.adapters import dataframe_to_records

    df = pd.DataFrame([{"a": 1.0, "b": "x"}, {"a": float("nan"), "b": None}])
    converted = dataframe_to_records(df)
    assert converted[1]["a"] is None and converted[1]["b"] is None
    native = [{"a": 1.0, "b": "x"}, {"a": None, "b": None}]
    assert semantic_hash(converted) == semantic_hash(native)
    assert control_totals(converted)["null_counts"] == {"a": 1, "b": 1}


def test_receipt_step_wraps_dataframe_transform(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generate_keys("keys")
    private = load_private_key("keys/signing.key")
    public_hex = public_hex_from_private(private)

    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    from tamper_signal.receipts import write_chain, write_receipt, SOURCE_RECEIPT_NAME, load_receipts

    write_receipt("receipts", SOURCE_RECEIPT_NAME, manifest)
    write_chain("receipts", [SOURCE_RECEIPT_NAME], public_hex)

    @receipt_step(chain_dir="receipts", key_path="keys/signing.key")
    def drop_first(df):
        assert isinstance(df, pd.DataFrame)  # frame passes through untouched
        return df.iloc[1:]

    out = drop_first(pd.DataFrame(records))
    assert isinstance(out, pd.DataFrame)
    assert len(out) == len(records) - 1
    chain = load_receipts("receipts")
    assert len(chain) == 2
    assert verify_chain(chain, public_hex).ok


def test_receipt_step_rejects_unsupported_structures(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generate_keys("keys")
    private = load_private_key("keys/signing.key")
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    from tamper_signal.receipts import write_chain, write_receipt, SOURCE_RECEIPT_NAME

    write_receipt("receipts", SOURCE_RECEIPT_NAME, manifest)
    write_chain("receipts", [SOURCE_RECEIPT_NAME], public_hex_from_private(private))

    @receipt_step(chain_dir="receipts", key_path="keys/signing.key")
    def step(data):
        return data

    with pytest.raises(TypeError, match="list of dicts or a pandas DataFrame"):
        step({"not": "records"})


