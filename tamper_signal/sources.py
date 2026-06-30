"""The live-source connector (plan U2): fetch an external feed safely and map
it to canonical records.

This module is the watcher's untrusted-input edge, so it treats the feed as
hostile. URL validation blocks SSRF with an *affirmative* `is_global` gate
(rejecting RFC1918, loopback, link-local, CGNAT, IPv6 ULA, and the cloud
metadata endpoint — ranges a hand-rolled deny-list misses), including the
IPv4-mapped IPv6 form (`::ffff:10.0.0.1`) whose `is_global` would otherwise lie.
The fetch (httpx) and RSS parsing (feedparser + defusedxml) live behind the
`[watch]` install extra and are imported lazily; this validation + JSON-mapping
core is stdlib-only so it always loads.

Feed values are untyped text, exactly the case that broke cross-format hashing
before: JSON numbers are parsed as strings (`parse_float=str`, `parse_int=str`)
so a feed's `"30.00"` becomes the same record string a CSV would, and hashes
identically through the existing canonicalization (no false-red).
"""

from __future__ import annotations

import ipaddress
import json
import socket
import urllib.parse
from typing import Any


class SourceError(RuntimeError):
    """A feed could not be fetched or mapped safely (validation, network, parse)."""


# NAT64 well-known prefix (RFC 6052) and the RFC 8215 local-use prefix. An
# IPv6 address inside these embeds an IPv4 in its low 32 bits; a NAT64 gateway
# routes it to that IPv4, so `64:ff9b::7f00:1` reaches 127.0.0.1 while its bare
# IPv6 `is_global` reads True. Judge the embedded IPv4, like ipv4_mapped.
_NAT64_PREFIXES = (
    ipaddress.ip_network("64:ff9b::/96"),
    ipaddress.ip_network("64:ff9b:1::/48"),
)


def _embedded_ipv4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    """The IPv4 an IPv6 address would actually reach, or None: the ipv4_mapped
    form (`::ffff:a.b.c.d`) or a NAT64-embedded address."""
    if ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    for prefix in _NAT64_PREFIXES:
        if ip in prefix:
            return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return None


