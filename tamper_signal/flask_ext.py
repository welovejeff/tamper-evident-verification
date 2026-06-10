"""Flask attach helper: serve receipts and the signal in one call.

    from tamper_signal.flask_ext import attach

    app = Flask(__name__)
    signal = attach(app, receipts_dir="receipts/")
    # then in your layout template, once:
    #   {{ signal.snippet | safe }}

Flask is not a dependency of tamper-signal; this module imports it lazily and
only works in apps that already have it.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from .integrations import ASSET_NAMES, asset_text, signal_snippet


def attach(
    app,
    *,
    receipts_dir: str = "receipts/",
    url_prefix: str = "/receipts",
    assets_prefix: str = "/tamper-signal",
    selector: str = "header",
) -> SimpleNamespace:
    """Register routes serving the receipts directory and the browser assets.

    Returns a handle with `chain_url`, `assets_prefix`, and `snippet` (the
    HTML that mounts the signal; render it once in the layout).
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

    app.register_blueprint(blueprint)
    chain_url = f"{url_prefix}/chain.json"
    return SimpleNamespace(
        chain_url=chain_url,
        assets_prefix=assets_prefix,
        snippet=signal_snippet(chain_url, assets_prefix=assets_prefix, selector=selector),
    )
