"""Two-zone cross-run judgment in verify (U6).

The shared band vectors (tests/fixtures/band_vectors.json, also consumed by
node/test/judgment.test.js) drive judge_cross_run directly; CLI tests cover
the verify integration: typed flood-controlled caveats, the additive
caveat_details JSON field, stderr notices, the breached-baseline guard, and
the cross-stack judgment-parity fixture.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from tamper_signal.cli import main
from tamper_signal.history import (
    HISTORY_DIRNAME,
    _parse_created_at,
    judge_cross_run,
    write_run_snapshot,
)
from tamper_signal.keys import generate_keys

FIXTURES = Path(__file__).parent / "fixtures"
BAND_VECTORS = json.loads((FIXTURES / "band_vectors.json").read_text(encoding="utf-8"))
PARITY = FIXTURES / "judgment-parity"


# ---------------------------------------------------------------------------
# Shared band vectors -> judge_cross_run (the same harness node mirrors)
# ---------------------------------------------------------------------------
def _totals_from(buckets: dict) -> dict:
    return {
        "row_count": sum(b.get("row_count", 0) for b in buckets.values()),
        "column_count": 2,
        "numeric_sums": {},
        "date_ranges": {},
        "null_counts": {},
        "bucket_column": "day",
        "period_buckets": buckets,
    }


def _snapshot_from(entry: dict) -> dict:
    snapshot = {
        "kind": "run_snapshot",
        "spec_version": "1.2",
        "created_at": entry["created_at"],
        "chain_tail_hash": hashlib.sha256(entry["created_at"].encode()).hexdigest(),
        "source": {"filename": "export.csv", "declared_origin": "", "columns": ["day"]},
        "stages": [
            {"name": "source", "kind": "source_manifest", "totals": _totals_from(entry["buckets"])}
        ],
    }
    if "breached" in entry:
        snapshot["breached"] = entry["breached"]
    return snapshot


def _manifest_from(case: dict, buckets: dict | None = None, tolerance: dict | None = None) -> dict:
    current = case["current"]
    return {
        "kind": "source_manifest",
        "spec_version": "1.2",
        "created_at": current["created_at"],
        "source": {
            "filename": "export.csv",
            "evidence_hash": "00",
            "byte_size": 1,
            "declared_origin": "",
        },
        "semantic_hash": "00",
        "control_totals": _totals_from(buckets if buckets is not None else current["buckets"]),
        "tolerance": tolerance
        or {"band": case["band"], "settle_hours": case["settle_hours"], "bucket_column": "day"},
    }


CHAIN = {"receipts": ["000_source.json"], "receipt_hashes": {"000_source.json": "ff" * 32}}


@pytest.mark.parametrize("case", BAND_VECTORS["cases"], ids=lambda c: c["name"])
def test_band_vectors(case):
    receipts = [_manifest_from(case)]
    snapshots = [_snapshot_from(entry) for entry in case["history"]]
    judgment = judge_cross_run(receipts, CHAIN, snapshots, now=_parse_created_at(case["now"]))

    assert sorted(d["type"] for d in judgment["details"]) == sorted(
        case["expect"]["caveat_types"]
    )
    assert (len(judgment["caveats"]) == 0) == case["expect"]["green"]
    assert len(judgment["caveats"]) == len(judgment["details"])
    # Caveat copy stays inside the messaging rules: ASCII, no em dashes.
    for caveat in judgment["caveats"]:
        assert caveat.isascii()
        assert "—" not in caveat


# ---------------------------------------------------------------------------
# Pure-judgment edges not in the shared vectors
# ---------------------------------------------------------------------------
def _simple_case(spend_before: str, spend_after: str) -> dict:
    return {
        "band": "0.05",
        "settle_hours": 72,
        "history": [
            {
                "created_at": "2026-06-02T01:00:00Z",
                "buckets": {
                    "2026-06-01": {
                        "row_count": 10,
                        "numeric_sums": {"spend": spend_before},
                        "null_counts": {},
                    }
                },
            }
        ],
        "current": {
            "created_at": "2026-06-03T01:00:00Z",
            "buckets": {
                "2026-06-01": {
                    "row_count": 10,
                    "numeric_sums": {"spend": spend_after},
                    "null_counts": {},
                }
            },
        },
        "now": "2026-06-03T01:00:00Z",
    }


def test_first_run_ever_notices_and_stays_green():
    case = _simple_case("100", "109")
    judgment = judge_cross_run([_manifest_from(case)], CHAIN, [])
    assert judgment["caveats"] == [] and judgment["details"] == []
    assert judgment["notices"] == [
        "no run history yet; cross-run judgment begins on the next verify"
    ]


def test_out_of_order_verify_skips_with_notice():
    case = _simple_case("100", "109")
    # History entirely newer than the chain being verified.
    case["current"]["created_at"] = "2026-06-01T00:00:00Z"
    judgment = judge_cross_run(
        [_manifest_from(case)], CHAIN, [_snapshot_from(case["history"][0])]
    )
    assert judgment["caveats"] == []
    assert judgment["notices"] == [
        "cross-run judgment skipped: archived runs are newer than this chain"
    ]


def test_source_identity_mismatch_skips_with_notice():
    case = _simple_case("100", "109")
    snapshot = _snapshot_from(case["history"][0])
    snapshot["source"]["filename"] = "other.csv"
    judgment = judge_cross_run([_manifest_from(case)], CHAIN, [snapshot])
    assert judgment["caveats"] == []
    assert judgment["notices"] == [
        "cross-run judgment skipped: source identity differs from history"
    ]


def test_own_run_snapshot_never_judges_itself():
    case = _simple_case("100", "109")
    snapshot = _snapshot_from(case["history"][0])
    snapshot["chain_tail_hash"] = CHAIN["receipt_hashes"]["000_source.json"]
    judgment = judge_cross_run([_manifest_from(case)], CHAIN, [snapshot])
    assert judgment["caveats"] == []
    assert judgment["notices"] == [
        "no run history yet; cross-run judgment begins on the next verify"
    ]


def test_no_declaration_is_a_silent_no_op():
    case = _simple_case("100", "109")
    manifest = _manifest_from(case)
    del manifest["tolerance"]
    judgment = judge_cross_run([manifest], CHAIN, [_snapshot_from(case["history"][0])])
    assert judgment == {"caveats": [], "details": [], "notices": [], "breached": {}}


def test_two_metrics_in_one_bucket_emit_two_caveat_strings():
    case = _simple_case("100", "109")
    case["history"][0]["buckets"]["2026-06-01"]["numeric_sums"]["clicks"] = "200"
    case["current"]["buckets"]["2026-06-01"]["numeric_sums"]["clicks"] = "260"
    judgment = judge_cross_run(
        [_manifest_from(case)], CHAIN, [_snapshot_from(case["history"][0])]
    )
    assert len(judgment["caveats"]) == 2
    assert sorted(d["metric"] for d in judgment["details"]) == ["clicks", "spend"]
    assert judgment["breached"] == {"2026-06-01": ["clicks", "spend"]}


def test_restatement_flood_control_one_caveat_per_metric():
    # A provider restatement touching 30 settled buckets across 4 metrics
    # must emit one caveat string per metric, not 120 lines.
    buckets_before = {}
    buckets_after = {}
    for day in range(1, 31):
        key = f"2026-01-{day:02d}"
        buckets_before[key] = {
            "row_count": 10,
            "numeric_sums": {"spend": "100", "clicks": "200", "impressions": "300"},
            "null_counts": {},
        }
        buckets_after[key] = {
            "row_count": 11,
            "numeric_sums": {"spend": "150", "clicks": "260", "impressions": "390"},
            "null_counts": {},
        }
    case = {
        "band": "0.05",
        "settle_hours": 72,
        "history": [{"created_at": "2026-05-01T00:00:00Z", "buckets": buckets_before}],
        "current": {"created_at": "2026-05-02T00:00:00Z", "buckets": buckets_after},
    }
    judgment = judge_cross_run(
        [_manifest_from(case)], CHAIN, [_snapshot_from(case["history"][0])]
    )
    assert len(judgment["caveats"]) == 4  # row_count, clicks, impressions, spend
    assert len(judgment["caveats"]) <= 8
    for detail in judgment["details"]:
        assert detail["type"] == "settled_movement"
        assert detail["periods"] == 30
        assert len(detail["buckets"]) == 30
    assert all(len(metrics) == 4 for metrics in judgment["breached"].values())


def test_bucket_loss_caveat_when_buckets_disappear():
    case = _simple_case("100", "100")
    manifest = _manifest_from(case)
    # The current run detected no bucket column at all.
    del manifest["control_totals"]["period_buckets"]
    del manifest["control_totals"]["bucket_column"]
    manifest["control_totals"]["numeric_sums"] = {"day": "1"}  # keep columns == ["day"]
    snapshot = _snapshot_from(case["history"][0])
    snapshot["stages"][0]["totals"]["numeric_sums"] = {"day": "1"}
    judgment = judge_cross_run([manifest], CHAIN, [snapshot])
    assert "bucket column no longer detected; period judgment unavailable" in judgment["caveats"]
    assert judgment["details"][0]["type"] == "bucket_loss"
    assert judgment["details"][0]["worst"] is None


def test_malformed_tolerance_skips_with_notice():
    case = _simple_case("100", "109")
    manifest = _manifest_from(case, tolerance={"band": "banana", "settle_hours": 72})
    judgment = judge_cross_run([manifest], CHAIN, [_snapshot_from(case["history"][0])])
    assert judgment["caveats"] == []
    assert judgment["notices"] == [
        "cross-run judgment skipped: tolerance declaration is malformed"
    ]


# ---------------------------------------------------------------------------
# CLI integration (mirrors the test_run_history harness)
# ---------------------------------------------------------------------------
def _yesterday() -> str:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).date().isoformat()


def _seed(tmp_path, monkeypatch, csv: str) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "export.csv").write_text(csv, encoding="utf-8")


def _snapshots(tmp_path) -> list[Path]:
    history = tmp_path / "receipts" / HISTORY_DIRNAME
    return sorted(history.glob("*.json")) if history.exists() else []


def test_cli_band_breach_alone_exits_2_with_typed_details(tmp_path, monkeypatch, capsys):
    """AE2 + AE6: a band breach is yellow (exit 2), never red."""
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},100\n")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0  # first run: history begins
    assert "no run history yet" in capsys.readouterr().err

    (tmp_path / "export.csv").write_text(f"day,spend\n{day},109\n", encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    capsys.readouterr()
    code = main(["verify", "receipts/chain.json", "--json"])
    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert code == 2
    assert payload["verdict"] == "yellow" and payload["exit_code"] == 2
    assert payload["caveats"] == [
        f"totals drift beyond declared band: spend breached in 1 bucket, worst {day} (+9%)"
    ]
    [detail] = payload["caveat_details"]
    assert detail["type"] == "band_breach" and detail["metric"] == "spend"
    assert detail["worst"]["delta_pct"] == "+9%"
    assert "A human should look." in "\n".join(payload["report"])


def test_cli_red_beats_yellow_and_writes_no_snapshot(tmp_path, monkeypatch, capsys):
    """AE6/AE12: within-run red wins; judgment never runs; no snapshot."""
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},100\n")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0
    before = _snapshots(tmp_path)

    (tmp_path / "export.csv").write_text(f"day,spend\n{day},109\n", encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    # Tamper a receipt after chain.json recorded its hash: red.
    source = tmp_path / "receipts" / "000_source.json"
    receipt = json.loads(source.read_text(encoding="utf-8"))
    receipt["control_totals"]["row_count"] = 99
    source.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    capsys.readouterr()

    code = main(["verify", "receipts/chain.json", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 1
    assert payload["verdict"] == "red"
    assert payload["caveat_details"] == []  # judgment never ran, key still present
    assert _snapshots(tmp_path) == before


def test_cli_no_declaration_output_identical_except_additive_key(tmp_path, monkeypatch, capsys):
    """AE13: history present, no declaration: exact verification, silent."""
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},100\n")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0  # history now exists
    (tmp_path / "export.csv").write_text(f"day,spend\n{day},109\n", encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    capsys.readouterr()

    code = main(["verify", "receipts/chain.json", "--json"])
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert code == 0
    assert payload["verdict"] == "green"
    assert payload["caveats"] == []
    assert payload["caveat_details"] == []  # additive key, always present
    assert "cross-run" not in captured.err
    assert "no run history" not in captured.err


def test_cli_garbage_snapshot_skipped_never_red(tmp_path, monkeypatch, capsys):
    """AE11: an unreadable snapshot is skipped with a notice."""
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},100\n")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    history = tmp_path / "receipts" / HISTORY_DIRNAME
    history.mkdir(parents=True)
    (history / "garbage.json").write_text("not json {", encoding="utf-8")
    capsys.readouterr()

    code = main(["verify", "receipts/chain.json"])
    captured = capsys.readouterr()
    assert code == 0
    assert "run history: skipping" in captured.err
    assert "no run history yet" in captured.err  # nothing usable remained


def test_cli_11_era_snapshot_falls_back_to_flat_band_with_notice(tmp_path, monkeypatch, capsys):
    """AE14: a snapshot without buckets is judged under the flat band."""
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},109\n")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    old_snapshot = {
        "kind": "run_snapshot",
        "spec_version": "1.1",
        "created_at": "2026-01-01T00:00:00Z",
        "chain_tail_hash": "ab" * 32,
        "source": {"filename": "export.csv", "declared_origin": "t", "columns": ["day", "spend"]},
        "stages": [
            {
                "name": "source",
                "kind": "source_manifest",
                "totals": {
                    "row_count": 1,
                    "column_count": 2,
                    "numeric_sums": {"spend": "100"},
                    "date_ranges": {},
                    "null_counts": {},
                },
            }
        ],
    }
    write_run_snapshot("receipts", old_snapshot)
    capsys.readouterr()

    code = main(["verify", "receipts/chain.json", "--json"])
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert code == 2
    assert "no period buckets" in captured.err
    assert payload["caveats"] == [
        "totals drift beyond declared band: spend moved +9% "
        "against the previous run (whole-table comparison)"
    ]
    assert payload["caveat_details"][0]["worst"]["period"] == "whole-table"


def test_cli_source_identity_mismatch_skips_with_notice(tmp_path, monkeypatch, capsys):
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},109\n")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    other = {
        "kind": "run_snapshot",
        "spec_version": "1.2",
        "created_at": "2026-01-01T00:00:00Z",
        "chain_tail_hash": "ab" * 32,
        "source": {"filename": "other.csv", "declared_origin": "t", "columns": ["day", "spend"]},
        "stages": [
            {
                "name": "source",
                "kind": "source_manifest",
                "totals": {"row_count": 1, "numeric_sums": {"spend": "100"}},
            }
        ],
    }
    write_run_snapshot("receipts", other)
    capsys.readouterr()

    code = main(["verify", "receipts/chain.json"])
    captured = capsys.readouterr()
    assert code == 0
    assert "cross-run judgment skipped: source identity differs from history" in captured.err


def test_cli_key_rotated_history_judges_under_two_pubs(tmp_path, monkeypatch, capsys):
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},100\n")  # keys/ = key A
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0  # snapshot signed by A

    generate_keys("keysB")
    (tmp_path / "export.csv").write_text(f"day,spend\n{day},109\n", encoding="utf-8")
    assert main([
        "ingest", "export.csv", "--origin", "t", "--band", "5%",
        "--key", "keysB/signing.key",
    ]) == 0
    capsys.readouterr()

    code = main([
        "verify", "receipts/chain.json",
        "--pub", "keys/signing.pub", "--pub", "keysB/signing.pub",
        "--json",
    ])
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["caveat_details"][0]["type"] == "band_breach"


def test_cli_breached_baseline_guard_keeps_flagging(tmp_path, monkeypatch, capsys):
    """Breach on run N, unchanged on run N+1: still yellow, because the
    breached snapshot never becomes the baseline."""
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},100\n")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0

    (tmp_path / "export.csv").write_text(f"day,spend\n{day},109\n", encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 2
    # The archived snapshot carries the baseline-advancement guard.
    breached_maps = [
        json.loads(path.read_text(encoding="utf-8")).get("breached")
        for path in _snapshots(tmp_path)
    ]
    assert {day: ["spend"]} in breached_maps

    # Run N+1 with the same (still tampered) value: the baseline did not
    # advance, so the same breach flags again.
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    capsys.readouterr()
    code = main(["verify", "receipts/chain.json", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["caveat_details"][0]["type"] == "band_breach"
    assert payload["caveat_details"][0]["worst"]["before"] == "100"


def test_cli_text_report_folds_judgment_into_the_yellow_block(tmp_path, monkeypatch, capsys):
    day = _yesterday()
    _seed(tmp_path, monkeypatch, f"day,spend\n{day},100\n")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0
    (tmp_path / "export.csv").write_text(f"day,spend\n{day},109\n", encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t", "--band", "5%"]) == 0
    capsys.readouterr()

    code = main(["verify", "receipts/chain.json"])
    out = capsys.readouterr().out
    assert code == 2
    assert "CHAIN VERIFIES, WITH CAVEATS" in out
    assert "totals drift beyond declared band" in out
    assert out.count("A human should look.") == 1


# ---------------------------------------------------------------------------
# Cross-stack parity (fixture shared with node/test/judgment.test.js)
# ---------------------------------------------------------------------------
def test_parity_fixture_cli_emits_the_pinned_caveat_details(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    shutil.copytree(PARITY, tmp_path / "receipts")
    expected = json.loads((PARITY / "expected_caveat_details.json").read_text(encoding="utf-8"))
    capsys.readouterr()

    code = main(["verify", "receipts/chain.json", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["caveats"] == expected["caveats"]
    assert payload["caveat_details"] == expected["caveat_details"]
