"""Framework attach helpers: asset sync, Flask, FastAPI."""

from __future__ import annotations

from pathlib import Path

import pytest

from tamper_signal.integrations import ASSET_NAMES, asset_text, signal_snippet

from test_cli_agent_ergonomics import _seed_chain

REPO = Path(__file__).resolve().parent.parent


def test_bundled_assets_match_badge_sources():
    """The package ships byte-identical copies of badge/*.js; drift is a bug.

    Fix drift with: cp badge/{badge,light,element,table,console,room}.js tamper_signal/static/
    """
    assert "room.js" in ASSET_NAMES  # the room ships with every other surface
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


def test_attach_wires_light_to_the_room(tmp_path, monkeypatch):
    pytest.importorskip("flask")
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    from tamper_signal.flask_ext import attach

    import flask

    handle = attach(flask.Flask(__name__), receipts_dir=str(tmp_path / "receipts"))
    assert "mountSignalRoom" in handle.room_snippet  # the one room behind the light
    assert "mountTamperSignal" in handle.snippet  # the light stays available
    # The light's onward link is structurally the room, never raw chain.json.
    assert "receiptsHref" in handle.snippet
    assert f"{handle.room_url}?focus=auto" in handle.snippet
    assert "mountReceiptConsole" in handle.console_snippet  # deprecated alias survives 2.x


def test_attach_bakes_one_policy_into_pill_room_page_and_room_snippet(tmp_path, monkeypatch):
    flask = pytest.importorskip("flask")
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    from tamper_signal.flask_ext import attach

    key = "ab" * 32
    app = flask.Flask(__name__)
    handle = attach(
        app, receipts_dir=str(tmp_path / "receipts"), pub_key=key, warn_drift=True
    )
    # The light snippet carries the same trusted keyset and drift policy the
    # served room page bakes in, so the two can never disagree.
    assert f'["{key}"]' in handle.snippet
    assert "warnDrift: true" in handle.snippet
    assert f'["{key}"]' in handle.room_snippet
    page = app.test_client().get(handle.room_url).data.decode()
    assert f'["{key}"]' in page
    assert "warnDrift: true" in page


def test_attach_room_false_reverts_to_raw_chain(tmp_path, monkeypatch):
    pytest.importorskip("flask")
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)
    from tamper_signal.flask_ext import attach

    import flask

    app = flask.Flask(__name__)
    handle = attach(app, receipts_dir=str(tmp_path / "receipts"), room=False)
    assert "receiptsHref" not in handle.snippet
    assert app.test_client().get(handle.room_url).status_code == 404


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


def test_room_and_console_routes(tmp_path, monkeypatch):
    flask = pytest.importorskip("flask")
    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)

    from tamper_signal.flask_ext import attach

    app = flask.Flask(__name__)
    handle = attach(app, receipts_dir=str(tmp_path / "receipts"))
    client = app.test_client()
    room = client.get(handle.room_url)
    assert room.status_code == 200 and b"mountSignalRoom" in room.data
    # The console route stays reachable, room-backed with its rail open.
    page = client.get(handle.console_url)
    assert page.status_code == 200 and b"mountSignalRoom" in page.data and b'"console"' in page.data
    assert client.get(f"{handle.assets_prefix}/console.js").status_code == 200
    assert client.get(f"{handle.assets_prefix}/room.js").status_code == 200


def test_fastapi_room_route(tmp_path, monkeypatch):
    fastapi = pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    monkeypatch.chdir(tmp_path)
    _seed_chain(tmp_path)

    from tamper_signal.fastapi_ext import attach

    app = fastapi.FastAPI()
    handle = attach(app, receipts_dir=str(tmp_path / "receipts"))
    client = TestClient(app)
    room = client.get(handle.room_url)
    assert room.status_code == 200 and "mountSignalRoom" in room.text
    assert client.get(f"{handle.assets_prefix}/room.js").status_code == 200
