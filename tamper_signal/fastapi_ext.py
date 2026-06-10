"""FastAPI/Starlette attach helper: serve receipts and the signal in one call.

    from tamper_signal.fastapi_ext import attach

    app = FastAPI()
    signal = attach(app, receipts_dir="receipts/")
    # render signal.snippet once in your layout (e.g. a Jinja template).

FastAPI is not a dependency of tamper-signal; this module imports it lazily.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from .integrations import ASSET_NAMES, asset_text, console_page, signal_snippet


def attach(
    app,
    *,
    receipts_dir: str = "receipts/",
    url_prefix: str = "/receipts",
    assets_prefix: str = "/tamper-signal",
    selector: str = "header",
) -> SimpleNamespace:
    """Mount the receipts directory and asset routes on a FastAPI app.

    Returns a handle with `chain_url`, `assets_prefix`, and `snippet`.
    """
    from fastapi import HTTPException
    from fastapi.responses import Response
    from starlette.staticfiles import StaticFiles

    app.mount(url_prefix, StaticFiles(directory=str(Path(receipts_dir).resolve())), name="tamper-signal-receipts")

    @app.get(assets_prefix + "/{filename}")
    def _assets(filename: str) -> Response:
        if filename not in ASSET_NAMES:
            raise HTTPException(status_code=404)
        return Response(asset_text(filename), media_type="text/javascript")

    chain_url = f"{url_prefix}/chain.json"

    @app.get(assets_prefix + "/console")
    def _console() -> Response:
        return Response(console_page(chain_url, assets_prefix=assets_prefix), media_type="text/html")

    return SimpleNamespace(
        chain_url=chain_url,
        assets_prefix=assets_prefix,
        console_url=f"{assets_prefix}/console",
        snippet=signal_snippet(chain_url, assets_prefix=assets_prefix, selector=selector),
    )
