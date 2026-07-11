"""FastAPI/Starlette attach helper: receipts, assets, and the room in one call.

    from tamper_signal.fastapi_ext import attach

    app = FastAPI()
    signal = attach(app, receipts_dir="receipts/")
    # render signal.snippet once in your layout (e.g. a Jinja template).

One call serves three things: the receipts directory, the browser assets, and
the Signal Room page at ``{assets_prefix}/receipts`` — the room is v2's one
surface behind the light, and the returned snippet pre-wires the light's
"view receipts" link to it. Opt out with ``room=False`` (not recommended; the
light will link to raw JSON).

FastAPI is not a dependency of tamper-signal; this module imports it lazily.
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
    """Mount the receipts directory, asset routes, and the room on a FastAPI app.

    Returns a handle with `chain_url`, `assets_prefix`, `room_url`,
    `room_snippet` (an inline embedded room, for a host-rendered Data tab),
    `snippet` (the inline header light, receiptsHref pre-wired to the room),
    and the deprecated `console_url`/`console_snippet` aliases (room-backed).
    """
    from fastapi import HTTPException
    from fastapi.responses import Response
    from starlette.staticfiles import StaticFiles

    app.mount(url_prefix, StaticFiles(directory=str(Path(receipts_dir).resolve())), name="tamper-signal-receipts")

    chain_url = f"{url_prefix}/chain.json"
    room_url = f"{assets_prefix}/receipts"

    # Page routes are registered before the {filename} asset route: Starlette
    # matches in registration order, and "receipts"/"console" would otherwise
    # be swallowed (and 404ed) by the asset handler.
    if room:

        @app.get(assets_prefix + "/receipts")
        def _room() -> Response:
            return Response(
                room_page(chain_url, assets_prefix=assets_prefix, strict=strict,
                          pub_key=pub_key, warn_drift=warn_drift),
                media_type="text/html",
            )

        @app.get(assets_prefix + "/console")
        def _console() -> Response:
            return Response(
                room_page(chain_url, assets_prefix=assets_prefix, preset="console",
                          strict=strict, pub_key=pub_key, warn_drift=warn_drift),
                media_type="text/html",
            )

    @app.get(assets_prefix + "/{filename}")
    def _assets(filename: str) -> Response:
        if filename not in ASSET_NAMES:
            raise HTTPException(status_code=404)
        return Response(asset_text(filename), media_type="text/javascript")

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
