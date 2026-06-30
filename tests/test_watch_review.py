"""Tests for `receipts review` — human sign-off for withheld changes (plan U5).

Accepting commits the EXACT candidate stored in the pending event behind a
signed human reason; if the chain advanced since the withhold, acceptance
re-surfaces for review instead of overwriting newer data.
"""

from __future__ import annotations

import json
import os

import pytest

from tamper_signal.annotations import read_annotations, read_pending_events
from tamper_signal.cli import main
from tamper_signal.receipts import read_chain, verify_signature
from tamper_signal.watcher import run_tick


def _seed(tmp_path, *, band="5%", settle="1h"):
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    (tmp_path / "seed.csv").write_text("day,amount\n2099-12-31,1\n", encoding="utf-8", newline="")
    main([
        "ingest", "seed.csv", "--origin", "seed", "--key", "keys/signing.key",
        "--out", "receipts/", "--band", band, "--settle", settle, "--bucket-column", "day",
    ])


def _tick(rows, **kw):
    kw.setdefault("source_id", "feed:x")
    kw.setdefault("chain_dir", "receipts/")
    kw.setdefault("key_path", "keys/signing.key")
    return run_tick([{"day": d, "amount": a} for d, a in rows], **kw)


def _withhold_one(tmp_path):
    """Drive the watcher to a single withheld settled change; return its hash."""
    _seed(tmp_path)
    _tick([("2020-01-01", "100")])
    out = _tick([("2020-01-01", "200")])
    assert out["action"] == "withheld"
    return out["pending_hash"]


# ---------------------------------------------------------------------------
# Accept: signs a reason, commits the stored candidate, links to the event
# ---------------------------------------------------------------------------
def test_accept_signs_reason_and_commits(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    phash = _withhold_one(tmp_path)
    capsys.readouterr()
    rc = main([
        "review", "accept", phash, "--reason", "confirmed by finance", "--author", "dana",
        "--key", "keys/signing.key", "--chain", "receipts/chain.json", "--json",
    ])
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["action"] == "accepted"

    # The committed data is the reviewed candidate (amount 200).
    source = read_chain("receipts/chain.json")
    assert read_pending_events("receipts/") == []  # consumed
    # A signed annotation references the pending hash via `accepts`.
    [annotation] = read_annotations("receipts/")
    assert annotation["accepts"] == phash
    assert annotation["reason"] == "confirmed by finance"
    assert verify_signature(annotation, source["public_key"])
    # The change stays yellow (a settled value genuinely moved) — acceptance
    # attaches a signed reason, it does not suppress the caveat. The timeline
    # carries the human reason alongside it.
    capsys.readouterr()
    assert main(["verify", "receipts/chain.json", "--json"]) == 2  # yellow, with caveats
    main(["timeline", "receipts/chain.json"])
    timeline = json.loads((tmp_path / "receipts" / "timeline.json").read_text())
    reasons = [a["reason"] for e in timeline["entries"] for a in e.get("annotations", [])]
    assert "confirmed by finance" in reasons


# ---------------------------------------------------------------------------
# Stale: ticks land between withhold and accept -> re-surface, don't overwrite
# ---------------------------------------------------------------------------
def test_accept_resurfaces_when_chain_advanced(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    phash = _withhold_one(tmp_path)
    # A later tick lands new (clean) data, advancing the chain tail.
    assert _tick([("2020-01-01", "100"), ("2026-01-01", "5")])["action"] == "appended"
    chain_before = read_chain("receipts/chain.json")
    capsys.readouterr()
    rc = main(["review", "accept", phash, "--reason", "late", "--key", "keys/signing.key",
               "--chain", "receipts/chain.json", "--json"])
    assert rc == 1  # refused
    assert read_chain("receipts/chain.json") == chain_before  # newer data untouched
    assert len(read_pending_events("receipts/")) == 1  # still pending for re-review


# ---------------------------------------------------------------------------
# Reject discards without touching the chain
# ---------------------------------------------------------------------------
def test_reject_discards_without_touching_chain(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    phash = _withhold_one(tmp_path)
    chain_before = read_chain("receipts/chain.json")
    assert main(["review", "reject", phash, "--chain", "receipts/chain.json"]) == 0
    assert read_pending_events("receipts/") == []
    assert read_chain("receipts/chain.json") == chain_before


# ---------------------------------------------------------------------------
# Each acceptance needs its own reason (no batch laundering)
# ---------------------------------------------------------------------------
def test_accept_requires_a_reason(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    phash = _withhold_one(tmp_path)
    assert main(["review", "accept", phash, "--key", "keys/signing.key",
                 "--chain", "receipts/chain.json"]) == 1
    assert len(read_pending_events("receipts/")) == 1  # not consumed without a reason


# ---------------------------------------------------------------------------
# List + sanitized timeline summary
# ---------------------------------------------------------------------------
def test_list_and_timeline_pending_summary(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _withhold_one(tmp_path)
    capsys.readouterr()
    assert main(["review", "list", "--chain", "receipts/chain.json", "--json"]) == 0
    listed = json.loads(capsys.readouterr().out)
    assert len(listed["pending"]) == 1 and listed["pending"][0]["source_id"] == "feed:x"

    main(["timeline", "receipts/chain.json"])
    timeline = json.loads((tmp_path / "receipts" / "timeline.json").read_text())
    assert len(timeline["pending"]) == 1
    summary = timeline["pending"][0]
    assert summary["source_id"] == "feed:x" and summary["caveat_count"] >= 1
    # Sanitized: no candidate records / value-bearing caveat strings leak.
    assert "candidate" not in summary and "caveats" not in summary
