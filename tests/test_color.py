"""Unit tests for the CLI color gate and primitives (tamper_signal/color.py).

These pin the gating matrix that keeps ANSI out of non-TTY and --json output,
and the verdict/delta conventions shared with node/color.js.
"""

from __future__ import annotations

import pytest

from tamper_signal import color


class _Stream:
    def __init__(self, tty: bool) -> None:
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty


TTY = _Stream(True)
PIPE = _Stream(False)


@pytest.fixture(autouse=True)
def _clean_color_env(monkeypatch):
    """Each test starts with no env overrides and --no-color off."""
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.delenv("FORCE_COLOR", raising=False)
    color.set_no_color(False)
    yield
    color.set_no_color(False)


def test_should_color_true_on_tty_with_no_overrides():
    assert color.should_color(TTY) is True


def test_should_color_false_when_not_a_tty():
    assert color.should_color(PIPE) is False


def test_no_color_env_wins_even_on_tty(monkeypatch):
    monkeypatch.setenv("NO_COLOR", "1")
    assert color.should_color(TTY) is False
    # NO_COLOR is honored regardless of value, per the spec.
    monkeypatch.setenv("NO_COLOR", "")
    assert color.should_color(TTY) is False


def test_no_color_flag_wins_even_on_tty():
    color.set_no_color(True)
    assert color.should_color(TTY) is False


def test_force_color_turns_on_even_when_piped(monkeypatch):
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert color.should_color(PIPE) is True


def test_no_color_beats_force_color(monkeypatch):
    monkeypatch.setenv("NO_COLOR", "1")
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert color.should_color(TTY) is False


def test_light_colors_each_verdict_when_on(monkeypatch):
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert color.light("green", PIPE) == f"{color._GREEN}●{color._RESET}"
    assert color.light("yellow", PIPE) == f"{color._YELLOW}●{color._RESET}"
    assert color.light("red", PIPE) == f"{color._RED}●{color._RESET}"


def test_light_is_plain_glyph_when_off():
    assert color.light("green", PIPE) == "●"
    assert "\x1b" not in color.light("red", PIPE)


def test_delta_signs_and_colors_direction(monkeypatch):
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert color.delta(12, PIPE) == f"{color._GREEN}+12{color._RESET}"
    assert color.delta(-5, PIPE) == f"{color._RED}-5{color._RESET}"
    assert color.delta(0, PIPE) == "0"


def test_delta_keeps_sign_when_color_off():
    # Direction must survive without ANSI for pipes and colorblind users.
    assert color.delta(12, PIPE) == "+12"
    assert color.delta(-5, PIPE) == "-5"
    assert "\x1b" not in color.delta(12, PIPE)


def test_dim_and_bold_wrap_only_when_on(monkeypatch):
    assert color.dim("abc", PIPE) == "abc"
    assert color.bold("abc", PIPE) == "abc"
    monkeypatch.setenv("FORCE_COLOR", "1")
    assert color.dim("abc", PIPE) == f"{color._DIM}abc{color._RESET}"
    assert color.bold("abc", PIPE) == f"{color._BOLD}abc{color._RESET}"
