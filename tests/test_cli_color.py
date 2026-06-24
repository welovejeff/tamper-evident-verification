"""CLI color application and gating (U5): the colored verdict headline, doctor
glyphs, and the NO_COLOR / FORCE_COLOR / --no-color gate as seen through the CLI.

Color is gated to a TTY, so these force it on with FORCE_COLOR (capsys is not a
TTY) and assert plain output when it is off.
"""

from __future__ import annotations

import pytest

from tamper_signal import color
from tamper_signal.cli import main
from tamper_signal.receipts import (
    SOURCE_RECEIPT_NAME,
    read_receipt,
    write_chain,
    write_receipt,
)

from test_cli_agent_ergonomics import _seed_chain


@pytest.fixture(autouse=True)
def _clean_color_env(monkeypatch):
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.delenv("FORCE_COLOR", raising=False)
    color.set_no_color(False)
    yield
    color.set_no_color(False)


def test_verify_green_headline_is_a_colored_light(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert main(["verify", "receipts/chain.json"]) == 0
    out = capsys.readouterr().out
    assert f"{color._GREEN}●{color._RESET}" in out  # the light
    assert f"{color._GREEN}GREEN{color._RESET}" in out  # the word agrees
    assert "CHAIN INTACT" in out  # the report is still there


def test_verify_red_headline_is_grave_and_colored(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    public_hex = _seed_chain(tmp_path)
    receipt = read_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME)
    receipt["semantic_hash"] = "0" * 64
    write_receipt(str(tmp_path / "receipts"), SOURCE_RECEIPT_NAME, receipt)
    write_chain(str(tmp_path / "receipts"), [SOURCE_RECEIPT_NAME], public_hex)
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert main(["verify", "receipts/chain.json"]) == 1
    out = capsys.readouterr().out
    assert f"{color._RED}●{color._RESET}" in out
    assert f"{color._RED}RED{color._RESET}" in out
    # No celebratory ornament on a red verdict.
    assert "✨" not in out and "🎉" not in out


def test_verify_piped_is_plain_text_with_no_ansi(tmp_path, monkeypatch, capsys):
    # capsys is not a TTY and FORCE_COLOR is unset: today's plain output, intact.
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    assert main(["verify", "receipts/chain.json"]) == 0
    out = capsys.readouterr().out
    assert "\x1b" not in out
    assert "CHAIN INTACT" in out


def test_no_color_env_beats_force_color(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    monkeypatch.setenv("FORCE_COLOR", "1")
    monkeypatch.setenv("NO_COLOR", "1")
    assert main(["verify", "receipts/chain.json"]) == 0
    assert "\x1b" not in capsys.readouterr().out


def test_no_color_flag_beats_force_color(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert main(["verify", "receipts/chain.json", "--no-color"]) == 0
    assert "\x1b" not in capsys.readouterr().out


def test_doctor_glyphs_are_colored_when_forced(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    main(["init"])
    _seed_chain(tmp_path)
    capsys.readouterr()
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert main(["doctor"]) == 0
    assert f"{color._GREEN}✓{color._RESET}" in capsys.readouterr().out
