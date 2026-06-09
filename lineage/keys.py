"""Ed25519 key generation, loading, signing, and verification.

Public keys are stored as raw 32-byte hex (not PEM) so that badge.js can import
them directly with Web Crypto's crypto.subtle.importKey("raw", ...).
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.exceptions import InvalidSignature

PRIVATE_KEY_NAME = "signing.key"
PUBLIC_KEY_NAME = "signing.pub"


def key_fingerprint(public_key_bytes: bytes) -> str:
    """First 16 hex chars of SHA-256 of the raw public key bytes."""
    return hashlib.sha256(public_key_bytes).hexdigest()[:16]


# FUTURE: this local Ed25519 keypair is the only root of trust today. External
# anchoring (Sigstore keyless signing via OIDC identity, or an RFC 3161 trusted
# timestamp authority) would attach here so verification does not depend solely
# on possession of signing.pub.
def generate_keys(out_dir: str) -> tuple[Path, Path]:
    """Generate an Ed25519 keypair and write it to `out_dir`.

    Writes signing.key (PKCS8 PEM, private) and signing.pub (raw 32-byte public
    key as hex text). Returns the two paths. Caller is responsible for the
    "do not commit" warning so it can be routed to the right output stream.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )

    private_path = out / PRIVATE_KEY_NAME
    public_path = out / PUBLIC_KEY_NAME

    # Private key file gets 0o600 where the platform honors it.
    private_path.write_bytes(private_pem)
    try:
        os.chmod(private_path, 0o600)
    except OSError:
        pass
    public_path.write_text(public_raw.hex() + "\n", encoding="utf-8")

    return private_path, public_path


def load_private_key(path: str) -> Ed25519PrivateKey:
    """Load a PKCS8 PEM Ed25519 private key."""
    pem = Path(path).read_bytes()
    key = serialization.load_pem_private_key(pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError(f"{path} is not an Ed25519 private key")
    return key


def load_public_key_hex(path: str) -> str:
    """Load the raw public key hex string from a .pub file."""
    return Path(path).read_text(encoding="utf-8").strip()


def public_key_from_hex(public_hex: str) -> Ed25519PublicKey:
    """Reconstruct an Ed25519 public key from raw 32-byte hex."""
    return Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_hex))


def public_hex_from_private(private_key: Ed25519PrivateKey) -> str:
    """Raw public key hex derived from a private key."""
    raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return raw.hex()


def sign(private_key: Ed25519PrivateKey, message: bytes) -> str:
    """Sign message bytes -> hex signature."""
    return private_key.sign(message).hex()


def verify(public_hex: str, message: bytes, signature_hex: str) -> bool:
    """Verify a hex signature over message bytes with a raw-hex public key.

    Returns False (never raises) for a bad signature OR for malformed inputs:
    receipt JSON is attacker-controlled in the tamper-evident model, so non-hex
    or wrong-length key/signature material must verify as failure, not crash.
    """
    try:
        public_key = public_key_from_hex(public_hex)
        public_key.verify(bytes.fromhex(signature_hex), message)
        return True
    except (InvalidSignature, ValueError):
        return False
