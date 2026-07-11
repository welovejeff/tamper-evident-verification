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
