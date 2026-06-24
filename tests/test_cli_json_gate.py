"""The 1.7.1 acceptance gate: ANSI must never leak into --json output, even when
color is forced on (R16); and the --json key sets are pinned so the Python and
node payloads agree by construction (R5/R15 -- node/test/json_surface.test.js
pins the same sets).

The no-leak test forces color ON (FORCE_COLOR) so it exercises the colored path;
a test that ran with color gated off would pass whether or not the gate works.
"""

from __future__ import annotations

import json

import pytest

from tamper_signal import color
from tamper_signal.cli import main


@pytest.fixture(autouse=True)
def _clean_color_env(monkeypatch):
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.delenv("FORCE_COLOR", raising=False)
    color.set_no_color(False)
    yield
    color.set_no_color(False)


def _build_history(tmp_path):
    """A project with two archived runs, so every command has something to show."""
    main(["init"])
    (tmp_path / "d.csv").write_text("day,amount\n2026-05-01,10\n", encoding="utf-8")
    main(["ingest", "d.csv"])
    main(["verify", "receipts/chain.json"])
    (tmp_path / "d.csv").write_text("day,amount\n2026-05-01,10\n2026-05-02,20\n", encoding="utf-8")
    main(["ingest", "d.csv"])
    main(["verify", "receipts/chain.json"])


JSON_COMMANDS = [
    ["verify", "receipts/chain.json", "--json"],
    ["log", "--chain", "receipts/", "--json"],
    ["diff", "--json"],
    ["export", "--chain", "receipts/chain.json", "--data", "d.csv", "--json"],
    ["doctor", "--json"],
    ["ingest", "d.csv", "--json"],
]


def test_no_ansi_leaks_into_json_even_with_force_color(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _build_history(tmp_path)
    capsys.readouterr()
    monkeypatch.setenv("FORCE_COLOR", "1")  # color forced on; --json must stay clean
    for argv in JSON_COMMANDS:
        main(argv)
        out = capsys.readouterr().out
        assert "\x1b" not in out, f"ANSI leaked into --json output of `{argv[0]}`"
        json.loads(out)  # and it is still valid JSON


def test_ingest_and_export_json_keys_are_pinned(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    main(["init"])
    (tmp_path / "d.csv").write_text("day,amount\n2026-05-01,10\n", encoding="utf-8")
    capsys.readouterr()

    main(["ingest", "d.csv", "--json"])
    ingest = json.loads(capsys.readouterr().out)
    assert set(ingest) == {
        "source", "evidence_hash", "semantic_hash",
        "row_count", "column_count", "tolerance", "source_manifest",
    }

    main(["export", "--chain", "receipts/chain.json", "--data", "d.csv", "--json"])
    export = json.loads(capsys.readouterr().out)
    assert set(export) == {"output", "row_count", "column_count", "data_hash", "bundle"}
