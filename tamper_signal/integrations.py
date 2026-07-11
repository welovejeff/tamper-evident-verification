"""Shared pieces for the framework attach helpers.

The browser surfaces (the signal, the badge, the Data tab, the Signal Room)
ship inside this package under static/, byte-identical to the repo's badge/
directory (a test enforces the sync). Framework helpers serve them alongside
the receipts directory so a host app needs exactly one call plus one snippet —
and that one call serves the room behind the light, so the light's
"view receipts" link never dead-ends in raw JSON.
"""

from __future__ import annotations

import json
from importlib import resources

# The assets the helpers serve. light.js, table.js, console.js, and room.js
# import ./badge.js (table/console dynamic-import ./room.js), and element.js
# imports ./light.js, so they must be served side by side.
ASSET_NAMES = ("badge.js", "light.js", "element.js", "table.js", "console.js", "room.js")


def asset_text(name: str) -> str:
    """The bundled source of one browser asset."""
    if name not in ASSET_NAMES:
        raise KeyError(f"unknown asset {name!r}; expected one of {', '.join(ASSET_NAMES)}")
    return resources.files("tamper_signal").joinpath("static", name).read_text(encoding="utf-8")


def signal_snippet(
    chain_url: str = "/receipts/chain.json",
    *,
    assets_prefix: str = "/tamper-signal",
    selector: str = "header",
    receipts_href: str | None = None,
) -> str:
    """The one-line HTML snippet that mounts the signal in a host page.

    Falls back to document.body when the selector matches nothing, so the
    light always lands somewhere visible. When ``receipts_href`` is set (the
    attach helpers pass the served room page), the light's "view receipts"
    link lands there instead of on raw chain.json.
    """
    opts = f", undefined, {{ receiptsHref: {receipts_href!r} }}" if receipts_href else ""
    return (
        '<script type="module">'
        f'import {{ mountTamperSignal }} from "{assets_prefix}/light.js"; '
        f"mountTamperSignal(document.querySelector({selector!r}) ?? document.body, "
        f"{chain_url!r}{opts});"
        "</script>"
    )


def room_snippet(
    chain_url: str = "/receipts/chain.json",
    *,
    assets_prefix: str = "/tamper-signal",
    selector: str = "#tamper-signal-room",
    strict: bool = False,
) -> str:
    """One-line snippet mounting an inline embedded-density Signal Room.

    For hosts that render their own Data tab: mount a strict room, listen for
    the bubbling ``tamper-signal:state`` event, and paint your own dot on your
    own tab. Falls back to document.body when the selector matches nothing.
    """
    return (
        '<script type="module">'
        f'import {{ mountSignalRoom }} from "{assets_prefix}/room.js"; '
        f"mountSignalRoom(document.querySelector({selector!r}) ?? document.body, "
        f"{chain_url!r}, {{ strict: {json.dumps(bool(strict))} }});"
        "</script>"
    )


def console_snippet(
    chain_url: str = "/receipts/chain.json",
    *,
    assets_prefix: str = "/tamper-signal",
    selector: str = "#tamper-signal-console",
) -> str:
    """Deprecated alias: the console is a preset of the Signal Room since 2.1.

    Prefer ``room_snippet``. Falls back to document.body when the selector
    matches nothing.
    """
    return (
        '<script type="module">'
        f'import {{ mountReceiptConsole }} from "{assets_prefix}/console.js"; '
        f"mountReceiptConsole(document.querySelector({selector!r}) ?? document.body, "
        f"{chain_url!r});"
        "</script>"
    )


def room_page(
    chain_url: str = "/receipts/chain.json",
    *,
    assets_prefix: str = "/tamper-signal",
    preset: str = "room",
    strict: bool = False,
    pub_key: str | list[str] | None = None,
    warn_drift: bool = False,
) -> str:
    """A standalone HTML page hosting the Signal Room for a chain.

    Page density: the room honors ``?focus=auto`` and hash deep links itself.
    The attach-level options (trusted keys, warn-drift) are baked in so the
    light snippet and this page can never disagree.
    """
    keys = [pub_key] if isinstance(pub_key, str) else pub_key
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tamper Signal room</title>
<style>body{{margin:0;background:#07090d;padding:24px}}</style></head>
<body><div id="room"></div>
<script type="module">
import {{ mountSignalRoom }} from "{assets_prefix}/room.js";
mountSignalRoom(document.getElementById("room"), {chain_url!r}, {json.dumps(keys)}, {{
  density: "page",
  preset: {json.dumps(preset)},
  strict: {json.dumps(bool(strict))},
  warnDrift: {json.dumps(bool(warn_drift))},
}});
</script></body></html>
"""


def console_page(
    chain_url: str = "/receipts/chain.json",
    *,
    assets_prefix: str = "/tamper-signal",
) -> str:
    """Deprecated alias: serves the room with its rail open (preset console)."""
    return room_page(chain_url, assets_prefix=assets_prefix, preset="console")
