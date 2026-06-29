"""Tests for the judge-then-commit decomposition of append_period (Phase B U1)."""

from __future__ import annotations

import os

import pytest

from tamper_signal.cli import main
from tamper_signal.receipts import read_chain
from tamper_signal.wrapper import (
    StaleCandidateError,
    commit_period,
    judge_candidate_period,
)


def _seed(tmp_path, rows="day,amount\n2026-05-01,10\n"):
    """A one-period chain with keys, ready to continue with append-period."""
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    (tmp_path / "v1.csv").write_text(rows, encoding="utf-8")
    main(["ingest", "v1.csv", "--origin", "seed", "--key", "keys/signing.key", "--out", "receipts/"])


def _dir_snapshot(path):
    return sorted(p.name for p in path.rglob("*") if p.is_file())


def test_judge_candidate_period_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "v2.csv").write_text("day,amount\n2026-05-01,10\n2026-05-02,20\n", encoding="utf-8")
    before = _dir_snapshot(tmp_path / "receipts")
    candidate, judgment = judge_candidate_period(
        "v2.csv", origin="tick", chain_dir="receipts/", key_path="keys/signing.key"
    )
    assert _dir_snapshot(tmp_path / "receipts") == before  # nothing written
    assert "manifest" in candidate and "base_tail" in candidate
    assert set(judgment) == {"caveats", "details", "breached", "notices"} or "details" in judgment


def test_commit_period_after_judge_verifies_green(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "v2.csv").write_text("day,amount\n2026-05-01,10\n2026-05-02,20\n", encoding="utf-8")
    candidate, judgment = judge_candidate_period(
        "v2.csv", origin="tick", chain_dir="receipts/", key_path="keys/signing.key"
    )
    result = commit_period(candidate, judgment, chain_dir="receipts/", key_path="keys/signing.key")
    assert result["source_hash"]
    capsys.readouterr()
    assert main(["verify", "receipts/chain.json", "--json"]) == 0  # green


def test_commit_refuses_stale_candidate(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "v2.csv").write_text("day,amount\n2026-05-01,10\n2026-05-02,20\n", encoding="utf-8")
    candidate, judgment = judge_candidate_period(
        "v2.csv", origin="tick", chain_dir="receipts/", key_path="keys/signing.key"
    )
    # A concurrent writer advances the chain between judge and commit.
    (tmp_path / "v3.csv").write_text("day,amount\n2026-05-03,30\n", encoding="utf-8")
    main(["ingest", "v3.csv", "--origin", "interloper", "--key", "keys/signing.key", "--out", "receipts/"])
    with pytest.raises(StaleCandidateError):
        commit_period(candidate, judgment, chain_dir="receipts/", key_path="keys/signing.key")


def test_untrusted_signer_raises_from_judge(tmp_path, monkeypatch):
    from tamper_signal.keys import generate_keys
    from tamper_signal.wrapper import UntrustedSignerError

    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    generate_keys(str(tmp_path / "otherkeys"))
    (tmp_path / "v2.csv").write_text("day,amount\n2026-05-02,20\n", encoding="utf-8")
    with pytest.raises(UntrustedSignerError):
        judge_candidate_period("v2.csv", chain_dir="receipts/", key_path="otherkeys/signing.key")
    # nothing was written by the failed judge
    assert read_chain("receipts/chain.json")["receipts"] == ["000_source.json"]
