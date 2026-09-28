from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from tamper_signal.cli import main


@pytest.mark.parametrize("json_output", [False, True])
def test_ingest_warns_only_for_grouped_column(tmp_path, monkeypatch, capsys, json_output):
    monkeypatch.chdir(tmp_path)
    main(["keygen", "--out", "keys"])
    capsys.readouterr()
    (tmp_path / "data.csv").write_text('Grouped,Plain\n"1,200.00",12\n"2,300.00",23\n', encoding="utf-8")
    args = ["ingest", "data.csv"] + (["--json"] if json_output else [])
    assert main(args) == 0
    captured = capsys.readouterr()
    if json_output:
        assert captured.err == ""
        payload = json.loads(captured.out)
        assert payload["row_count"] == 2
        assert "grouped_columns" not in payload
    else:
        assert 'warning: column "grouped"' in captured.err
        assert 'column "plain"' not in captured.err
        assert "strips the separators before ingest" in captured.err
    if shutil.which("node"):
        cli = Path(__file__).resolve().parents[1] / "node" / "cli.js"
        result = subprocess.run(["node", str(cli), "ingest", "data.csv", "--out", "node-receipts"] + (["--json"] if json_output else []), capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        assert result.stderr == captured.err


@pytest.mark.parametrize("values,expected", [
    (["1,200.00", "2,300.00", None], "1,200.00"),
    (["1 198 372", "2\u00a0000", "3\u202f000"], "1 198 372"),
    (["+1,200", "-2,300.50"], "+1,200"),
    (["1,200"] + ["10"] * 8 + ["not numeric"], "1,200"),
    (["1,200"] + ["10"] * 9, None),
    (["1,200", "not numeric"], None),
    (["12,34", "1.234,56"], None),
    (["١,٢٠٠", "２,３００"], None),
    ([None, "", "  "], None),
    ([], None),
])
def test_grouped_numeric_columns_matches_node_rules(values, expected):
    from tamper_signal import grouped_numeric_columns

    records = [{" Grouped Value ": value, "Plain": 10} for value in values]
    result = grouped_numeric_columns(records)
    assert result == ([] if expected is None else [{"column": "grouped_value", "example": expected}])
