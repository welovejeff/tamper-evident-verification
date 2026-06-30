"""Tests for the watch tick (plan U3): stable-identity judgment, content-based
no-op detection, fail-closed key trust, and the per-tick volumetric cap.

`run_tick` is exercised directly with already-mapped records (U2's network tests
cover the fetch), so these are deterministic and network-free.
"""

from __future__ import annotations

import json
import os

import pytest

from tamper_signal.cli import main
from tamper_signal.receipts import SOURCE_RECEIPT_NAME, read_receipt
from tamper_signal.receipts import read_chain
from tamper_signal.watcher import WatchIdentityError, records_to_csv, run_tick
from tamper_signal.wrapper import UntrustedSignerError


def _seed(tmp_path, rows="day,amount\n2026-05-01,10\n", *, band="50%", settle="1h", bucket="day"):
    """A tolerance-declaring chain ready for the watcher to continue."""
    os.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    (tmp_path / "seed.csv").write_text(rows, encoding="utf-8", newline="")
    main([
        "ingest", "seed.csv", "--origin", "seed", "--key", "keys/signing.key",
        "--out", "receipts/", "--band", band, "--settle", settle, "--bucket-column", bucket,
    ])


def _rows(*days):
    return [{"day": d, "amount": a} for d, a in days]


# ---------------------------------------------------------------------------
# Append + attribution + real sign->verify round-trip
# ---------------------------------------------------------------------------
def test_tick_appends_new_period_and_verifies_green(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    out = run_tick(
        _rows(("2026-05-01", "10"), ("2026-05-02", "20")),
        source_id="feed:rates", origin="https://example.test/feed",
        chain_dir="receipts/", key_path="keys/signing.key",
    )
    assert out["action"] == "appended"
    # Attribution rides a signed manifest field, not the signature (KTD8).
    manifest = read_receipt("receipts/", SOURCE_RECEIPT_NAME)
    assert manifest["source"]["declared_origin"] == "https://example.test/feed"
    assert manifest["source"]["filename"] == "feed:rates"  # stable identity
    capsys.readouterr()
    # A real unattended sign->verify round-trip, not boundary-mocked.
    assert main(["verify", "receipts/chain.json", "--json"]) == 0


# ---------------------------------------------------------------------------
# Stable identity across ticks (KTD11)
# ---------------------------------------------------------------------------
def test_consecutive_ticks_share_identity_so_judgment_engages(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    run_tick(_rows(("2026-05-01", "10")), source_id="feed:x", chain_dir="receipts/",
             key_path="keys/signing.key")
    out2 = run_tick(_rows(("2026-05-01", "10"), ("2026-05-02", "20")),
                    source_id="feed:x", chain_dir="receipts/", key_path="keys/signing.key")
    assert out2["action"] == "appended"  # judged against tick 1, not skipped
    # Both run snapshots carry the same source identity, so judge_cross_run matched.
    from tamper_signal.history import load_snapshots
    identities = {
        item["snapshot"]["source"]["filename"]
        for item in load_snapshots("receipts/", trusted_keys=[read_chain("receipts/chain.json")["public_key"]])
    }
    assert identities == {"feed:x"}


def test_identity_drift_between_ticks_is_hard_error(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    # Tick 1 appends (data differs from the seed) so a snapshot with identity feed:x exists.
    run_tick(_rows(("2026-05-01", "10"), ("2026-05-02", "20")), source_id="feed:x",
             chain_dir="receipts/", key_path="keys/signing.key")
    # A drifting identity would otherwise skip judgment silently — refuse instead.
    with pytest.raises(WatchIdentityError):
        run_tick(_rows(("2026-05-01", "10"), ("2026-05-02", "20"), ("2026-05-03", "30")),
                 source_id="feed:DIFFERENT", chain_dir="receipts/", key_path="keys/signing.key")


# ---------------------------------------------------------------------------
# Content-based no-op (KTD12): unchanged data never re-appends
# ---------------------------------------------------------------------------
def test_unchanged_data_is_noop(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    rows = _rows(("2026-05-01", "10"), ("2026-05-02", "20"))
    run_tick(rows, source_id="feed:x", chain_dir="receipts/", key_path="keys/signing.key")
    before = read_chain("receipts/chain.json")
    out = run_tick(rows, source_id="feed:x", chain_dir="receipts/", key_path="keys/signing.key")
    assert out["action"] == "unchanged"
    assert read_chain("receipts/chain.json") == before  # nothing written


# ---------------------------------------------------------------------------
# Fail-closed key trust (KTD8)
# ---------------------------------------------------------------------------
def test_untrusted_key_fails_closed(tmp_path, monkeypatch):
    from tamper_signal.keys import generate_keys

    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    generate_keys(str(tmp_path / "otherkeys"))
    with pytest.raises(UntrustedSignerError):
        run_tick(_rows(("2026-05-02", "20")), source_id="feed:x",
                 chain_dir="receipts/", key_path="otherkeys/signing.key")
    assert read_chain("receipts/chain.json")["receipts"] == [SOURCE_RECEIPT_NAME]


# ---------------------------------------------------------------------------
# Volumetric guard: per-tick new-period cap
# ---------------------------------------------------------------------------
def test_per_tick_cap_stops_a_flood(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    flood = _rows(*[(f"2026-06-{d:02d}", "5") for d in range(1, 15)])  # 14 new days
    out = run_tick(flood, source_id="feed:x", chain_dir="receipts/",
                   key_path="keys/signing.key", per_tick_cap=3)
    assert out["action"] == "rate_capped"
    assert out["new_periods"] > 3
    # The cap withheld the write entirely.
    assert read_chain("receipts/chain.json")["receipts"] == [SOURCE_RECEIPT_NAME]


def test_cap_allows_within_limit(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    out = run_tick(_rows(("2026-05-01", "10"), ("2026-05-02", "20")),
                   source_id="feed:x", chain_dir="receipts/",
                   key_path="keys/signing.key", per_tick_cap=5)
    assert out["action"] == "appended"


# ---------------------------------------------------------------------------
# CSV serialization helper
# ---------------------------------------------------------------------------
def test_records_to_csv_is_lf_and_stable_order():
    text = records_to_csv(_rows(("2026-05-01", "10"), ("2026-05-02", "20")))
    assert text == "day,amount\n2026-05-01,10\n2026-05-02,20\n"
    assert "\r" not in text


# ---------------------------------------------------------------------------
# CLI: receipts watch (fetch monkeypatched; the real fetch is covered by U2)
# ---------------------------------------------------------------------------
def _config(tmp_path, **overrides):
    spec = {"url": "https://example.test/feed", "format": "json", "source_id": "feed:cli"}
    spec.update(overrides)
    path = tmp_path / "feed.json"
    path.write_text(json.dumps(spec), encoding="utf-8")
    return str(path)


def test_cli_watch_appends_via_config(tmp_path, monkeypatch, capsys):
    import tamper_signal.sources as sources

    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    body = b'[{"day": "2026-05-01", "amount": "10"}, {"day": "2026-05-02", "amount": "20"}]'
    monkeypatch.setattr(sources, "fetch", lambda url, **kw: sources.FetchResult(200, body, None, None))
    cfg = _config(tmp_path)
    capsys.readouterr()
    assert main(["watch", "--config", cfg, "--key", "keys/signing.key", "--out", "receipts/", "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["ok"] and out["action"] == "appended"
    assert main(["verify", "receipts/chain.json", "--json"]) == 0


def test_cli_watch_missing_fields_fails():
    # No config and no inline flags -> required-field error, exit 1.
    assert main(["watch", "--json"]) == 1


def test_cli_watch_refuses_private_url(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    # The real SSRF guard runs (fetch not monkeypatched here): a loopback target fails closed.
    rc = main([
        "watch", "--url", "http://127.0.0.1/feed", "--format", "json",
        "--source-id", "feed:x", "--key", "keys/signing.key", "--out", "receipts/", "--json",
    ])
    assert rc == 1
