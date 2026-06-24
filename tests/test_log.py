"""`receipts log` (U7): render archived run history as a per-metric trend
across runs at day/week/month/quarter granularity.

Read-only and informational: exit 0 for empty history (with a notice), a
single run (no deltas), and any number of rendered rows. node/test/log.test.js
mirrors the core cases plus the cross-stack period-key parity pin below.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tamper_signal.cli import main
from tamper_signal.history import HISTORY_DIRNAME, period_key
from tamper_signal.keys import generate_keys

REPO = Path(__file__).parent.parent


def _snapshot(
    *,
    created_at: str,
    row_count: int,
    numeric_sums: dict | None = None,
    tail: str,
    signed: bool = True,
    breached: dict | None = None,
) -> dict:
    totals = {
        "row_count": row_count,
        "column_count": 2,
        "numeric_sums": numeric_sums if numeric_sums is not None else {},
        "date_ranges": {},
        "null_counts": {},
    }
    body = {
        "kind": "run_snapshot",
        "spec_version": "1.2",
        "created_at": created_at,
        "chain_tail_hash": tail,
        "source": {"filename": "export.csv", "declared_origin": "t", "columns": ["amount", "day"]},
        "stages": [{"name": "source", "kind": "source_manifest", "totals": totals}],
    }
    if breached is not None:
        body["breached"] = breached
    if signed:
        # A present (if dummy) signature block marks the snapshot as signed for
        # load_snapshots' weaker-evidence flag. Tests that need a verifying
        # signature seed a real key and run the CLI end to end instead.
        body["signature"] = {"algorithm": "ed25519", "public_key": "00" * 32, "signature": "00" * 64}
    return body


def _write_history(receipts_dir: Path, snapshots: list[dict]) -> None:
    history = receipts_dir / HISTORY_DIRNAME
    history.mkdir(parents=True, exist_ok=True)
    for i, snapshot in enumerate(snapshots):
        (history / f"snap{i}.json").write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")


# Snapshots written here carry a dummy signature, so unsigned-key verification
# would skip them; point --pub at the dummy key or trust no key. For the tests
# below we make them UNSIGNED unless a test needs the signed path, so no key
# verification is required (load_snapshots accepts unsigned as weaker).
def _unsigned(snapshot: dict) -> dict:
    snapshot.pop("signature", None)
    return snapshot


# ---------------------------------------------------------------------------
# Period-key derivation (pinned, cross-stack parity with node/test/log.test.js)
# ---------------------------------------------------------------------------
PERIOD_KEY_CASES = [
    ("2026-06-11T12:00:00Z", "day", "2026-06-11"),
    ("2026-06-11T12:00:00Z", "week", "2026-W24"),
    ("2026-06-11T12:00:00Z", "month", "2026-06"),
    ("2026-06-11T12:00:00Z", "quarter", "2026-Q2"),
    ("2026-01-15T00:00:00Z", "quarter", "2026-Q1"),
    ("2026-12-31T23:59:59Z", "quarter", "2026-Q4"),
    # ISO-week year boundary: 2024-12-30 is a Monday in ISO week 2025-W01.
    ("2024-12-30T00:00:00Z", "week", "2025-W01"),
    ("2025-01-01T00:00:00Z", "week", "2025-W01"),
    # 2023-01-01 is a Sunday: ISO week 2022-W52.
    ("2023-01-01T00:00:00Z", "week", "2022-W52"),
    # UTC, not local: a late-UTC timestamp keys to its UTC day.
    ("2026-03-31T23:30:00Z", "day", "2026-03-31"),
]


@pytest.mark.parametrize("created_at,granularity,expected", PERIOD_KEY_CASES)
def test_period_key_pinned(created_at, granularity, expected):
    assert period_key(created_at, granularity) == expected


def test_period_key_unknown_granularity_raises():
    with pytest.raises(ValueError):
        period_key("2026-06-11T00:00:00Z", "fortnight")


# ---------------------------------------------------------------------------
# Empty / single
# ---------------------------------------------------------------------------
def test_empty_history_message_and_exit_zero(tmp_path, capsys):
    (tmp_path / "receipts").mkdir()
    assert main(["log", "--chain", str(tmp_path / "receipts")]) == 0
    assert "no run history yet" in capsys.readouterr().out


def test_single_run_renders_one_row_no_deltas(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [_unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=100, numeric_sums={"amount": "50"}, tail="aa" * 32))],
    )
    assert main(["log", "--chain", str(receipts)]) == 0
    out = capsys.readouterr().out
    assert "2026-06-01" in out
    assert "100" in out
    assert "(+" not in out and "(-" not in out  # no deltas on the only row


# ---------------------------------------------------------------------------
# Three runs, chronological rows with deltas
# ---------------------------------------------------------------------------
def test_three_runs_render_three_rows_with_deltas(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            _unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=100, numeric_sums={"amount": "10"}, tail="01" * 32)),
            _unsigned(_snapshot(created_at="2026-06-02T00:00:00Z", row_count=122, numeric_sums={"amount": "12.5"}, tail="02" * 32)),
            _unsigned(_snapshot(created_at="2026-06-03T00:00:00Z", row_count=120, numeric_sums={"amount": "9"}, tail="03" * 32)),
        ],
    )
    assert main(["log", "--chain", str(receipts)]) == 0
    out = capsys.readouterr().out
    lines = out.splitlines()
    # Chronological: 06-01 before 06-02 before 06-03.
    assert lines[1].startswith("2026-06-01")
    assert "2026-06-02" in out and "2026-06-03" in out
    assert "122 (+22)" in out
    assert "120 (-2)" in out
    assert "12.5 (+2.5)" in out
    assert "9 (-3.5)" in out
    assert "u = unsigned snapshot" in out


def test_three_runs_json_oldest_first_with_deltas(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            _unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=100, tail="01" * 32)),
            _unsigned(_snapshot(created_at="2026-06-02T00:00:00Z", row_count=122, tail="02" * 32)),
            _unsigned(_snapshot(created_at="2026-06-03T00:00:00Z", row_count=120, tail="03" * 32)),
        ],
    )
    assert main(["log", "--chain", str(receipts), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["granularity"] == "day"
    assert payload["collapsed"] == 0
    runs = payload["runs"]
    assert [r["period"] for r in runs] == ["2026-06-01", "2026-06-02", "2026-06-03"]
    assert "delta" not in runs[0]["metrics"]["row_count"]
    assert runs[1]["metrics"]["row_count"] == {"value": "122", "delta": "+22"}
    assert runs[2]["metrics"]["row_count"] == {"value": "120", "delta": "-2"}


# ---------------------------------------------------------------------------
# Collapse: two same-day runs, last-wins
# ---------------------------------------------------------------------------
def test_two_same_day_runs_collapse_last_wins(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            _unsigned(_snapshot(created_at="2026-06-01T08:00:00Z", row_count=100, tail="01" * 32)),
            _unsigned(_snapshot(created_at="2026-06-01T20:00:00Z", row_count=130, tail="02" * 32)),
        ],
    )
    assert main(["log", "--chain", str(receipts), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["collapsed"] == 1
    assert len(payload["runs"]) == 1
    # Last-wins: the 20:00 run (row_count 130) is the rendered row.
    assert payload["runs"][0]["metrics"]["row_count"]["value"] == "130"


def test_week_granularity_collapses_runs_in_one_iso_week(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            # 2024-12-30 (Mon) and 2025-01-01 (Wed) are both ISO week 2025-W01.
            _unsigned(_snapshot(created_at="2024-12-30T00:00:00Z", row_count=10, tail="01" * 32)),
            _unsigned(_snapshot(created_at="2025-01-01T00:00:00Z", row_count=20, tail="02" * 32)),
        ],
    )
    assert main(["log", "--chain", str(receipts), "--granularity", "week", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert [r["period"] for r in payload["runs"]] == ["2025-W01"]
    assert payload["collapsed"] == 1


# ---------------------------------------------------------------------------
# --metric filter
# ---------------------------------------------------------------------------
def test_metric_filter_limits_columns(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            _unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=5, numeric_sums={"amount": "10", "qty": "3"}, tail="01" * 32)),
            _unsigned(_snapshot(created_at="2026-06-02T00:00:00Z", row_count=6, numeric_sums={"amount": "12", "qty": "4"}, tail="02" * 32)),
        ],
    )
    assert main(["log", "--chain", str(receipts), "--metric", "amount", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    metrics = payload["runs"][0]["metrics"]
    assert set(metrics) == {"amount"}
    assert "row_count" not in metrics and "qty" not in metrics


# ---------------------------------------------------------------------------
# Markers: unsigned, breached, missing metric
# ---------------------------------------------------------------------------
def test_unsigned_marker(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [_unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=5, tail="01" * 32))],
    )
    assert main(["log", "--chain", str(receipts), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["runs"][0]["unsigned"] is True


def test_breached_marker(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            _unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=5, numeric_sums={"amount": "10"}, tail="01" * 32)),
            _unsigned(
                _snapshot(
                    created_at="2026-06-02T00:00:00Z",
                    row_count=5,
                    numeric_sums={"amount": "30"},
                    tail="02" * 32,
                    breached={"2026-06-02": ["amount"]},
                )
            ),
        ],
    )
    assert main(["log", "--chain", str(receipts)]) == 0
    out = capsys.readouterr().out
    assert "30!" in out
    assert "! = breached in that run" in out

    # JSON carries the breached metric list per run.
    assert main(["log", "--chain", str(receipts), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["runs"][1]["breached"] == ["amount"]


def test_missing_metric_renders_dash(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            _unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=5, numeric_sums={}, tail="01" * 32)),
            _unsigned(_snapshot(created_at="2026-06-02T00:00:00Z", row_count=6, numeric_sums={"amount": "12"}, tail="02" * 32)),
        ],
    )
    assert main(["log", "--chain", str(receipts), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    # amount is absent in the first run, present in the second.
    assert payload["runs"][0]["metrics"]["amount"] == {"value": "-"}
    assert payload["runs"][1]["metrics"]["amount"]["value"] == "12"
    # No delta against a missing prior value.
    assert "delta" not in payload["runs"][1]["metrics"]["amount"]

    # Human table shows "-" for the missing cell.
    assert main(["log", "--chain", str(receipts)]) == 0
    assert "-" in capsys.readouterr().out


def test_output_is_ascii_only(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(
        receipts,
        [
            _unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=5, numeric_sums={"amount": "10"}, tail="01" * 32)),
            _unsigned(_snapshot(created_at="2026-06-02T00:00:00Z", row_count=6, numeric_sums={"amount": "12"}, tail="02" * 32)),
        ],
    )
    assert main(["log", "--chain", str(receipts)]) == 0
    out = capsys.readouterr().out
    out.encode("ascii")  # raises if any non-ASCII glyph slipped in


def test_unknown_granularity_exits_one(tmp_path, capsys):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    _write_history(receipts, [_unsigned(_snapshot(created_at="2026-06-01T00:00:00Z", row_count=5, tail="01" * 32))])
    assert main(["log", "--chain", str(receipts), "--granularity", "fortnight"]) == 1
    assert "unknown --granularity" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# End-to-end over a real built history (signed snapshots verify under the key)
# ---------------------------------------------------------------------------
def test_end_to_end_over_built_history(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "export.csv").write_text("day,amount\n2026-05-01,10\n2026-05-02,20\n", encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0
    (tmp_path / "export.csv").write_text("day,amount\n2026-05-01,10\n2026-05-02,20\n2026-05-03,5\n", encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0

    capsys.readouterr()  # drain ingest/verify output before capturing log's
    assert main(["log", "--chain", "receipts/", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert len(payload["runs"]) >= 1
    # Signed snapshots verify under the chain key, so they are not unsigned.
    assert all(run["unsigned"] is False for run in payload["runs"])


def test_log_json_surfaces_band_and_settle_per_run(tmp_path, capsys):
    # The signed tolerance declaration is per-snapshot; log --json surfaces it
    # per run entry, present only on the runs that declared it.
    receipts = tmp_path / "receipts"
    s0 = _unsigned(_snapshot(created_at="2026-05-01T00:00:00Z", row_count=100, tail="aa" * 32))
    s1 = _unsigned(_snapshot(created_at="2026-05-02T00:00:00Z", row_count=110, tail="bb" * 32))
    s1["tolerance"] = {"band": "0.05", "settle_hours": 72, "bucket_column": "day"}
    _write_history(receipts, [s0, s1])

    assert main(["log", "--chain", str(receipts), "--json"]) == 0
    runs = json.loads(capsys.readouterr().out)["runs"]  # oldest first

    assert "band" not in runs[0] and "settle_hours" not in runs[0]
    assert runs[1]["band"] == "0.05"
    assert runs[1]["settle_hours"] == 72
