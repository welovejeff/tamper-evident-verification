"""Tests for the watcher's network layer: the SSRF-pinned fetch (byte + wall-clock
caps, redirects off, conditional requests) and safe RSS parsing (plan U2).

The fetch mechanics are tested against a local HTTP server via `_fetch_validated`,
which takes an already-validated (host, ip) — `fetch` itself would refuse
127.0.0.1 at the SSRF gate, so the gate and the mechanics are tested separately.
"""

from __future__ import annotations

import http.server
import threading

import pytest

from tamper_signal.sources import (
    FetchResult,
    SourceError,
    _fetch_validated,
    content_fingerprint,
    fetch,
    rss_records,
)


# ---------------------------------------------------------------------------
# Local server harness
# ---------------------------------------------------------------------------
class _Handler(http.server.BaseHTTPRequestHandler):
    # Set per-test on the server instance.
    def log_message(self, *args):  # silence
        pass

    def do_GET(self):
        spec = self.server.spec  # type: ignore[attr-defined]
        kind = spec.get("kind")
        if kind == "conditional" and self.headers.get("If-None-Match") == spec.get("etag"):
            self.send_response(304)
            self.end_headers()
            return
        if kind == "redirect":
            self.send_response(302)
            self.send_header("Location", spec.get("location", "http://example.com/"))
            self.end_headers()
            return
        body = spec["body"]
        self.send_response(200)
        for header, value in spec.get("headers", {}).items():
            self.send_header(header, value)
        if spec.get("send_content_length", True):
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class _Server:
    def __init__(self, spec):
        self.httpd = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.spec = spec  # type: ignore[attr-defined]
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.thread.join(timeout=2)

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}/feed"


def _get(spec, **kwargs):
    with _Server(spec) as server:
        return _fetch_validated(
            server.url, "127.0.0.1", "127.0.0.1",
            max_bytes=kwargs.get("max_bytes", 5 * 1024 * 1024),
            connect_timeout=5.0, read_timeout=10.0,
            wall_clock=kwargs.get("wall_clock", 30.0),
            etag=kwargs.get("etag"), last_modified=kwargs.get("last_modified"),
        )


# ---------------------------------------------------------------------------
# fetch mechanics
# ---------------------------------------------------------------------------
def test_fetch_returns_body_and_validators():
    result = _get({"body": b'[{"day":"2026-05-01"}]', "headers": {"ETag": '"abc"'}})
    assert isinstance(result, FetchResult)
    assert result.status == 200
    assert result.body == b'[{"day":"2026-05-01"}]'
    assert result.etag == '"abc"'


def test_fetch_byte_cap_via_streaming():
    # Body over the cap, no Content-Length header, so only the streaming cap trips.
    big = b"x" * 10_000
    with pytest.raises(SourceError, match="max size"):
        _get({"body": big, "send_content_length": False}, max_bytes=1000)


def test_fetch_byte_cap_via_content_length():
    big = b"x" * 10_000
    with pytest.raises(SourceError, match="max size"):
        _get({"body": big}, max_bytes=1000)


def test_fetch_refuses_redirect():
    with pytest.raises(SourceError, match="redirect"):
        _get({"kind": "redirect", "location": "http://169.254.169.254/", "body": b""})


def test_fetch_conditional_304_returns_empty():
    result = _get({"kind": "conditional", "etag": '"v1"', "body": b"unused"}, etag='"v1"')
    assert result.status == 304
    assert result.body == b""


# ---------------------------------------------------------------------------
# fetch() SSRF gate (the full entry point still validates)
# ---------------------------------------------------------------------------
def test_fetch_entrypoint_refuses_private_target():
    with pytest.raises(SourceError):
        fetch("http://127.0.0.1/feed")
    with pytest.raises(SourceError):
        fetch("http://169.254.169.254/latest/meta-data/")


# ---------------------------------------------------------------------------
# content fingerprint
# ---------------------------------------------------------------------------
def test_content_fingerprint_is_deterministic_and_sensitive():
    a = content_fingerprint(b"hello")
    assert a == content_fingerprint(b"hello")
    assert a != content_fingerprint(b"hellp")
    assert len(a) == 64  # sha256 hex


# ---------------------------------------------------------------------------
# RSS parsing — safe against hostile XML
# ---------------------------------------------------------------------------
_GOOD_RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Feed</title>
  <item><title>First</title><guid>id-1</guid><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>
  <item><title>Second</title><guid>id-2</guid><pubDate>Tue, 02 Jun 2026 00:00:00 GMT</pubDate></item>
</channel></rss>"""

_BILLION_LAUGHS = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<rss version="2.0"><channel><item><title>&lol2;</title></channel></rss>"""

_EXTERNAL_ENTITY = b"""<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<rss version="2.0"><channel><item><title>&xxe;</title></item></channel></rss>"""


def test_rss_parses_entries():
    recs = rss_records(_GOOD_RSS)
    assert [r["title"] for r in recs] == ["First", "Second"]
    assert recs[0]["id"] == "id-1"


def test_rss_field_map_selects_columns():
    recs = rss_records(_GOOD_RSS, field_map={"headline": "title"})
    assert recs == [{"headline": "First"}, {"headline": "Second"}]


@pytest.mark.parametrize("hostile", [_BILLION_LAUGHS, _EXTERNAL_ENTITY])
def test_rss_refuses_dtd_attacks(hostile):
    with pytest.raises(SourceError):
        rss_records(hostile)


def test_rss_refuses_unparseable():
    with pytest.raises(SourceError):
        rss_records(b"this is not xml at all <<<")


def test_rss_honors_declared_non_utf8_encoding():
    # A latin-1 feed whose title has a byte (0xe9 = é) that is invalid UTF-8.
    # Pre-decoding with utf-8/replace would mojibake it; passing raw bytes lets
    # the prolog's declared encoding drive the parse, so the title is intact.
    feed = (
        '<?xml version="1.0" encoding="iso-8859-1"?>'
        "<rss version=\"2.0\"><channel><item><title>caf\xe9</title>"
        "<guid>id-1</guid></item></channel></rss>"
    ).encode("iso-8859-1")
    recs = rss_records(feed)
    assert recs[0]["title"] == "caf\xe9"  # "café", not "caf<replacement>"
