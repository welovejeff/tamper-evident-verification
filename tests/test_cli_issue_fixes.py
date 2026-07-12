"""Tests for the integration-pass fixes: export positional chain, the assets
command, friendly serve-on-busy-port, and the `python -m tamper_signal` entry
point. See the GitHub issues filed against v1.7.x.
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
from pathlib import Path

from tamper_signal.cli import main

from test_cli_agent_ergonomics import _matching_data_file, _seed_chain


# ---------------------------------------------------------------------------
# receipts export: positional chain (parity with verify and the Node CLI)
# ---------------------------------------------------------------------------
def test_export_accepts_positional_chain(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    data = _matching_data_file(tmp_path)
    # The form the runbook documents: chain as a positional, no --chain.
    assert main(["export", "receipts/chain.json", "--data", str(data)]) == 0
    assert (tmp_path / "receipts" / "table.json").exists()


def test_export_positional_overrides_chain_flag(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    data = _matching_data_file(tmp_path)
    # A bogus --chain is ignored when a positional is given; the positional wins.
    assert main(["export", "receipts/chain.json", "--chain", "nope/chain.json",
                 "--data", str(data)]) == 0
    assert (tmp_path / "receipts" / "table.json").exists()


def test_export_flag_only_still_works(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    data = _matching_data_file(tmp_path)
    assert main(["export", "--chain", "receipts/chain.json", "--data", str(data)]) == 0
    assert (tmp_path / "receipts" / "table.json").exists()


# ---------------------------------------------------------------------------
# The room's export step: write_table on the wrapper, stale reminder on verify
# ---------------------------------------------------------------------------
def test_receipt_step_write_table_publishes_attested_table(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    from tamper_signal.canonical import semantic_hash_table
    from tamper_signal.receipts import load_receipts, output_hash_of
    from tamper_signal.wrapper import receipt_step

    from test_tamper_signal import sample_records

    @receipt_step(chain_dir="receipts", key_path="keys/signing.key", write_table=True)
    def identity(records):
        return records

    identity(sample_records())
    document = json.loads((tmp_path / "receipts" / "table.json").read_text())
    receipts = load_receipts("receipts")
    # The published table hashes to the chain tail: the room's landing plane
    # cannot go stale when the final stage opts in.
    assert semantic_hash_table(document["headers"], document["rows"]) == output_hash_of(receipts[-1])


def test_verify_reminds_about_a_stale_table_on_stderr_only(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    data = _matching_data_file(tmp_path)
    assert main(["export", "receipts/chain.json", "--data", str(data)]) == 0
    capsys.readouterr()

    # Attested table: no reminder. Absent table is covered below by contrast.
    assert main(["verify", "receipts/chain.json"]) == 0
    quiet = capsys.readouterr()
    assert "NOT THE ATTESTED DATA" not in quiet.err

    table_path = tmp_path / "receipts" / "table.json"
    document = json.loads(table_path.read_text())
    document["rows"][0][0] = "edited-after-signing"
    table_path.write_text(json.dumps(document, indent=2) + "\n")

    assert main(["verify", "receipts/chain.json"]) == 0  # the CHAIN verdict is untouched
    loud = capsys.readouterr()
    assert "NOT THE ATTESTED DATA" in loud.err
    assert "NOT THE ATTESTED DATA" not in loud.out  # stderr only

    # --json stdout stays byte-parseable with no reminder folded in.
    assert main(["verify", "receipts/chain.json", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["verdict"] == "green"


def test_verify_stays_silent_when_no_table_is_published(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    assert main(["verify", "receipts/chain.json"]) == 0
    assert "NOT THE ATTESTED DATA" not in capsys.readouterr().err


# ---------------------------------------------------------------------------
# receipts assets: vendor the browser bundle into a project
# ---------------------------------------------------------------------------
EXPECTED_ASSETS = {"badge.js", "console.js", "element.js", "light.js", "table.js", "room.js"}


def test_assets_copies_browser_bundle(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["assets", "--out", "vendor"]) == 0
    copied = {p.name for p in (tmp_path / "vendor").glob("*.js")}
    assert EXPECTED_ASSETS <= copied
    # Bytes match the shipped package assets exactly (no transform on copy).
    pkg_static = Path(__import__("tamper_signal").__file__).parent / "static"
    for name in EXPECTED_ASSETS:
        assert (tmp_path / "vendor" / name).read_bytes() == (pkg_static / name).read_bytes()


def test_assets_json_lists_files(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["assets", "--out", "vendor", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert EXPECTED_ASSETS <= set(payload["files"])
    assert payload["out"].endswith("vendor")


def test_assets_default_out_is_badge(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["assets"]) == 0
    assert (tmp_path / "badge" / "light.js").exists()


# ---------------------------------------------------------------------------
# receipts serve: friendly error on a busy port, no raw traceback
# ---------------------------------------------------------------------------
def test_serve_on_busy_port_exits_clean(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    busy = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    busy.bind(("127.0.0.1", 0))
    busy.listen()
    port = busy.getsockname()[1]
    try:
        code = main(["serve", "--dir", ".", "--port", str(port)])
    finally:
        busy.close()
    captured = capsys.readouterr()
    assert code == 1
    assert f"port {port} is already in use" in captured.err
    assert "Traceback" not in captured.err  # no raw stack trace


# ---------------------------------------------------------------------------
# python -m tamper_signal: PATH-independent entry point
# ---------------------------------------------------------------------------
def test_python_m_entrypoint_runs():
    result = subprocess.run(
        [sys.executable, "-m", "tamper_signal", "--help"],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0
    assert "usage" in (result.stdout + result.stderr).lower()
