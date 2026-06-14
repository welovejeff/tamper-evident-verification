#!/usr/bin/env python3
"""Shared helpers for cataloguing generated imagery in fal Assets.

Two pieces of durable state:

* A local **manifest** (`docs/media/thumbs/manifest.json`) — the provenance
  record. For every generation we keep the slot, variant, prompt, model, params,
  the fal `request_id`, the (temporary) result URL, and the local file. This is
  what lets us re-find a winner, reproduce it, or sync it later. It is committed
  to the repo; the generated image bytes in `_gen/` are scratch and gitignored.

* fal **Assets**, fal's own searchable media library. We don't re-upload bytes:
  a generation returns a fal-hosted result URL, and the ingest endpoint pulls
  the bytes from fal's CDN, indexes the prompt, and files the asset into a
  collection in one call. See `upload_to_collection`.

Auth + TLS: reads `FAL_KEY` from the environment (never hardcode it). On the
python.org framework build behind a TLS-intercepting proxy you may need to run
with `SSL_CERT_FILE=/tmp/cacert.pem` (see scripts/README / brand-image notes).
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.request
from typing import Any

# The manifest lives next to the committed finals so provenance ships with them.
MANIFEST = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "docs", "media", "thumbs", "manifest.json")
)

# fal Platform APIs base (verified against https://api.fal.ai/v1/openapi.json).
ASSETS_BASE = os.environ.get("FAL_ASSETS_BASE", "https://api.fal.ai/v1/assets")
# Default collection every brand render is filed under. The project's brand
# collection id; override via env. Create more with create_collection().
DEFAULT_COLLECTION = os.environ.get(
    "FAL_ASSETS_COLLECTION", "d8nf53kregj0m3bnnbmg"  # "Tamper Signal — brand imagery"
)


def _key() -> str:
    key = os.environ.get("FAL_KEY")
    if not key:
        raise RuntimeError("FAL_KEY not set in environment")
    return key


def load_manifest() -> dict[str, Any]:
    """Return the manifest dict, or an empty skeleton if none exists yet."""
    try:
        with open(MANIFEST, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {"entries": {}}


def save_manifest(data: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")


def load_style() -> dict[str, Any]:
    """Return the trained brand style record ({style_id, base_style, ...}) saved
    by make_style.py, or {} if none has been trained yet. This is how generation
    history feeds forward: a Recraft custom style learned from past winners."""
    return load_manifest().get("brand_style", {})


def record(manifest: dict[str, Any], key: str, entry: dict[str, Any]) -> None:
    """Upsert one generation under a stable key (e.g. "faq-a"), preserving any
    prior `synced`/`asset` fields so re-generating doesn't drop sync state."""
    prior = manifest.setdefault("entries", {}).get(key, {})
    merged = {**prior, **entry}
    manifest["entries"][key] = merged


def _request(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call the Assets API. `path` is appended to ASSETS_BASE. Raises on non-2xx;
    returns parsed JSON (or {} on an empty 2xx body)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{ASSETS_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Key {_key()}",
            "Content-Type": "application/json",
        },
    )
    # Honors SSL_CERT_FILE when set (proxy CA workaround); falls back to default.
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx) as resp:
        raw = resp.read().decode().strip()
    return json.loads(raw) if raw else {}


def upload_to_collection(url: str, media_type: str, collection_id: str,
                         prompt: str | None = None,
                         favorite: bool = False) -> dict[str, Any]:
    """Ingest a fal-hosted result URL into Assets and file it into a collection
    in one call. fal pulls the bytes from its own CDN — nothing is re-uploaded
    through us. The `prompt` is indexed so the asset is semantically searchable.

    Verified endpoint: `POST /assets/uploads`, required fields `url` + `type`.
    The `url` MUST be fal-hosted (e.g. the result URL from a generation); to add
    arbitrary local media, `fal_client.upload_file()` it to fal storage first.
    Returns the created asset dict, including its `vector_id`. Idempotent: the
    vector_id is derived from the URL, so re-uploading the same URL is a no-op.

    (Note: the queue `request_id` is NOT a handle here — the Assets API ingests
    by media URL, not by queue id.)
    """
    if not collection_id:
        raise ValueError(
            "No collection id. Pass --collection or set FAL_ASSETS_COLLECTION."
        )
    body: dict[str, Any] = {"url": url, "type": media_type, "collection_id": collection_id}
    if prompt:
        body["prompt"] = prompt
    if favorite:
        body["favorite"] = True
    return _request("POST", "/uploads", body).get("asset", {})


def list_collections() -> list[dict[str, Any]]:
    """Return the user's collections (id + name + metadata) — handy for finding
    a collection id to sync into."""
    return _request("GET", "/collections").get("collections", [])


def create_collection(name: str, description: str = "", color: str = "") -> dict[str, Any]:
    """Create a manual collection; returns the new collection dict (incl. `id`)."""
    body: dict[str, Any] = {"name": name}
    if description:
        body["description"] = description
    if color:
        body["color"] = color
    return _request("POST", "/collections", body).get("collection", {})
