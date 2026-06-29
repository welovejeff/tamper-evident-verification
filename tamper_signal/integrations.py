"""Shared pieces for the framework attach helpers.

The browser surfaces (the signal, the badge, the Data tab) ship inside this
package under static/, byte-identical to the repo's badge/ directory (a test
enforces the sync). Framework helpers serve them alongside the receipts
directory so a host app needs exactly one call plus one snippet.
"""

from __future__ import annotations

from importlib import resources

# The assets the helpers serve. light.js and table.js import ./badge.js, and
# element.js imports ./light.js, so they must be served side by side.
ASSET_NAMES = ("badge.js", "light.js", "element.js", "table.js", "console.js")


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
) -> str:
    """The one-line HTML snippet that mounts the signal in a host page.

    Falls back to document.body when the selector matches nothing, so the
    light always lands somewhere visible.
    """
    return (
        '<script type="module">'
        f'import {{ mountTamperSignal }} from "{assets_prefix}/light.js"; '
        f"mountTamperSignal(document.querySelector({selector!r}) ?? document.body, "
        f"{chain_url!r});"
        "</script>"
    )


def console_snippet(
    chain_url: str = "/receipts/chain.json",
    *,
    assets_prefix: str = "/tamper-signal",
    selector: str = "#tamper-signal-console",
) -> str:
    """One-line snippet mounting the chain-of-custody console inline.

    This is v2's primary surface: imports, changes, and signed reasons/authors,
    rendered from chain.json plus the timeline.json the console derives beside
    it. The inline status light (`signal_snippet`) remains available for hosts
    that only want a header pill. Falls back to document.body when the selector
    matches nothing, so the console always lands somewhere visible.
    """
    return (
        '<script type="module">'
        f'import {{ mountReceiptConsole }} from "{assets_prefix}/console.js"; '
        f"mountReceiptConsole(document.querySelector({selector!r}) ?? document.body, "
        f"{chain_url!r});"
        "</script>"
    )


def console_page(
    chain_url: str = "/receipts/chain.json",
    *,
    assets_prefix: str = "/tamper-signal",
) -> str:
    """A minimal HTML page hosting the verification console for a chain."""
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tamper Signal console</title>
<style>body{{margin:0;background:#07090d;padding:24px}}</style></head>
<body><div id="console"></div>
<script type="module">
import {{ mountReceiptConsole }} from "{assets_prefix}/console.js";
mountReceiptConsole(document.getElementById("console"), {chain_url!r});
</script></body></html>
"""
