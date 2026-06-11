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
        "issuer": token.issuer,
        "integrated_time": _integrated_time_iso(bundle),
        "bundle": json.loads(bundle.to_json()),
    }
    out = anchor_path_for(chain_path)
    out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


def verify_anchor(
    chain_path: str,
    *,
    identity: str | None = None,
    issuer: str | None = None,
) -> dict[str, Any]:
    """Verify the anchor next to chain.json against the current bytes.

    Enforces the identity recorded at anchor time (or the explicit overrides),
    so a re-anchored file under a different identity fails loudly. Returns
    {ok, identity, issuer, integrated_time, error}.
    """
    _require_sigstore()
    from sigstore.errors import VerificationError
    from sigstore.models import Bundle
    from sigstore.verify import Verifier, policy

    failed = {
        "ok": False,
        "identity": None,
        "issuer": None,
        "integrated_time": None,
        "error": None,
    }
    # anchor.json is local, attacker-modifiable input in this threat model:
    # malformed records fail closed with a structured result, never raise.
    anchor_file = anchor_path_for(chain_path)
    try:
        record = json.loads(anchor_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {**failed, "error": f"anchor record is unreadable or malformed: {exc}"}
    if not isinstance(record, dict):
        return {**failed, "error": "anchor record is not a JSON object"}
    expected_identity = identity or record.get("identity")
    expected_issuer = issuer or record.get("issuer")
    if not expected_identity:
        return {**failed, "error": "anchor record carries no identity to enforce"}

    try:
        bundle = Bundle.from_json(json.dumps(record["bundle"]))
    except Exception as exc:  # noqa: BLE001 - any malformed bundle fails closed
        return {
            **failed,
            "identity": expected_identity,
            "issuer": expected_issuer,
            "error": f"anchor bundle is malformed: {exc}",
        }
    verifier = (
        Verifier.staging() if record.get("instance") == "staging" else Verifier.production()
    )
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
            "identity": expected_identity,
            "issuer": expected_issuer,
            "integrated_time": record.get("integrated_time"),
            "error": str(exc),
        }
    return {
        "ok": True,
        "identity": expected_identity,
        "issuer": expected_issuer,
        "integrated_time": record.get("integrated_time") or _integrated_time_iso(bundle),
        "error": None,
    }
