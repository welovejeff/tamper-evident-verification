"""External anchoring: prove a chain existed at a point in time.

The local Ed25519 keypair is the day-to-day root of trust, and its known gap
is that whoever holds the key can re-sign a fresh, internally consistent
chain at any time. Anchoring closes that gap for the moments that matter:
`receipts anchor` signs the exact bytes of chain.json into the Sigstore
public transparency log under your OIDC identity (GitHub/Google/Microsoft
login, or the ambient identity in CI). The log entry's inclusion time is
public and append-only, so the chain provably existed, byte for byte, at
that moment, independent of the signing key.

What this proves: the anchored chain.json existed at the logged time and was
anchored by the recorded identity. What it does not prove: anything about
times before the anchor, or that the identity is the right one; check that
the recorded identity is yours (or your CI's) when it matters.

Requires the optional dependency: pip install "tamper-signal[anchor]".
The anchor file (anchor.json, next to chain.json) holds the Sigstore bundle
plus the identity and issuer recorded at anchor time; verification enforces
that same identity, so a swapped anchor under someone else's identity is a
loud failure rather than a quiet one.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

ANCHOR_FILENAME = "anchor.json"


class AnchorUnavailable(RuntimeError):
    """sigstore is not installed; anchoring is an optional extra."""


def _require_sigstore():
    try:
        import sigstore  # noqa: F401
    except ImportError as exc:  # pragma: no cover - exercised via CLI message
        raise AnchorUnavailable(
            'External anchoring needs the optional dependency: pip install "tamper-signal[anchor]"'
        ) from exc


def anchor_path_for(chain_path: str) -> Path:
    return Path(chain_path).parent / ANCHOR_FILENAME


_OIDC_ISSUER_V2_OID = "1.3.6.1.4.1.57264.1.8"
_OIDC_ISSUER_LEGACY_OID = "1.3.6.1.4.1.57264.1.1"


def _der_utf8(raw: bytes) -> str:
    """Decode a DER-encoded UTF8String (tag 0x0c, length, content)."""
    if len(raw) >= 2 and raw[0] == 0x0C:
        if raw[1] < 0x80:  # short-form length
            return raw[2 : 2 + raw[1]].decode("utf-8")
        num = raw[1] & 0x7F  # long form: number of length bytes follows
        if 1 <= num <= 4 and len(raw) >= 2 + num:
            length = int.from_bytes(raw[2 : 2 + num], "big")
            return raw[2 + num : 2 + num + length].decode("utf-8")
    return raw.decode("utf-8")


def _certificate_issuer(bundle: Any) -> str | None:
    """The OIDC issuer Fulcio embedded in the signing certificate.

    This is what identity policies compare against at verify time, and for
    browser logins federated through the Sigstore OAuth server (GitHub,
    Google, Microsoft) it is the upstream issuer, NOT the federation URL the
    token itself carries. Recording anything else makes verification fail
    against a perfectly good anchor.
    """
    from cryptography import x509

    try:
        cert = bundle.signing_certificate
        try:
            ext = cert.extensions.get_extension_for_oid(
                x509.ObjectIdentifier(_OIDC_ISSUER_V2_OID)
            )
            return _der_utf8(ext.value.value)
        except x509.ExtensionNotFound:
            ext = cert.extensions.get_extension_for_oid(
                x509.ObjectIdentifier(_OIDC_ISSUER_LEGACY_OID)
            )
            return ext.value.value.decode("utf-8")  # legacy: raw bytes, no DER
    except Exception:  # noqa: BLE001 - issuer is best-effort metadata here
        return None


def _integrated_time_iso(bundle: Any) -> str | None:
    entry = getattr(bundle, "log_entry", None)
    epoch = getattr(entry, "integrated_time", None)
    if epoch is None:
        return None
    return dt.datetime.fromtimestamp(int(epoch), tz=dt.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def anchor_chain(chain_path: str, *, staging: bool = False) -> dict[str, Any]:
    """Sign chain.json into the Sigstore transparency log; write anchor.json.

    Uses ambient OIDC credentials when present (GitHub Actions and friends),
    falling back to the interactive browser flow. Returns the anchor record.
    """
    _require_sigstore()
    from sigstore.models import ClientTrustConfig
    from sigstore.oidc import IdentityToken, Issuer, detect_credential
    from sigstore.sign import SigningContext

    artifact = Path(chain_path).read_bytes()

    raw_token = detect_credential()
    if raw_token:
        token = IdentityToken(raw_token)
    else:
        # Interactive browser flow against the public Sigstore OAuth issuer.
        oauth = (
            "https://oauth2.sigstage.dev/auth" if staging else "https://oauth2.sigstore.dev/auth"
        )
        token = Issuer(oauth).identity_token()

    trust = ClientTrustConfig.staging() if staging else ClientTrustConfig.production()
    context = SigningContext.from_trust_config(trust)
    with context.signer(token) as signer:
        bundle = signer.sign_artifact(artifact)

    record = {
        "anchored": str(Path(chain_path).name),
        "instance": "staging" if staging else "production",
        "identity": token.identity,
        "issuer": _certificate_issuer(bundle) or token.issuer,
        "integrated_time": _integrated_time_iso(bundle),
        "bundle": json.loads(bundle.to_json()),
    }
    out = anchor_path_for(chain_path)
    # Atomic replace: a crash mid-write must not leave a truncated anchor.json
    # that the next verify --anchor reads as a tamper alarm.
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    tmp.replace(out)
    return record


def verify_anchor(
    chain_path: str,
    *,
    identity: str | None = None,
    issuer: str | None = None,
    allow_staging: bool = False,
) -> dict[str, Any]:
    """Verify the anchor next to chain.json against the current bytes.

    Enforces the identity recorded at anchor time (or the explicit overrides),
    so a re-anchored file under a different identity fails loudly. Returns
    {ok, instance, identity, issuer, integrated_time, error}.
    """
    failed = {
        "ok": False,
        "instance": None,
        "identity": None,
        "issuer": None,
        "integrated_time": None,
        "error": None,
    }
    # anchor.json is local, attacker-modifiable input in this threat model:
    # malformed records fail closed with a structured result, never raise.
    # The parse and identity checks run before _require_sigstore so a corrupt
    # anchor stays red even when the optional extra is not installed.
    anchor_file = anchor_path_for(chain_path)
    try:
        record = json.loads(anchor_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {**failed, "error": f"anchor record is unreadable or malformed: {exc}"}
    if not isinstance(record, dict):
        return {**failed, "error": "anchor record is not a JSON object"}
    instance = "staging" if record.get("instance") == "staging" else "production"
    # The record is untrusted, so it must not get to pick a weaker trust root:
    # staging anchors verify only when the caller opts in.
    if instance == "staging" and not allow_staging:
        return {
            **failed,
            "instance": instance,
            "error": "anchor was made against the Sigstore staging instance; "
            "pass --anchor-staging to accept it",
        }
    expected_identity = identity or record.get("identity")
    expected_issuer = issuer or record.get("issuer")
    if not expected_identity:
        return {**failed, "instance": instance, "error": "anchor record carries no identity to enforce"}

    _require_sigstore()
    from sigstore.errors import VerificationError
    from sigstore.models import Bundle
    from sigstore.verify import Verifier, policy

    try:
        bundle = Bundle.from_json(json.dumps(record["bundle"]))
    except Exception as exc:  # noqa: BLE001 - any malformed bundle fails closed
        return {
            **failed,
            "instance": instance,
            "identity": expected_identity,
            "issuer": expected_issuer,
            "error": f"anchor bundle is malformed: {exc}",
        }
    verifier = Verifier.staging() if instance == "staging" else Verifier.production()
    artifact = Path(chain_path).read_bytes()
    try:
        verifier.verify_artifact(
            artifact,
            bundle,
            policy.Identity(identity=expected_identity, issuer=expected_issuer),
        )
    except VerificationError as exc:
        return {
            "ok": False,
            "instance": instance,
            "identity": expected_identity,
            "issuer": expected_issuer,
            "integrated_time": record.get("integrated_time"),
            "error": str(exc),
        }
    return {
        "ok": True,
        "instance": instance,
        "identity": expected_identity,
        "issuer": expected_issuer,
        "integrated_time": record.get("integrated_time") or _integrated_time_iso(bundle),
        "error": None,
    }
