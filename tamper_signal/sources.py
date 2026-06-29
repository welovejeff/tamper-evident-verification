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


def _public_ip(ip_text: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Return the address if it is globally routable, else raise SourceError.

    IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is judged by its IPv4 form: the bare
    IPv6 `is_global` can return True while the connection reaches a private
    IPv4 host.
    """
    ip = ipaddress.ip_address(ip_text)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
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
