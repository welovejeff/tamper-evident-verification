"""Tests for the optional watch daemon loop (plan U6).

The daemon is a thin loop around the stateless tick: it applies the same
append/withhold semantics, logs a failing tick without crashing, and stops
cleanly on interrupt. Drive it with an injected sleep so it is deterministic.
"""

from __future__ import annotations

import json
import os

from tamper_signal.annotations import read_pending_events
from tamper_signal.cli import _watch_daemon, main
from tamper_signal.receipts import read_chain


# ---------------------------------------------------------------------------
# Loop control: errors are logged, not fatal; interrupt stops cleanly
# ---------------------------------------------------------------------------
def test_daemon_logs_a_failing_tick_and_stops_clean(capsys):
    calls = {"n": 0}

    def tick():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")  # a transient feed error

    def sleep(_interval):
        if calls["n"] >= 2:  # let two ticks run, then interrupt the sleep
            raise KeyboardInterrupt

    _watch_daemon(tick, 0.0, sleep=sleep)
    assert calls["n"] == 2  # continued past the error
    err = capsys.readouterr().err
    assert "boom" in err and "watcher stopped" in err


def test_daemon_interrupt_during_tick_stops_clean(capsys):
    def tick():
        raise KeyboardInterrupt  # Ctrl-C lands mid-tick

    _watch_daemon(tick, 0.0, sleep=lambda _i: None)
    assert "watcher stopped" in capsys.readouterr().err


def test_daemon_stops_after_consecutive_failure_ceiling(capsys):
    # A persistent error (rotated key, full disk) must not spin forever.
    def tick():
        raise RuntimeError("permanent")

    hit_ceiling = _watch_daemon(tick, 0.0, sleep=lambda _i: None, max_consecutive_failures=3)
    assert hit_ceiling is True
    err = capsys.readouterr().err
    assert "consecutive failures" in err


# ---------------------------------------------------------------------------
# Key hardening (KTD8): a group/world-readable signing key is refused
# ---------------------------------------------------------------------------
def test_watch_refuses_group_readable_key(tmp_path, monkeypatch):
    import stat as _stat

    monkeypatch.chdir(tmp_path)
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    (tmp_path / "seed.csv").write_text("day,amount\n2026-05-01,10\n", encoding="utf-8", newline="")
    main(["ingest", "seed.csv", "--origin", "s", "--key", "keys/signing.key", "--out", "receipts/"])
    # Loosen the key file to group-readable.
    key = tmp_path / "keys" / "signing.key"
    key.chmod(key.stat().st_mode | _stat.S_IRGRP)
    rc = main([
        "watch", "--url", "https://feed.example/x", "--format", "json",
        "--source-id", "feed:x", "--key", "keys/signing.key", "--out", "receipts/", "--json",
    ])
    assert rc == 1  # refused before any fetch


# ---------------------------------------------------------------------------
# Config validation: per_tick_cap is coerced/validated, not passed untyped
# ---------------------------------------------------------------------------
def test_watch_rejects_non_integer_per_tick_cap(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    config = tmp_path / "feed.json"
    config.write_text(json.dumps({
        "url": "https://feed.example/x", "format": "json", "source_id": "feed:x",
        "per_tick_cap": "lots",
    }), encoding="utf-8")
    rc = main(["watch", "--config", str(config), "--key", "keys/signing.key",
               "--out", "receipts/", "--json"])
    assert rc == 1  # invalid cap refused at config load, no opaque mid-tick TypeError


def test_watch_rejects_zero_per_tick_cap(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    config = tmp_path / "feed.json"
    config.write_text(json.dumps({
        "url": "https://feed.example/x", "format": "json", "source_id": "feed:x",
        "per_tick_cap": 0,  # would silently rate-cap every append forever
    }), encoding="utf-8")
    assert main(["watch", "--config", str(config), "--key", "keys/signing.key",
                 "--out", "receipts/", "--json"]) == 1


def test_watch_rejects_malformed_columnar(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    for bad in ("hourly", {"path": "hourly"}, {"columns": []}, {"columns": [1, 2]}):
        config = tmp_path / "feed.json"
        config.write_text(json.dumps({
            "url": "https://feed.example/x", "format": "json", "source_id": "feed:x",
            "columnar": bad,
        }), encoding="utf-8")
        # A malformed columnar spec is refused at config load, not as a crash mid-tick.
        assert main(["watch", "--config", str(config), "--key", "keys/signing.key",
                     "--out", "receipts/", "--json"]) == 1


# ---------------------------------------------------------------------------
# Integration: the daemon applies tick semantics over an evolving feed and
# still pauses a settled change — a real, unmocked sign->verify round-trip.
# ---------------------------------------------------------------------------
def test_daemon_applies_tick_semantics_over_evolving_feed(tmp_path, monkeypatch, capsys):
    import tamper_signal.sources as sources

    monkeypatch.chdir(tmp_path)
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    (tmp_path / "seed.csv").write_text("day,amount\n2099-12-31,1\n", encoding="utf-8", newline="")
    main([
        "ingest", "seed.csv", "--origin", "seed", "--key", "keys/signing.key",
        "--out", "receipts/", "--band", "5%", "--settle", "1h", "--bucket-column", "day",
    ])

    # The feed evolves across ticks: establish a settled bucket, then move it.
    bodies = [
        b'[{"day":"2020-01-01","amount":"100"}]',
        b'[{"day":"2020-01-01","amount":"200"}]',  # settled change -> withheld
    ]
    state = {"i": 0}

    def fake_fetch(url, **kw):
        body = bodies[min(state["i"], len(bodies) - 1)]
        state["i"] += 1
        return sources.FetchResult(200, body, None, None)

    monkeypatch.setattr(sources, "fetch", fake_fetch)

    config = tmp_path / "feed.json"
    config.write_text(json.dumps({
        "url": "https://feed.example/rates", "format": "json", "source_id": "feed:rates",
    }), encoding="utf-8")

    # Stop the loop after the two ticks have run.
    def fake_sleep(_interval):
        if state["i"] >= 2:
            raise KeyboardInterrupt

    # The daemon imports `time` and calls time.sleep when no sleep is injected;
    # patch it so the loop stops deterministically after the two ticks.
    import time as _time
    monkeypatch.setattr(_time, "sleep", fake_sleep)

    rc = main([
        "watch", "--config", str(config), "--key", "keys/signing.key",
        "--out", "receipts/", "--daemon", "--interval", "0",
    ])
    assert rc == 0
    # Tick 1 appended the baseline; tick 2's settled change was withheld.
    assert len(read_pending_events("receipts/")) == 1
    capsys.readouterr()
    # The chain the daemon built (without the withheld change) verifies green.
    assert main(["verify", "receipts/chain.json", "--json"]) == 0
    chain = read_chain("receipts/chain.json")
    assert chain["receipts"] == ["000_source.json"]
