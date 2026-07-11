"""Flask attach helper: serve receipts, the assets, and the room in one call.

    from tamper_signal.flask_ext import attach

    app = Flask(__name__)
    signal = attach(app, receipts_dir="receipts/")
    # then in your layout template, once:
    #   {{ signal.snippet | safe }}

One call serves three things: the receipts directory, the browser assets, and
the Signal Room page at ``{assets_prefix}/receipts`` — the room is v2's one
surface behind the light, and the returned snippet pre-wires the light's
"view receipts" link to it. Opt out with ``room=False`` (not recommended; the
light will link to raw JSON).

Flask is not a dependency of tamper-signal; this module imports it lazily and
only works in apps that already have it.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from .integrations import (
    ASSET_NAMES,
    asset_text,
    console_snippet,
    room_page,
    room_snippet,
    signal_snippet,
)


def attach(
    app,
    *,
    receipts_dir: str = "receipts/",
    url_prefix: str = "/receipts",
    assets_prefix: str = "/tamper-signal",
    selector: str = "header",
    room: bool = True,
    strict: bool = False,
    pub_key: str | list[str] | None = None,
    warn_drift: bool = False,
) -> SimpleNamespace:
    """Register routes serving the receipts directory, assets, and the room.

    Returns a handle with `chain_url`, `assets_prefix`, `room_url`,
    `room_snippet` (an inline embedded room, for a host-rendered Data tab),
    `snippet` (the inline header light, receiptsHref pre-wired to the room),
    and the deprecated `console_url`/`console_snippet` aliases (room-backed).
    """
    from flask import Blueprint, Response, abort, send_from_directory

    receipts = Path(receipts_dir).resolve()
    blueprint = Blueprint("tamper_signal", __name__)

    @blueprint.get(f"{url_prefix}/<path:filename>")
    def _receipts(filename: str):
        # send_from_directory confines paths to the directory.
        return send_from_directory(receipts, filename, max_age=0)

    @blueprint.get(f"{assets_prefix}/<path:filename>")
    def _assets(filename: str):
        if filename not in ASSET_NAMES:
            abort(404)
        return Response(asset_text(filename), mimetype="text/javascript")

    chain_url = f"{url_prefix}/chain.json"
    room_url = f"{assets_prefix}/receipts"

    if room:

        @blueprint.get(f"{assets_prefix}/receipts")
        def _room():
            return Response(
                room_page(chain_url, assets_prefix=assets_prefix, strict=strict,
                          pub_key=pub_key, warn_drift=warn_drift),
                mimetype="text/html",
            )

        @blueprint.get(f"{assets_prefix}/console")
        def _console():
            return Response(
                room_page(chain_url, assets_prefix=assets_prefix, preset="console",
                          strict=strict, pub_key=pub_key, warn_drift=warn_drift),
                mimetype="text/html",
            )

    app.register_blueprint(blueprint)
    receipts_href = f"{room_url}?focus=auto" if room else None
    return SimpleNamespace(
        chain_url=chain_url,
        assets_prefix=assets_prefix,
        room_url=room_url,
        console_url=f"{assets_prefix}/console",
        room_snippet=room_snippet(chain_url, assets_prefix=assets_prefix, strict=strict),
        console_snippet=console_snippet(chain_url, assets_prefix=assets_prefix),
        snippet=signal_snippet(
            chain_url, assets_prefix=assets_prefix, selector=selector,
            receipts_href=receipts_href,
        ),
    )
