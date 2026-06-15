"""Append-period import (U4): continue an existing chain's run history under a
trusted signer, judging the new run against prior snapshots; refuse an untrusted
signer rather than appending silently."""

from __future__ import annotations

import pytest

from tamper_signal.cli import main
from tamper_signal.keys import generate_keys, load_private_key, public_hex_from_private
from tamper_signal.receipts import read_chain
from tamper_signal.wrapper import UntrustedSignerError, append_period

# One source identity across periods (continuity keys on filename + columns).
P1 = "day,amount\n2026-05-01,10\n2026-05-02,20\n"
P2_INBAND = "day,amount\n2026-05-01,10\n2026-05-02,20\n2026-05-03,30\n"
P2_BREACH = "day,amount\n2026-05-01,1000\n2026-05-02,20\n"


def _seed_period_one(tmp_path, monkeypatch, csv: str = P1) -> None:
    """Keys + an ingested, verified chain with a band and bucket column, so the
    first run lands a snapshot in history/ for the next period to compare to."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "data.csv").write_text(csv, encoding="utf-8")
    assert main(["ingest", "data.csv", "--origin", "t", "--band", "5%", "--bucket-column", "day"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0  # archives the period-1 snapshot


def test_append_period_under_chain_key_compares_and_inherits_band(tmp_path, monkeypatch):
    _seed_period_one(tmp_path, monkeypatch)
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    res = append_period("data.csv", origin="t", chain_dir="receipts/")

    assert res["compared"] is True  # found the period-1 snapshot
    assert len(res["records"]) == 3  # chain now reflects period 2
    # Inherited the prior run's signed tolerance (band + bucket), not dropped.
    assert res["manifest"]["tolerance"]["band"] == "0.05"
    assert res["manifest"]["tolerance"]["bucket_column"] == "day"
    # Unchanged buckets stay in band -> no caveats.
    assert res["caveats"] == []


def test_append_period_surfaces_settled_movement(tmp_path, monkeypatch):
    _seed_period_one(tmp_path, monkeypatch)
    (tmp_path / "data.csv").write_text(P2_BREACH, encoding="utf-8")

    res = append_period("data.csv", origin="t", chain_dir="receipts/")

    assert res["compared"] is True
    # A settled bucket moved -> a yellow caveat, surfaced by the wiring.
    assert res["caveats"], "expected a drift caveat for the changed settled bucket"


def test_append_period_refuses_untrusted_signer(tmp_path, monkeypatch):
    _seed_period_one(tmp_path, monkeypatch)
    original_key = read_chain("receipts/chain.json")["public_key"]
    generate_keys("otherkeys")
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    with pytest.raises(UntrustedSignerError):
        append_period("data.csv", origin="t", chain_dir="receipts/", key_path="otherkeys/signing.key")

    # The gate fires before any write: the chain still belongs to the original key.
    assert read_chain("receipts/chain.json")["public_key"] == original_key


def test_append_period_trusts_signer_passed_via_pub(tmp_path, monkeypatch):
    _seed_period_one(tmp_path, monkeypatch)
    generate_keys("otherkeys")
    other_hex = public_hex_from_private(load_private_key("otherkeys/signing.key"))
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    res = append_period(
        "data.csv",
        origin="t",
        chain_dir="receipts/",
        key_path="otherkeys/signing.key",
        trusted_pub_hexes=[other_hex],
    )
    assert res["compared"] is True
    assert read_chain("receipts/chain.json")["public_key"] == other_hex


def test_append_period_refuses_without_existing_chain(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "data.csv").write_text(P1, encoding="utf-8")

    with pytest.raises(UntrustedSignerError):
        append_period("data.csv", origin="t", chain_dir="receipts/")


# ---------------------------------------------------------------------------
# CLI surface: receipts ingest --as replace|period (U6)
# ---------------------------------------------------------------------------
def test_cli_ingest_as_period_under_chain_key(tmp_path, monkeypatch, capsys):
    _seed_period_one(tmp_path, monkeypatch)
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    assert main(["ingest", "data.csv", "--origin", "t", "--as", "period"]) == 0
    assert "in band against the prior run" in capsys.readouterr().out


def test_cli_ingest_as_period_yellow_on_drift(tmp_path, monkeypatch, capsys):
    _seed_period_one(tmp_path, monkeypatch)
    (tmp_path / "data.csv").write_text(P2_BREACH, encoding="utf-8")

    assert main(["ingest", "data.csv", "--origin", "t", "--as", "period"]) == 2
    assert "the light is yellow" in capsys.readouterr().out


def test_cli_ingest_as_period_refuses_untrusted(tmp_path, monkeypatch, capsys):
    _seed_period_one(tmp_path, monkeypatch)
    generate_keys("otherkeys")
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    code = main(["ingest", "data.csv", "--origin", "t", "--as", "period", "--key", "otherkeys/signing.key"])
    assert code == 1
    assert "Refusing to append a period" in capsys.readouterr().err


def test_cli_ingest_as_period_trusts_via_pub(tmp_path, monkeypatch, capsys):
    _seed_period_one(tmp_path, monkeypatch)
    generate_keys("otherkeys")
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    code = main([
        "ingest", "data.csv", "--origin", "t", "--as", "period",
        "--key", "otherkeys/signing.key", "--pub", "otherkeys/signing.pub",
    ])
    assert code == 0


def test_cli_replace_archives_prior_chain(tmp_path, monkeypatch):
    _seed_period_one(tmp_path, monkeypatch)
    prior = read_chain("receipts/chain.json")
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    # A default ingest (replace) preserves the prior chain under receipts/archive/.
    assert main(["ingest", "data.csv", "--origin", "t"]) == 0
    archives = list((tmp_path / "receipts" / "archive").glob("*/chain.json"))
    assert archives, "expected the prior chain to be archived before the reset"
    assert read_chain(str(archives[0]))["public_key"] == prior["public_key"]


def test_cli_period_reports_evidence_hash_and_archives_prior_chain(tmp_path, monkeypatch, capsys):
    _seed_period_one(tmp_path, monkeypatch)
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    assert main(["ingest", "data.csv", "--origin", "t", "--as", "period"]) == 0
    assert "evidence_hash" in capsys.readouterr().out  # parity with replace output
    # the prior chain is preserved before the period overwrites it
    assert list((tmp_path / "receipts" / "archive").glob("*/chain.json"))


def test_cli_period_warns_when_prior_run_unsnapshotted(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "data.csv").write_text(P1, encoding="utf-8")
    # Ingest with a tolerance but DO NOT verify: the prior run never enters history.
    assert main(["ingest", "data.csv", "--origin", "t", "--band", "5%", "--bucket-column", "day"]) == 0
    capsys.readouterr()
    (tmp_path / "data.csv").write_text(P2_INBAND, encoding="utf-8")

    assert main(["ingest", "data.csv", "--origin", "t", "--as", "period"]) == 0
    assert "previous run was never verified" in capsys.readouterr().err
