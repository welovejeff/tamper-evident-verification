"""Tests for the live-source connector's SSRF guard + JSON mapping (plan U2)."""

from __future__ import annotations

import pytest

from tamper_signal.canonical import semantic_hash
from tamper_signal.sources import SourceError, _public_ip, json_records, validate_public_url


# ---------------------------------------------------------------------------
# SSRF: affirmative is_global gate, including IPv4-mapped IPv6
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])
def test_public_ip_allows_global(ip):
    assert _public_ip(ip)  # does not raise


@pytest.mark.parametrize("ip", [
    "10.0.0.1", "192.168.1.1", "172.16.0.1",   # RFC1918
    "127.0.0.1", "::1",                          # loopback
    "169.254.169.254",                           # link-local / cloud metadata
    "100.64.0.1",                                # CGNAT
    "fc00::1",                                    # IPv6 ULA
    "::ffff:192.168.1.1",                        # IPv4-mapped IPv6 of a private host
    "::ffff:127.0.0.1",                          # IPv4-mapped loopback
    "64:ff9b::7f00:1",                           # NAT64 of 127.0.0.1
    "64:ff9b::a00:1",                            # NAT64 of 10.0.0.1
    "64:ff9b:1::a9fe:a9fe",                      # NAT64 (local prefix) of 169.254.169.254
])
def test_public_ip_refuses_non_global(ip):
    with pytest.raises(SourceError):
        _public_ip(ip)


def test_public_ip_allows_nat64_of_public():
    # A NAT64 address embedding a *public* IPv4 (8.8.8.8) is fine.
    assert _public_ip("64:ff9b::808:808")


def test_validate_url_rejects_scheme_and_userinfo():
    with pytest.raises(SourceError):
        validate_public_url("ftp://example.com/feed")
    with pytest.raises(SourceError):
        validate_public_url("http://user:pw@example.com/feed")
    with pytest.raises(SourceError):
        validate_public_url("file:///etc/passwd")


def test_validate_url_refuses_private_targets():
    # Literal private / loopback IPs and localhost resolve without external DNS.
    with pytest.raises(SourceError):
        validate_public_url("http://127.0.0.1/feed")
    with pytest.raises(SourceError):
        validate_public_url("http://localhost/feed")
    with pytest.raises(SourceError):
        validate_public_url("http://169.254.169.254/latest/meta-data/")


def test_validate_url_allows_public_literal():
    host, port, ips = validate_public_url("http://8.8.8.8/feed")  # literal, no DNS query
    assert host == "8.8.8.8" and port == 80 and ips == ["8.8.8.8"]


# ---------------------------------------------------------------------------
# JSON mapping: untyped feed text hashes identically to a CSV (no false-red)
# ---------------------------------------------------------------------------
def _csv_records(text):
    import tempfile
    from pathlib import Path
    from tamper_signal.canonical import load_records

    p = Path(tempfile.mkdtemp()) / "f.csv"
    p.write_text(text, encoding="utf-8")
    return load_records(str(p))


def test_json_string_values_hash_like_csv():
    feed = '[{"day": "2026-05-01", "amount": "30.00"}, {"day": "2026-05-02", "amount": "20"}]'
    json_recs = json_records(feed)
    csv_recs = _csv_records("day,amount\n2026-05-01,30.00\n2026-05-02,20\n")
    assert semantic_hash(json_recs) == semantic_hash(csv_recs)


def test_json_numeric_values_hash_like_csv():
    # A JSON *number* 30.00 keeps its source text via parse_float, so it coerces
    # to the same decimal as a CSV "30.00" — no false tamper alarm.
    feed = '[{"day": "2026-05-01", "amount": 30.00}, {"day": "2026-05-02", "amount": 20}]'
    json_recs = json_records(feed)
    csv_recs = _csv_records("day,amount\n2026-05-01,30.00\n2026-05-02,20\n")
    assert semantic_hash(json_recs) == semantic_hash(csv_recs)


def test_json_field_map_selects_and_renames():
    feed = '[{"d": "2026-05-01", "amt": "30", "extra": "ignore"}]'
    recs = json_records(feed, field_map={"day": "d", "amount": "amt"})
    assert recs == [{"day": "2026-05-01", "amount": "30"}]


def test_json_non_array_and_malformed_raise():
    with pytest.raises(SourceError):
        json_records('{"not": "an array"}')
    with pytest.raises(SourceError):
        json_records("not json at all")
    with pytest.raises(SourceError):
        json_records('["scalars", "not", "objects"]')


# ---------------------------------------------------------------------------
# Columnar JSON: parallel arrays (weather/finance time-series) zip to records
# ---------------------------------------------------------------------------
def test_columnar_zips_parallel_arrays():
    feed = '{"hourly": {"time": ["2026-06-30T00:00", "2026-06-30T01:00"], "temperature_2m": [18.2, 17.9]}}'
    recs = json_records(feed, columnar={"path": "hourly", "columns": ["time", "temperature_2m"]})
    assert recs == [
        {"time": "2026-06-30T00:00", "temperature_2m": "18.2"},
        {"time": "2026-06-30T01:00", "temperature_2m": "17.9"},
    ]


def test_columnar_values_hash_like_csv():
    feed = '{"hourly": {"time": ["2026-06-30T00:00"], "temperature_2m": [18.20]}}'
    json_recs = json_records(feed, columnar={"path": "hourly", "columns": ["time", "temperature_2m"]})
    csv_recs = _csv_records("time,temperature_2m\n2026-06-30T00:00,18.20\n")
    assert semantic_hash(json_recs) == semantic_hash(csv_recs)


def test_columnar_errors():
    # Missing path.
    with pytest.raises(SourceError):
        json_records('{"other": {}}', columnar={"path": "hourly", "columns": ["time"]})
    # Mismatched array lengths.
    with pytest.raises(SourceError):
        json_records('{"h": {"time": ["a", "b"], "v": [1]}}', columnar={"path": "h", "columns": ["time", "v"]})
    # A named column that is not an array.
    with pytest.raises(SourceError):
        json_records('{"h": {"time": "notarray"}}', columnar={"path": "h", "columns": ["time"]})
