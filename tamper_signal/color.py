"""Terminal color for the human-facing CLI, gated so it never corrupts output.

This is the presentation layer only. The library returns plain text; the CLI
calls these helpers at print time. Color is emitted only when stdout is an
interactive terminal and no override turns it off, and every primitive returns
plain text when color is off, so the word and glyph survive without ANSI.

Gating precedence (highest first):
  1. ``--no-color`` flag (set via :func:`set_no_color`)  -> off
  2. ``NO_COLOR`` env present (any value, per no-color.org) -> off
  3. ``FORCE_COLOR`` env present                          -> on
  4. otherwise                                            -> ``stream.isatty()``

NO_COLOR wins over FORCE_COLOR. ``should_color`` is only ever evaluated against
stdout; stderr (where notices go) and ``--json`` output are always plain.
"""

from __future__ import annotations

import os
import sys
from typing import TextIO

# SGR codes. Kept identical to node/color.js so the two CLIs read as one product.
_RESET = "\x1b[0m"
_DIM = "\x1b[2m"
_BOLD = "\x1b[1m"
_GREEN = "\x1b[32m"
_YELLOW = "\x1b[33m"
_RED = "\x1b[31m"

# Verdict -> color. "amber" names the color; the verdict value stays "yellow".
_VERDICT_COLOR = {"green": _GREEN, "yellow": _YELLOW, "red": _RED}

# Set by the CLI when --no-color is passed. Always wins over the environment.
_no_color = False


def set_no_color(value: bool) -> None:
    """Record the ``--no-color`` flag; it overrides env and isatty when true."""
    global _no_color
    _no_color = bool(value)


def should_color(stream: TextIO | None = None) -> bool:
    """Whether ANSI should be emitted to ``stream`` (defaults to stdout)."""
    if _no_color:
        return False
    if "NO_COLOR" in os.environ:
        return False
    if "FORCE_COLOR" in os.environ:
        return True
    stream = sys.stdout if stream is None else stream
    return bool(getattr(stream, "isatty", lambda: False)())


def _paint(text: str, code: str, stream: TextIO | None) -> str:
    return f"{code}{text}{_RESET}" if should_color(stream) else text


def dim(text: str, stream: TextIO | None = None) -> str:
    """Dim secondary detail (hashes, counts) when color is on."""
    return _paint(text, _DIM, stream)


def bold(text: str, stream: TextIO | None = None) -> str:
    return _paint(text, _BOLD, stream)


def light(verdict: str, stream: TextIO | None = None) -> str:
    """The colored traffic-light glyph for a verdict (``green``/``yellow``/``red``).

    Returns the ``●`` glyph colored by verdict, or the plain glyph when color is
    off. The caller prints the verdict word alongside it, so meaning survives
    without color.
    """
    return _paint("●", _VERDICT_COLOR.get(verdict, ""), stream)


def delta(value: float, stream: TextIO | None = None) -> str:
    """A signed movement value, colored by direction (increase green, decrease red).

    The sign is always printed, so direction reads without color and for
    colorblind users. Direction is a neutral cue, not a verdict: this product
    proves continuity, not correctness.
    """
    if value > 0:
        return _paint(f"+{value}", _GREEN, stream)
    if value < 0:
        return _paint(f"{value}", _RED, stream)
    return "0"
