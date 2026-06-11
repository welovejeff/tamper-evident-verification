"""Tier 4: trusted-key sets, env signing, anchor verify wiring."""

from __future__ import annotations

import json

import pytest

from tamper_signal.canonical import semantic_hash
from tamper_signal.cli import main
from tamper_signal.keys import generate_keys, load_private_key, public_hex_from_private
from tamper_signal.receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    verify_chain,
    write_chain,
    write_receipt,
)

from test_tamper_signal import sample_records


def _two_keypairs(tmp_path):
    generate_keys(str(tmp_path / "ka"))
    generate_keys(str(tmp_path / "kb"))
    a = load_private_key(str(tmp_path / "ka" / "signing.key"))
    b = load_private_key(str(tmp_path / "kb" / "signing.key"))
    return (a, public_hex_from_private(a)), (b, public_hex_from_private(b))


def _manifest(private):
    records = sample_records()
    return build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )


# ---------------------------------------------------------------------------
# 11. Trusted-key sets (rotation)
# ---------------------------------------------------------------------------
def test_chain_signed_by_old_key_verifies_with_rotated_keyset(tmp_path):
    (a, a_pub), (b, b_pub) = _two_keypairs(tmp_path)
    chain = [_manifest(a)]  # signed under the OLD key
    # After rotation the team trusts [new, old]: still green.
    result = verify_chain(chain, [b_pub, a_pub])
    assert result.verdict == "green"
    # Trusting only the new key (and no chain-key fallback) is red.
    assert verify_chain(chain, [b_pub]).verdict == "red"


def test_unrecognized_key_caveat_names_all_trusted_fingerprints(tmp_path):
    (a, a_pub), (b, b_pub) = _two_keypairs(tmp_path)
    chain = [_manifest(a)]
    result = verify_chain(chain, [b_pub], chain_public_hex=a_pub)
    assert result.verdict == "yellow"
    assert "1 trusted key(s)" in result.caveats[0]


