"""Framework attach helpers: asset sync, Flask, FastAPI."""

from __future__ import annotations

from pathlib import Path

import pytest

from tamper_signal.integrations import ASSET_NAMES, asset_text, signal_snippet

from test_cli_agent_ergonomics import _seed_chain

REPO = Path(__file__).resolve().parent.parent


def test_bundled_assets_match_badge_sources():
    """The package ships byte-identical copies of badge/*.js; drift is a bug.

    Fix drift with: cp badge/{badge,light,element,table}.js tamper_signal/static/
    """
    for name in ASSET_NAMES:
        assert asset_text(name) == (REPO / "badge" / name).read_text(encoding="utf-8"), name


def test_signal_snippet_mounts_light():
    snippet = signal_snippet("/receipts/chain.json")
    assert "mountTamperSignal" in snippet
    assert "/tamper-signal/light.js" in snippet
    assert "document.body" in snippet  # selector fallback


def test_console_snippet_mounts_console():
    from tamper_signal.integrations import console_snippet

    snippet = console_snippet("/receipts/chain.json")
    assert "mountReceiptConsole" in snippet
    assert "/tamper-signal/console.js" in snippet
    assert "document.body" in snippet  # selector fallback


def test_attach_exposes_console_snippet_as_primary_surface(tmp_path, monkeypatch):
    pytest.importorskip("flask")
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    from tamper_signal.flask_ext import attach

    import flask

    handle = attach(flask.Flask(__name__), receipts_dir=str(tmp_path / "receipts"))
    assert "mountReceiptConsole" in handle.console_snippet  # the v2 primary surface
    assert "mountTamperSignal" in handle.snippet  # the light stays available


def test_flask_attach_serves_chain_and_assets(tmp_path, monkeypatch):
    flask = pytest.importorskip("flask")
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)

    from tamper_signal.flask_ext import attach

    app = flask.Flask(__name__)
    handle = attach(app, receipts_dir=str(tmp_path / "receipts"))
    client = app.test_client()

    chain = client.get(handle.chain_url)
    assert chain.status_code == 200 and b"receipts" in chain.data
    asset = client.get(f"{handle.assets_prefix}/light.js")
    assert asset.status_code == 200 and b"mountTamperSignal" in asset.data
    assert client.get(f"{handle.assets_prefix}/evil.js").status_code == 404
    assert "mountTamperSignal" in handle.snippet


def test_fastapi_attach_serves_chain_and_assets(tmp_path, monkeypatch):
    fastapi = pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)

    from tamper_signal.fastapi_ext import attach

    app = fastapi.FastAPI()
    handle = attach(app, receipts_dir=str(tmp_path / "receipts"))
    client = TestClient(app)

    assert client.get(handle.chain_url).status_code == 200
    asset = client.get(f"{handle.assets_prefix}/light.js")
    assert asset.status_code == 200 and "mountTamperSignal" in asset.text
    assert client.get(f"{handle.assets_prefix}/evil.js").status_code == 404


def test_console_routes(tmp_path, monkeypatch):
    flask = pytest.importorskip("flask")
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)

    from tamper_signal.flask_ext import attach

    app = flask.Flask(__name__)
    handle = attach(app, receipts_dir=str(tmp_path / "receipts"))
    client = app.test_client()
    page = client.get(handle.console_url)
    assert page.status_code == 200 and b"mountReceiptConsole" in page.data
    assert client.get(f"{handle.assets_prefix}/console.js").status_code == 200
