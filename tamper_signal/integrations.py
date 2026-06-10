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
ASSET_NAMES = ("badge.js", "light.js", "element.js", "table.js")


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
