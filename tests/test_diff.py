"""`receipts diff` (U5): compare two runs and report per-stage code-hash
changes plus a structured totals delta including date ranges.

Read-only and informational: exit 0 whether or not differences are found
(including the no-prior-run message); exit 1 only on usage/load errors.
node/test/diff.test.js mirrors the core cases, and the structured-delta
parity pin below is asserted byte-for-byte in both stacks.
"""

from __future__ import annotations

import json
from pathlib import Path

from tamper_signal.cli import main
from tamper_signal.history import HISTORY_DIRNAME
from tamper_signal.keys import generate_keys
from tamper_signal.totals import structured_totals_delta

REPO = Path(__file__).parent.parent
INTACT = REPO / "examples" / "chains" / "intact"
TAMPERED = REPO / "examples" / "chains" / "tampered"

CSV_A = "day,amount\n2026-05-01,10.5\n2026-05-02,20\n"
CSV_B = "day,amount\n2026-05-01,10.5\n2026-05-02,20\n2026-05-03,5\n"


def _seed(tmp_path, monkeypatch, csv: str = CSV_A) -> Path:
    """Scaffold keys + an ingested chain in tmp_path (cwd moves there)."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "export.csv").write_text(csv, encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    return tmp_path / "receipts"


def _two_runs(tmp_path, monkeypatch) -> Path:
    """Two verified runs: CSV_A archived to history, CSV_B as the live chain."""
    receipts_dir = _seed(tmp_path, monkeypatch, CSV_A)
    assert main(["verify", "receipts/chain.json"]) == 0
    (tmp_path / "export.csv").write_text(CSV_B, encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0
    return receipts_dir


def _snapshot(
    stages: list[dict],
    *,
    created_at: str = "2026-06-01T00:00:00Z",
    filename: str = "export.csv",
    columns: list[str] | None = None,
    tail: str = "aa" * 32,
) -> dict:
    return {
        "kind": "run_snapshot",
        "spec_version": "1.2",
        "created_at": created_at,
        "chain_tail_hash": tail,
        "source": {
            "filename": filename,
            "declared_origin": "t",
            "columns": columns if columns is not None else ["amount", "day"],
        },
        "stages": stages,
    }


def _stage(name: str, totals: dict, **extra) -> dict:
    kind = "source_manifest" if name == "source" else "transform_receipt"
    return {"name": name, "kind": kind, "totals": totals, **extra}


TOTALS = {
    "row_count": 2,
    "column_count": 2,
    "numeric_sums": {"amount": "30.5"},
    "date_ranges": {},
    "null_counts": {},
}


def _write(path: Path, snapshot: dict) -> str:
    path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    return str(path)


# ---------------------------------------------------------------------------
# Code identity
# ---------------------------------------------------------------------------
def test_code_change_at_one_stage_names_stage_and_hashes(tmp_path, capsys):
    a = _snapshot([
        _stage("source", TOTALS),
        _stage("clean", TOTALS, code_hash="aa" * 32, code_file="pipeline.py"),
    ])
    b = _snapshot([
        _stage("source", TOTALS),
        _stage("clean", TOTALS, code_hash="bb" * 32, code_file="pipeline.py"),
    ], tail="bb" * 32)
    assert main(["diff", _write(tmp_path / "a.json", a), _write(tmp_path / "b.json", b)]) == 0
    out = capsys.readouterr().out
    assert "stage clean" in out
    assert "code_hash aaaaaaaa -> bbbbbbbb (pipeline.py)" in out
    assert "stage source" not in out  # unchanged stage prints nothing


def test_unchanged_runs_print_no_differences(tmp_path, capsys):
    a = _snapshot([_stage("source", TOTALS)])
    assert main(["diff", _write(tmp_path / "a.json", a), _write(tmp_path / "a2.json", a)]) == 0
    assert "no differences" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Totals movement, including date ranges
# ---------------------------------------------------------------------------
def test_totals_movement_renders_date_range_extension(tmp_path, capsys):
    before = dict(TOTALS, date_ranges={"day": {"min": "2026-05-01", "max": "2026-05-02"}})
    after = {
        "row_count": 3,
        "column_count": 2,
        "numeric_sums": {"amount": "35.5"},
        "date_ranges": {"day": {"min": "2026-05-01", "max": "2026-05-03"}},
        "null_counts": {"amount": 1},
    }
    a = _snapshot([_stage("source", before)])
    b = _snapshot([_stage("source", after)], tail="bb" * 32)
    assert main(["diff", _write(tmp_path / "a.json", a), _write(tmp_path / "b.json", b)]) == 0
    out = capsys.readouterr().out
    assert "stage source" in out
    assert "row_count 2 -> 3 (+1)" in out
    assert "amount 30.5 -> 35.5 (5)" in out
    assert "null_counts[amount] 0 -> 1 (+1)" in out
    assert "date_ranges[day] 2026-05-01..2026-05-02 -> 2026-05-01..2026-05-03" in out


def test_period_bucket_movement_names_the_buckets(tmp_path, capsys):
    before = dict(
        TOTALS,
        bucket_column="day",
        period_buckets={
            "2026-05-01": {"row_count": 1, "numeric_sums": {"amount": "10.5"}, "null_counts": {}},
            "2026-05-02": {"row_count": 1, "numeric_sums": {"amount": "20"}, "null_counts": {}},
        },
    )
    after = dict(
        before,
        numeric_sums={"amount": "32.5"},
        period_buckets={
            "2026-05-01": {"row_count": 1, "numeric_sums": {"amount": "10.5"}, "null_counts": {}},
            "2026-05-02": {"row_count": 1, "numeric_sums": {"amount": "22"}, "null_counts": {}},
        },
    )
    a = _snapshot([_stage("source", before)])
    b = _snapshot([_stage("source", after)], tail="bb" * 32)
    assert main(["diff", _write(tmp_path / "a.json", a), _write(tmp_path / "b.json", b)]) == 0
    out = capsys.readouterr().out
    assert "period_buckets changed: 2026-05-02" in out
    assert "2026-05-01" not in out.split("period_buckets changed:")[1].splitlines()[0]


# ---------------------------------------------------------------------------
# Default (zero-arg) invocation
# ---------------------------------------------------------------------------
def test_default_invocation_compares_latest_differing_snapshot(
    tmp_path, monkeypatch, capsys
):
    _two_runs(tmp_path, monkeypatch)
    capsys.readouterr()
    assert main(["diff"]) == 0
    out = capsys.readouterr().out
    # The CSV_A run from history vs the live CSV_B chain.
    assert "row_count 2 -> 3 (+1)" in out
    assert "amount 30.5 -> 35.5 (5)" in out
    assert "period_buckets changed: 2026-05-03" in out


def test_default_invocation_never_self_compares(tmp_path, monkeypatch, capsys):
    # One verified run: the only snapshot records the CURRENT tail, so the
    # hardened default refuses to diff the run against its own archive.
    _seed(tmp_path, monkeypatch)
    assert main(["verify", "receipts/chain.json"]) == 0
    assert len(list((tmp_path / "receipts" / HISTORY_DIRNAME).glob("*.json"))) == 1
    capsys.readouterr()
    assert main(["diff"]) == 0
    assert "no prior run archived to compare against" in capsys.readouterr().out


def test_empty_history_prints_no_prior_message_and_exits_zero(
    tmp_path, monkeypatch, capsys
):
    _seed(tmp_path, monkeypatch)  # ingested, never verified: no history at all
    capsys.readouterr()
    assert main(["diff"]) == 0
    assert "no prior run archived to compare against" in capsys.readouterr().out


def test_missing_chain_is_a_load_error(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["diff"]) == 1
    assert "no chain.json" in capsys.readouterr().err


def test_explicit_bad_path_is_a_load_error(tmp_path, monkeypatch, capsys):
    receipts_dir = _seed(tmp_path, monkeypatch)
    assert main(["diff", "does-not-exist"]) == 1
    assert "no such file or directory" in capsys.readouterr().err
    garbage = tmp_path / "garbage.json"
    garbage.write_text("{\"neither\": true}", encoding="utf-8")
    assert main(["diff", str(garbage), str(receipts_dir)]) == 1
    assert "neither a chain directory" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# One-arg form
# ---------------------------------------------------------------------------
def test_one_arg_compares_that_run_against_the_current_chain(
    tmp_path, monkeypatch, capsys
):
    receipts_dir = _two_runs(tmp_path, monkeypatch)
    # Find the archived CSV_A snapshot (the one whose totals differ).
    snapshots = sorted((receipts_dir / HISTORY_DIRNAME).glob("*.json"))
    prior = next(
        path
        for path in snapshots
        if json.loads(path.read_text(encoding="utf-8"))["stages"][0]["totals"]["row_count"] == 2
    )
    capsys.readouterr()
    assert main(["diff", str(prior)]) == 0
    out = capsys.readouterr().out
    assert "row_count 2 -> 3 (+1)" in out
    assert "b: receipts" in out


# ---------------------------------------------------------------------------
# Stage alignment and identity
# ---------------------------------------------------------------------------
def test_differing_stage_lists_render_added_and_removed(tmp_path, capsys):
    a = _snapshot([_stage("source", TOTALS), _stage("clean", TOTALS, code_hash="aa" * 32)])
    b = _snapshot([_stage("source", TOTALS), _stage("aggregate", TOTALS, code_hash="bb" * 32)], tail="bb" * 32)
    assert main(["diff", _write(tmp_path / "a.json", a), _write(tmp_path / "b.json", b)]) == 0
    out = capsys.readouterr().out
    assert "stage clean: removed" in out
    assert "stage aggregate: added" in out


def test_identity_mismatch_prints_notice_but_still_diffs(tmp_path, capsys):
    a = _snapshot([_stage("source", TOTALS)], filename="a.csv")
    b = _snapshot(
        [_stage("source", dict(TOTALS, row_count=3))], filename="b.csv", tail="bb" * 32
    )
    assert main(["diff", _write(tmp_path / "a.json", a), _write(tmp_path / "b.json", b)]) == 0
    out = capsys.readouterr().out
    assert "note: sources differ (a.csv vs b.csv); comparing anyway" in out
    assert "row_count 2 -> 3 (+1)" in out  # the diff still ran


def test_unsigned_snapshot_inputs_get_the_weaker_evidence_marker(tmp_path, capsys):
    a = _snapshot([_stage("source", TOTALS)])
    b = _snapshot([_stage("source", TOTALS)], created_at="2026-06-02T00:00:00Z", tail="bb" * 32)
    path_a = _write(tmp_path / "a.json", a)
    path_b = _write(tmp_path / "b.json", b)
    assert main(["diff", path_a, path_b]) == 0
    out = capsys.readouterr().out
    assert "note: snapshot a.json is unsigned; weaker evidence" in out
    assert "note: snapshot b.json is unsigned; weaker evidence" in out


# ---------------------------------------------------------------------------
# Committed example chains
# ---------------------------------------------------------------------------
def test_intact_vs_tampered_examples_name_the_tampered_stage_and_delta(capsys):
    assert main(["diff", str(INTACT), str(TAMPERED)]) == 0
    out = capsys.readouterr().out
    assert "stage clean" in out
    assert "spend_usd 2020283.47 -> 2020185.07 (-98.4)" in out
    assert "stage source" not in out  # the source stage is identical


# ---------------------------------------------------------------------------
# --json
# ---------------------------------------------------------------------------
def test_json_shape(tmp_path, capsys):
    a = _snapshot([
        _stage("source", TOTALS),
        _stage("clean", TOTALS, code_hash="aa" * 32, code_file="pipeline.py"),
    ])
    b = _snapshot([
        _stage("source", dict(TOTALS, row_count=3)),
        _stage("clean", TOTALS, code_hash="bb" * 32, code_file="pipeline.py"),
        _stage("aggregate", TOTALS),
    ], created_at="2026-06-02T00:00:00Z", tail="bb" * 32)
    path_a = _write(tmp_path / "a.json", a)
    path_b = _write(tmp_path / "b.json", b)
    assert main(["diff", path_a, path_b, "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)

    assert payload["a"] == {"ref": path_a, "created_at": "2026-06-01T00:00:00Z", "unsigned": True}
    assert payload["b"]["ref"] == path_b
    assert payload["identity_mismatch"] is False

    by_name = {row["name"]: row for row in payload["stages"]}
    assert by_name["source"]["status"] == "matched"
    assert by_name["source"]["code_changed"] is False
    assert by_name["source"]["totals"] == {
        "row_count": {"before": 2, "after": 3, "delta": 1}
    }
    assert by_name["clean"]["code_changed"] is True
    assert by_name["clean"]["code_hash"] == {"before8": "aaaaaaaa", "after8": "bbbbbbbb"}
    assert by_name["clean"]["totals"] == {}
    assert by_name["aggregate"] == {
        "name": "aggregate", "status": "added", "code_changed": False, "totals": None,
    }


def test_diff_is_read_only(tmp_path, monkeypatch, capsys):
    receipts_dir = _two_runs(tmp_path, monkeypatch)
    before = {
        path: path.read_bytes() for path in receipts_dir.rglob("*") if path.is_file()
    }
    assert main(["diff"]) == 0
    assert main(["diff", "--json"]) == 0
    after = {
        path: path.read_bytes() for path in receipts_dir.rglob("*") if path.is_file()
    }
    assert before == after


# ---------------------------------------------------------------------------
# structured_totals_delta parity pin (node/test/diff.test.js asserts the same)
# ---------------------------------------------------------------------------
PARITY_A = {
    "row_count": 4,
    "column_count": 3,
    "numeric_sums": {"amount": "100.5", "gone": "3"},
    "date_ranges": {"day": {"min": "2026-05-01", "max": "2026-05-02"}},
    "null_counts": {"note": 1},
    "bucket_column": "day",
    "period_buckets": {
        "2026-05-01": {"row_count": 2, "numeric_sums": {"amount": "50"}, "null_counts": {}},
        "2026-05-02": {"row_count": 2, "numeric_sums": {"amount": "50.5"}, "null_counts": {}},
    },
}
PARITY_B = {
    "row_count": 6,
    "column_count": 4,
    "numeric_sums": {"amount": "120.25", "new": "7"},
    "date_ranges": {"day": {"min": "2026-05-01", "max": "2026-05-03"}},
    "null_counts": {"note": 3},
    "bucket_column": "day",
    "period_buckets": {
        "2026-05-01": {"row_count": 2, "numeric_sums": {"amount": "50"}, "null_counts": {}},
        "2026-05-02": {"row_count": 2, "numeric_sums": {"amount": "60.25"}, "null_counts": {}},
        "2026-05-03": {"row_count": 2, "numeric_sums": {"amount": "10"}, "null_counts": {}},
    },
}
PARITY_EXPECTED = (
    '{"row_count":{"before":4,"after":6,"delta":2},'
    '"column_count":{"before":3,"after":4,"delta":1},'
    '"numeric_sums":{"amount":{"before":"100.5","after":"120.25","delta":"19.75"},'
    '"gone":{"before":"3","after":null},"new":{"before":null,"after":"7"}},'
    '"null_counts":{"note":{"before":1,"after":3,"delta":2}},'
    '"date_ranges":{"day":{"before":{"min":"2026-05-01","max":"2026-05-02"},'
    '"after":{"min":"2026-05-01","max":"2026-05-03"}}},'
    '"period_buckets_changed":["2026-05-02","2026-05-03"]}'
)


def test_structured_totals_delta_parity_pin():
    delta = structured_totals_delta(PARITY_A, PARITY_B)
    assert json.dumps(delta, separators=(",", ":")) == PARITY_EXPECTED


def test_structured_totals_delta_of_identical_totals_is_empty():
    assert structured_totals_delta(PARITY_A, PARITY_A) == {}
    assert structured_totals_delta({}, {}) == {}
