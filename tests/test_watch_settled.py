"""Tests for the withhold-on-caveat gate + signed pending events (plan U4).

A retroactive change to a *settled* period (or one breaching the cumulative
drift cap) must never auto-append: it is withheld and recorded as a signed
pending event for human review. Determinism without clock-mocking:
  - a bucket dated far in the past is already settled at the real `now`, so
    changing it is a settled_movement;
  - a today-dated bucket stays *settling*, so the cumulative band*elapsed cap
    catches a slow drip of individually-in-band steps.
"""

from __future__ import annotations

import datetime as dt
import json
import os

import pytest

from tamper_signal.annotations import PENDING_DIRNAME, read_pending_events
from tamper_signal.cli import main
from tamper_signal.receipts import SOURCE_RECEIPT_NAME, read_chain, verify_signature
from tamper_signal.watcher import run_tick


def _seed(tmp_path, *, band="5%", settle="1h", bucket="day"):
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    # A far-future throwaway bucket just declares the tolerance; it never enters
    # a run snapshot (the first tick replaces the source).
    (tmp_path / "seed.csv").write_text("day,amount\n2099-12-31,1\n", encoding="utf-8", newline="")
    main([
        "ingest", "seed.csv", "--origin", "seed", "--key", "keys/signing.key",
        "--out", "receipts/", "--band", band, "--settle", settle, "--bucket-column", bucket,
    ])


def _tick(rows, **kw):
    kw.setdefault("source_id", "feed:x")
    kw.setdefault("chain_dir", "receipts/")
    kw.setdefault("key_path", "keys/signing.key")
    return run_tick([{"day": d, "amount": a} for d, a in rows], **kw)


def _chain_key():
    return read_chain("receipts/chain.json")["public_key"]


# ---------------------------------------------------------------------------
# Settled change -> withheld + signed pending event (AE2, R13, R14)
# ---------------------------------------------------------------------------
def test_settled_change_is_withheld_as_signed_pending_event(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    # Establish a settled baseline bucket (far past -> already settled at now).
    _tick([("2020-01-01", "100")])
    chain_before = read_chain("receipts/chain.json")

    # A retroactive change to that settled bucket must NOT auto-append.
    out = _tick([("2020-01-01", "200")])
    assert out["action"] == "withheld"
    assert "pending_hash" in out
    assert read_chain("receipts/chain.json") == chain_before  # chain untouched

    events = read_pending_events("receipts/")
    assert len(events) == 1
    event = events[0]
    # The event is signed under the chain key (tamper-evident).
    assert verify_signature(event, _chain_key())
    # It stores the FULL reviewed candidate, enough to commit exactly what was reviewed.
    assert event["candidate"]["manifest"]["semantic_hash"]
    assert event["candidate"]["records"] == [{"day": "2020-01-01", "amount": "200"}]
    assert event["base_tail"]  # the chain tail it was judged against
    assert event["details"]  # the caveat detail(s)


# ---------------------------------------------------------------------------
# Slow-drip: individually in-band, cumulatively breaching -> withheld (KTD2)
# ---------------------------------------------------------------------------
def test_cumulative_drift_is_withheld_not_silently_folded(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path, settle="720h")  # long settle so today's bucket stays *settling*
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()

    _tick([(today, "100")])              # baseline
    step = _tick([(today, "104")])       # +4% < 5% band -> clean
    assert step["action"] == "appended"
    drift = _tick([(today, "108")])      # cumulative 8% > 5% cap -> withheld
    assert drift["action"] == "withheld"
    assert len(read_pending_events("receipts/")) == 1


# ---------------------------------------------------------------------------
# A clean, caveat-free change still auto-commits
# ---------------------------------------------------------------------------
def test_in_band_change_auto_commits(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    _tick([("2020-01-01", "100")])
    out = _tick([("2020-01-01", "100"), ("2020-01-02", "50")])  # new bucket = new data
    assert out["action"] == "appended"
    assert read_pending_events("receipts/") == []
    capsys.readouterr()
    assert main(["verify", "receipts/chain.json", "--json"]) == 0


# ---------------------------------------------------------------------------
# Pending events are never served
# ---------------------------------------------------------------------------
def test_pending_dir_is_not_served(tmp_path, monkeypatch):
    import http.client
    import socketserver
    import threading

    from tamper_signal.cli import _serve_handler_class

    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    _tick([("2020-01-01", "100")])
    out = _tick([("2020-01-01", "200")])
    assert out["action"] == "withheld"
    event_name = f"{out['pending_hash']}.json"
    assert (tmp_path / "receipts" / PENDING_DIRNAME / event_name).is_file()

    handler = _serve_handler_class(str((tmp_path / "receipts").resolve()))
    with socketserver.TCPServer(("127.0.0.1", 0), handler) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            for url in (
                f"/{PENDING_DIRNAME}/{event_name}",
                f"/{PENDING_DIRNAME}/",
                f"/{PENDING_DIRNAME}",
                f"/{PENDING_DIRNAME}/../pending/{event_name}",
            ):
                conn.request("GET", url)
                response = conn.getresponse()
                response.read()
                assert response.status == 404, url
            # The published chain is still served.
            conn.request("GET", "/chain.json")
            response = conn.getresponse()
            response.read()
            assert response.status == 200
            conn.close()
        finally:
            httpd.shutdown()
            thread.join(timeout=5)