def test_cli_accepts_repeated_pub_flags(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    (a, a_pub), (b, b_pub) = _two_keypairs(tmp_path)
    write_receipt("receipts", SOURCE_RECEIPT_NAME, _manifest(a))
    write_chain("receipts", [SOURCE_RECEIPT_NAME], a_pub)
    code = main([
        "verify", "receipts/chain.json",
        "--pub", str(tmp_path / "kb" / "signing.pub"),
        "--pub", str(tmp_path / "ka" / "signing.pub"),
    ])
    assert code == 0
    assert "CHAIN INTACT" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# 12. Signing key from the environment (CI)
# ---------------------------------------------------------------------------
def test_env_key_wins_over_missing_file(tmp_path, monkeypatch):
    generate_keys(str(tmp_path / "keys"))
    pem = (tmp_path / "keys" / "signing.key").read_text()
    # Expected value comes from the FILE path, before the env override exists,
    # so the assertion really compares env-loading against file-loading.
    expected = public_hex_from_private(load_private_key(str(tmp_path / "keys" / "signing.key")))
    monkeypatch.setenv("TAMPER_SIGNAL_KEY", pem)
    key = load_private_key(str(tmp_path / "does-not-exist.key"))
    assert public_hex_from_private(key) == expected


def test_env_key_signs_a_verifiable_receipt(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    generate_keys(str(tmp_path / "keys"))
    pem = (tmp_path / "keys" / "signing.key").read_text()
    monkeypatch.setenv("TAMPER_SIGNAL_KEY", pem)
    (tmp_path / "keys" / "signing.key").unlink()  # no key file on disk

    (tmp_path / "e.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    assert main(["ingest", "e.csv", "--origin", "t", "--key", "ghost.key", "--out", "receipts/"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0


# ---------------------------------------------------------------------------
# 13. Anchor wiring (sigstore boundary is faked; the network call is theirs)
# ---------------------------------------------------------------------------
def _seed(tmp_path):
    generate_keys(str(tmp_path / "keys"))
    private = load_private_key(str(tmp_path / "keys" / "signing.key"))
    write_receipt("receipts", SOURCE_RECEIPT_NAME, _manifest(private))
    write_chain("receipts", [SOURCE_RECEIPT_NAME], public_hex_from_private(private))


def test_verify_anchor_missing_is_yellow(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    code = main(["verify", "receipts/chain.json", "--anchor"])
    out = capsys.readouterr().out
    assert code == 2
    assert "no anchor found" in out


def test_verify_anchor_ok_and_mismatch_paths(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "receipts" / "anchor.json").write_text("{}", encoding="utf-8")

    import tamper_signal.anchor as anchor_mod

    monkeypatch.setattr(anchor_mod, "verify_anchor", lambda chain_path, **kw: {
        "ok": True, "identity": "me@example.com", "issuer": "https://github.com/login/oauth",
        "integrated_time": "2026-06-11T00:00:00Z", "error": None,
    })
    assert main(["verify", "receipts/chain.json", "--anchor"]) == 0
    assert "⚓ anchored" in capsys.readouterr().out

    monkeypatch.setattr(anchor_mod, "verify_anchor", lambda chain_path, **kw: {
        "ok": False, "identity": "me@example.com", "issuer": None,
        "integrated_time": "2026-06-11T00:00:00Z", "error": "signature mismatch",
    })
    assert main(["verify", "receipts/chain.json", "--anchor"]) == 1
    assert "ANCHOR MISMATCH" in capsys.readouterr().out


def test_verify_anchor_json_carries_anchor_lines(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    code = main(["verify", "receipts/chain.json", "--anchor", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["exit_code"] == 2
    assert any("no anchor" in line for line in payload["anchor"])


def test_anchor_record_roundtrip_shape(tmp_path):
    # The record writer/reader contract, without touching the network.
    from tamper_signal.anchor import anchor_path_for

    chain = tmp_path / "receipts" / "chain.json"
    chain.parent.mkdir()
    chain.write_text("{}", encoding="utf-8")
    assert anchor_path_for(str(chain)).name == "anchor.json"
    assert anchor_path_for(str(chain)).parent == chain.parent


def test_verify_anchor_json_payload_stays_consistent(tmp_path, monkeypatch, capsys):
    # Missing anchor must surface in verdict/caveats/report, not only exit_code.
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    code = main(["verify", "receipts/chain.json", "--anchor", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["verdict"] == "yellow"
    assert any("no anchor" in c for c in payload["caveats"])
    assert any("no anchor" in line for line in payload["report"])


def test_malformed_anchor_fails_closed_without_sigstore(tmp_path, monkeypatch, capsys):
    # The parse and identity checks run before the sigstore import, so a
    # corrupt anchor is red even on a plain `pip install tamper-signal`.
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "receipts" / "anchor.json").write_text("not json", encoding="utf-8")
    assert main(["verify", "receipts/chain.json", "--anchor"]) == 1
    assert "ANCHOR MISMATCH" in capsys.readouterr().out

    from tamper_signal.anchor import verify_anchor

    (tmp_path / "receipts" / "anchor.json").write_text("[1, 2, 3]", encoding="utf-8")
    info = verify_anchor("receipts/chain.json")
    assert info["ok"] is False and "not a JSON object" in info["error"]

    (tmp_path / "receipts" / "anchor.json").write_text('{"bundle": {}}', encoding="utf-8")
    info = verify_anchor("receipts/chain.json")
    assert info["ok"] is False and "no identity" in info["error"]


def test_malformed_anchor_bundle_fails_closed(tmp_path, monkeypatch):
    pytest.importorskip("sigstore", reason="bundle parsing needs sigstore")
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)

    from tamper_signal.anchor import verify_anchor

    (tmp_path / "receipts" / "anchor.json").write_text('{"identity": "x", "bundle": 42}', encoding="utf-8")
    info = verify_anchor("receipts/chain.json")
    assert info["ok"] is False and "malformed" in info["error"]
    assert set(info) == {"ok", "instance", "identity", "issuer", "integrated_time", "error"}


def test_anchor_unavailable_with_anchor_present_is_yellow(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "receipts" / "anchor.json").write_text("{}", encoding="utf-8")

    import tamper_signal.anchor as anchor_mod

    def _raise(chain_path, **kw):
        raise anchor_mod.AnchorUnavailable("library unavailable")

    monkeypatch.setattr(anchor_mod, "verify_anchor", _raise)
    assert main(["verify", "receipts/chain.json", "--anchor"]) == 2
    assert "not checkable" in capsys.readouterr().out


def test_anchor_network_failure_is_yellow_not_red(tmp_path, monkeypatch, capsys):
    # A Sigstore outage or offline machine means "could not check", never red.
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "receipts" / "anchor.json").write_text("{}", encoding="utf-8")

    import tamper_signal.anchor as anchor_mod

    def _raise(chain_path, **kw):
        raise RuntimeError("TUF metadata download failed")

    monkeypatch.setattr(anchor_mod, "verify_anchor", _raise)
    assert main(["verify", "receipts/chain.json", "--anchor"]) == 2
    assert "not checkable" in capsys.readouterr().out


def test_red_chain_with_anchor_stays_red(tmp_path, monkeypatch, capsys):
    # Anchor folding must never soften a broken chain from red to yellow.
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    receipt_path = tmp_path / "receipts" / SOURCE_RECEIPT_NAME
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["semantic_hash"] = "0" * 64  # breaks the signature
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    assert main(["verify", "receipts/chain.json", "--anchor"]) == 1


def test_verify_anchor_ok_json_payload_is_green(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "receipts" / "anchor.json").write_text("{}", encoding="utf-8")

    import tamper_signal.anchor as anchor_mod

    monkeypatch.setattr(anchor_mod, "verify_anchor", lambda chain_path, **kw: {
        "ok": True, "instance": "production", "identity": "me@example.com",
        "issuer": "https://github.com/login/oauth",
        "integrated_time": "2026-06-11T00:00:00Z", "error": None,
    })
    code = main(["verify", "receipts/chain.json", "--anchor", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 0
    assert payload["verdict"] == "green" and payload["exit_code"] == 0
    assert any("⚓ anchored" in line for line in payload["anchor"])
    assert not any("anchor" in c for c in payload["caveats"])


def test_empty_pub_file_is_an_error(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    empty = tmp_path / "empty.pub"
    empty.write_text("", encoding="utf-8")
    assert main(["verify", "receipts/chain.json", "--pub", str(empty)]) == 1
    assert "Empty public key" in capsys.readouterr().err


def test_env_key_empty_string_falls_back_to_file(tmp_path, monkeypatch):
    generate_keys(str(tmp_path / "keys"))
    expected = public_hex_from_private(load_private_key(str(tmp_path / "keys" / "signing.key")))
    monkeypatch.setenv("TAMPER_SIGNAL_KEY", "")
    key = load_private_key(str(tmp_path / "keys" / "signing.key"))
    assert public_hex_from_private(key) == expected


def test_env_key_override_is_announced(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    generate_keys(str(tmp_path / "keys"))
    monkeypatch.setenv("TAMPER_SIGNAL_KEY", (tmp_path / "keys" / "signing.key").read_text())
    (tmp_path / "e.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    assert main(["ingest", "e.csv", "--origin", "t", "--key", "ghost.key", "--out", "receipts/"]) == 0
    assert "TAMPER_SIGNAL_KEY" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# 14. chain.json commits to receipt contents (what makes anchoring meaningful)
# ---------------------------------------------------------------------------
def test_receipt_rewritten_after_chain_is_red(tmp_path, monkeypatch, capsys):
    # The re-signing attack: regenerate a receipt under the same key with the
    # same filename. chain.json's recorded hash no longer matches: red.
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    receipt_path = tmp_path / "receipts" / SOURCE_RECEIPT_NAME
    private = load_private_key(str(tmp_path / "keys" / "signing.key"))
    records = sample_records()[:-1]  # the "tampered" data: one row dropped
    receipt = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )  # re-signed under the same key, same filename: internally valid
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")

    code = main(["verify", "receipts/chain.json", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 1
    assert payload["verdict"] == "red"
    assert payload["receipt_mismatch"] == [SOURCE_RECEIPT_NAME]
    assert any("RECEIPT FILE MISMATCH" in line for line in payload["report"])


def test_old_chain_without_receipt_hashes_still_verifies(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    chain_path = tmp_path / "receipts" / "chain.json"
    chain = json.loads(chain_path.read_text(encoding="utf-8"))
    del chain["receipt_hashes"]  # chains written before 1.5.0
    chain_path.write_text(json.dumps(chain, indent=2) + "\n", encoding="utf-8")
    assert main(["verify", "receipts/chain.json"]) == 0
    assert "CHAIN INTACT" in capsys.readouterr().out


def test_anchor_on_old_chain_warns_it_covers_chain_json_only(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    chain_path = tmp_path / "receipts" / "chain.json"
    chain = json.loads(chain_path.read_text(encoding="utf-8"))
    del chain["receipt_hashes"]
    chain_path.write_text(json.dumps(chain, indent=2) + "\n", encoding="utf-8")
    (tmp_path / "receipts" / "anchor.json").write_text("{}", encoding="utf-8")

    import tamper_signal.anchor as anchor_mod

    monkeypatch.setattr(anchor_mod, "verify_anchor", lambda chain_path, **kw: {
        "ok": True, "instance": "production", "identity": "me@example.com",
        "issuer": None, "integrated_time": "2026-06-11T00:00:00Z", "error": None,
    })
    code = main(["verify", "receipts/chain.json", "--anchor"])
    out = capsys.readouterr().out
    assert code == 2
    assert "anchor covers chain.json only" in out


def test_staging_anchor_rejected_without_optin(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "receipts" / "anchor.json").write_text(
        json.dumps({"instance": "staging", "identity": "x", "bundle": {}}), encoding="utf-8"
    )

    from tamper_signal.anchor import verify_anchor

    info = verify_anchor("receipts/chain.json")
    assert info["ok"] is False
    assert "--anchor-staging" in info["error"]
    assert info["instance"] == "staging"


def test_pinned_identity_is_reported_as_pinned(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)
    (tmp_path / "receipts" / "anchor.json").write_text("{}", encoding="utf-8")

    import tamper_signal.anchor as anchor_mod

    monkeypatch.setattr(anchor_mod, "verify_anchor", lambda chain_path, **kw: {
        "ok": True, "instance": "production", "identity": "me@example.com",
        "issuer": None, "integrated_time": "2026-06-11T00:00:00Z", "error": None,
    })
    assert main(["verify", "receipts/chain.json", "--anchor"]) == 0
    assert "pin with --anchor-identity" in capsys.readouterr().out
    assert main([
        "verify", "receipts/chain.json", "--anchor", "--anchor-identity", "me@example.com",
    ]) == 0
    assert "identity me@example.com, pinned" in capsys.readouterr().out


def test_der_utf8_decodes_certificate_issuer_extension():
    # Fulcio's V2 issuer extension is a DER UTF8String; the recorded issuer
    # must be the certificate's (e.g. GitHub for federated browser logins),
    # not the token's federation URL, or verification rejects good anchors.
    from tamper_signal.anchor import _der_utf8

    issuer = "https://github.com/login/oauth"
    der = bytes([0x0C, len(issuer)]) + issuer.encode()
    assert _der_utf8(der) == issuer
    long_value = "x" * 200
    der_long = bytes([0x0C, 0x81, len(long_value)]) + long_value.encode()
    assert _der_utf8(der_long) == long_value
    longer_value = "y" * 300  # two length bytes (0x82)
    der_longer = bytes([0x0C, 0x82]) + len(longer_value).to_bytes(2, "big") + longer_value.encode()
    assert _der_utf8(der_longer) == longer_value
    assert _der_utf8(b"plain") == "plain"  # non-DER input passes through


def test_anchor_command_json_output(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    _seed(tmp_path)

    import tamper_signal.anchor as anchor_mod

    monkeypatch.setattr(anchor_mod, "anchor_chain", lambda chain_path, staging=False: {
        "anchored": "chain.json", "instance": "production", "identity": "me@example.com",
        "issuer": "https://github.com/login/oauth", "integrated_time": "2026-06-11T00:00:00Z",
        "bundle": {"big": "blob"},
    })
    code = main(["anchor", "--chain", "receipts/chain.json", "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert code == 0
    assert payload["ok"] is True
    assert payload["identity"] == "me@example.com"
    assert "bundle" not in payload
    assert payload["anchor_path"].endswith("anchor.json")