def _public_ip(ip_text: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Return the address if it is globally routable, else raise SourceError.

    An IPv6 address that embeds an IPv4 — the `::ffff:` mapped form or a NAT64
    address (`64:ff9b::/96`) — is judged by that IPv4 form: the bare IPv6
    `is_global` can return True while the connection reaches a private host.
    """
    ip = ipaddress.ip_address(ip_text)
    if isinstance(ip, ipaddress.IPv6Address):
        embedded = _embedded_ipv4(ip)
        if embedded is not None:
            ip = embedded
    if not ip.is_global:
        raise SourceError(f"non-public address {ip} refused (SSRF guard)")
    return ip


def validate_public_url(url: str) -> tuple[str, int, list[str]]:
    """Validate a feed URL and resolve it, or raise SourceError.

    Rejects non-http(s) schemes and embedded userinfo, resolves every A/AAAA
    record, and requires **all** of them to be globally routable. Returns
    (host, port, resolved_public_ips) so the caller can pin the connection to a
    validated numeric IP rather than re-resolving (the DNS-rebinding TOCTOU fix).
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SourceError(f"only http/https URLs are allowed, got {parsed.scheme!r}")
    if parsed.username or parsed.password or "@" in (parsed.netloc or ""):
        raise SourceError("userinfo in the URL is not allowed")
    host = parsed.hostname
    if not host:
        raise SourceError("URL has no host")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SourceError(f"could not resolve {host}: {exc}") from exc
    ips = [str(_public_ip(info[4][0])) for info in infos]
    if not ips:
        raise SourceError(f"{host} did not resolve to any address")
    return host, port, ips


def json_records(raw: bytes | str, field_map: dict[str, str] | None = None) -> list[dict[str, str]]:
    """Map a JSON feed (an array of flat objects) to canonical records.

    Numbers are parsed as strings (`parse_float`/`parse_int`) so a feed's
    `"30.00"` keeps its source text and hashes identically to a CSV's `30.00`
    through the existing decimal coercion — no false tamper alarm. `field_map`
    optionally selects/renames columns ({output_column: source_key}); without
    it, every key is carried through. Non-array payloads raise SourceError.
    """
    text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    try:
        data = json.loads(text, parse_float=str, parse_int=str)
    except (ValueError, UnicodeDecodeError) as exc:
        raise SourceError(f"feed is not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise SourceError("JSON feed must be an array of objects")
    records: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            raise SourceError("JSON feed array must contain objects")
        if field_map is None:
            row = {k: _as_text(v) for k, v in item.items()}
        else:
            row = {column: _as_text(item.get(source)) for column, source in field_map.items()}
        records.append(row)
    return records


def _as_text(value: Any) -> str:
    """Coerce a JSON leaf to the text a CSV cell would carry (so hashes match)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def content_fingerprint(body: bytes) -> str:
    """sha256 of the raw body — the authoritative change-detection signal.

    A hostile or compromised origin can mutate a settled value while replaying
    an old `ETag`/`Last-Modified`, so the watcher compares this full-content
    hash, never trusting the server's validator as the sole gate (KTD12).
    """
    import hashlib

    return hashlib.sha256(body).hexdigest()


class FetchResult:
    """The outcome of a safe fetch: status, body, and the validators to echo
    back on the next poll (a bandwidth optimization only, never the gate)."""

    __slots__ = ("status", "body", "etag", "last_modified")

    def __init__(self, status: int, body: bytes, etag: str | None, last_modified: str | None) -> None:
        self.status = status
        self.body = body
        self.etag = etag
        self.last_modified = last_modified


def _read_capped(response: Any, max_bytes: int, wall_clock: float) -> bytes:
    """Stream a response body under a byte cap AND a wall-clock deadline checked
    after every chunk (a read timeout measures only inter-chunk gaps, so a slow
    drip would never trip it)."""
    import time

    deadline = time.monotonic() + wall_clock
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_bytes(chunk_size=65536):
        if time.monotonic() > deadline:
            raise SourceError("fetch exceeded the wall-clock deadline")
        total += len(chunk)
        if total > max_bytes:
            raise SourceError("response exceeded the max size")
        chunks.append(chunk)
    return b"".join(chunks)


def _pinned_client(ip: str, host: str, timeout: Any) -> Any:
    """An httpx client that connects to the validated numeric `ip` while keeping
    the Host header and TLS SNI / cert validation bound to the original `host`,
    so no second DNS resolution happens at connect (the DNS-rebinding TOCTOU
    fix). Redirects are off."""
    import httpx

    class _PinnedTransport(httpx.HTTPTransport):
        def handle_request(self, request: Any) -> Any:
            port = request.url.port
            authority = host if port in (None, 80, 443) else f"{host}:{port}"
            request.headers["Host"] = authority
            extensions = dict(request.extensions or {})
            extensions["sni_hostname"] = host
            request.extensions = extensions
            request.url = request.url.copy_with(host=ip)
            return super().handle_request(request)

    return httpx.Client(transport=_PinnedTransport(), follow_redirects=False, timeout=timeout)


def fetch(
    url: str,
    *,
    max_bytes: int = 5 * 1024 * 1024,
    connect_timeout: float = 10.0,
    read_timeout: float = 30.0,
    wall_clock: float = 60.0,
    etag: str | None = None,
    last_modified: str | None = None,
) -> FetchResult:
    """Validate, then safely fetch a feed URL. Raises SourceError on any guard.

    SSRF-validated (resolve-and-pin), redirects off, TLS verified, and bounded
    by bytes + wall-clock. `etag`/`last_modified` send conditional-request
    headers; a `304` returns an empty body (the caller still treats the content
    fingerprint as authoritative for settled data, KTD12).
    """
    host, _port, ips = validate_public_url(url)
    return _fetch_validated(
        url, host, ips[0], max_bytes=max_bytes, connect_timeout=connect_timeout,
        read_timeout=read_timeout, wall_clock=wall_clock, etag=etag, last_modified=last_modified,
    )


def _fetch_validated(
    url: str,
    host: str,
    ip: str,
    *,
    max_bytes: int,
    connect_timeout: float,
    read_timeout: float,
    wall_clock: float,
    etag: str | None,
    last_modified: str | None,
) -> FetchResult:
    """The fetch mechanics for an already-validated (host, ip). Separated so it
    can be tested against a local server without tripping the SSRF guard."""
    import httpx

    timeout = httpx.Timeout(connect=connect_timeout, read=read_timeout, write=10.0, pool=5.0)
    headers: dict[str, str] = {}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    try:
        with _pinned_client(ip, host, timeout) as client:
            with client.stream("GET", url, headers=headers) as response:
                if response.status_code == 304:
                    return FetchResult(304, b"", etag, last_modified)
                if response.is_redirect:
                    raise SourceError(
                        f"refusing to follow redirect to {response.headers.get('location')!r} (SSRF guard)"
                    )
                response.raise_for_status()
                length = response.headers.get("content-length")
                if length and length.isdigit() and int(length) > max_bytes:
                    raise SourceError("response exceeds max size (Content-Length)")
                body = _read_capped(response, max_bytes, wall_clock)
                return FetchResult(
                    response.status_code, body,
                    response.headers.get("etag"), response.headers.get("last-modified"),
                )
    except httpx.HTTPError as exc:
        raise SourceError(f"fetch failed: {exc}") from exc


def rss_records(raw: bytes | str, field_map: dict[str, str] | None = None) -> list[dict[str, str]]:
    """Map an RSS/Atom feed to records, parsed safely.

    The raw bytes are validated through `defusedxml` (`forbid_dtd=True`) first —
    it raises on DTDs, billion-laughs entity expansion, and external entities —
    so a hostile feed is rejected before `feedparser` extracts anything.
    """
    import defusedxml.ElementTree as DefusedET
    import feedparser

    # Pass raw BYTES to both parsers, never a pre-decoded str: defusedxml and
    # feedparser each honor the XML prolog's declared encoding (iso-8859-1,
    # UTF-16, ...). Decoding with utf-8/replace first would mojibake a non-UTF-8
    # feed — validating and hashing a different byte stream than the real one.
    data = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("utf-8")
    try:
        DefusedET.fromstring(data, forbid_dtd=True)
    except Exception as exc:  # defusedxml raises several subtypes on hostile XML
        raise SourceError(f"unsafe or malformed XML feed: {exc}") from exc
    # defusedxml has already RAISED on any DTD/entity attack above, so feedparser
    # never parses hostile markup; it re-parses the same safe bytes to extract.
    parsed = feedparser.parse(data)
    if parsed.bozo and not parsed.entries:
        raise SourceError("could not parse RSS/Atom feed")
    records: list[dict[str, str]] = []
    for entry in parsed.entries:
        if field_map is None:
            records.append({
                "id": _as_text(entry.get("id")),
                "title": _as_text(entry.get("title")),
                "published": _as_text(entry.get("published")),
            })
        else:
            records.append({col: _as_text(entry.get(src)) for col, src in field_map.items()})
    return records
