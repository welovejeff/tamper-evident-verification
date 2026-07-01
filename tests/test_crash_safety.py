"""Crash-safety of the source-reset commit (code-review follow-up).

Each receipt/chain write is atomic on its own, and the two together are a
journaled transaction: a crash between them is rolled forward by
recover_torn_commit, so the unattended watcher never leaves a mismatched
receipt/chain pair (a self-inflicted false-RED).
"""

from __future__ import annotations

import os

import pytest

from tamper_signal.cli import main
from tamper_signal.receipts import SOURCE_RECEIPT_NAME, recover_torn_commit, write_text_atomic
from tamper_signal.watcher import run_tick


def _crash_after_receipt_rename():
    """A drop-in os.replace that lands the receipt rename then 'crashes' before
    the chain rename — the exact torn window. Keyed on the destination name so
    unrelated os.replace calls (pytest capture, tempfiles) don't trip it."""
    real_replace = os.replace

    def flaky(src, dst):
        real_replace(src, dst)
        if str(dst).endswith(SOURCE_RECEIPT_NAME):
            raise RuntimeError("simulated crash mid-commit")

    return real_replace, flaky


def _seed(tmp_path):
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    (tmp_path / "seed.csv").write_text("day,amount\n2026-05-01,10\n", encoding="utf-8", newline="")
    main(["ingest", "seed.csv", "--origin", "s", "--key", "keys/signing.key", "--out", "receipts/",
          "--band", "50%", "--settle", "1h", "--bucket-column", "day"])


def _tick(rows, **kw):
    kw.setdefault("source_id", "feed:x")
    kw.setdefault("chain_dir", "receipts/")
    kw.setdefault("key_path", "keys/signing.key")
    return run_tick([{"day": d, "amount": a} for d, a in rows], **kw)


# ---------------------------------------------------------------------------
# Atomic overwrite: a stray temp file never corrupts a real read
# ---------------------------------------------------------------------------
def test_write_text_atomic_overwrite_replaces(tmp_path):
    p = tmp_path / "f.json"
    write_text_atomic(p, "one\n", overwrite=True)
    write_text_atomic(p, "two\n", overwrite=True)
    assert p.read_text() == "two\n"
    # Default (no overwrite) leaves an existing file untouched.
    write_text_atomic(p, "three\n")
    assert p.read_text() == "two\n"


# ---------------------------------------------------------------------------
# A crash BETWEEN the receipt rename and the chain rename is recovered
# ---------------------------------------------------------------------------
def test_torn_commit_between_renames_is_recovered(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    # Establish a committed watcher period (no intermediate `verify`: that would
    # archive a snapshot under the seed's identity, not the watcher's).
    _tick([("2026-05-01", "10"), ("2026-05-02", "20")])
    assert main(["verify", "receipts/chain.json", "--json"]) == 0

    # Crash the NEXT commit right after the receipt rename, before the chain
    # rename — the exact torn window. Patch os.replace directly (not monkeypatch,
    # whose undo would also revert the chdir) and restore it in finally.
    real_replace, flaky_replace = _crash_after_receipt_rename()
    os.replace = flaky_replace
    try:
        with pytest.raises(RuntimeError):
            _tick([("2026-05-01", "10"), ("2026-05-02", "20"), ("2026-05-03", "30")])
    finally:
        os.replace = real_replace

    # The chain is now torn: a new source receipt against the old chain → RED.
    assert main(["verify", "receipts/chain.json", "--json"]) != 0

    # Recovery rolls the commit forward and the chain is green again.
    assert recover_torn_commit("receipts/") is True
    assert main(["verify", "receipts/chain.json", "--json"]) == 0
    assert not (tmp_path / "receipts" / ".commit.pending").exists()


# ---------------------------------------------------------------------------
# The watcher self-heals a torn commit on its next tick (even a stable feed)
# ---------------------------------------------------------------------------
def test_next_tick_self_heals_torn_commit(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    _tick([("2026-05-01", "10")])

    real_replace, flaky_replace = _crash_after_receipt_rename()
    os.replace = flaky_replace
    try:
        with pytest.raises(RuntimeError):
            _tick([("2026-05-01", "10"), ("2026-05-02", "20")])
    finally:
        os.replace = real_replace
    assert main(["verify", "receipts/chain.json", "--json"]) != 0  # torn → RED

    # A subsequent tick recovers at the top of judge_candidate_period before
    # doing anything, so the chain is consistent again regardless of the feed.
    _tick([("2026-05-01", "10"), ("2026-05-02", "20")])
    assert main(["verify", "receipts/chain.json", "--json"]) == 0
