"""Receipt creation and chain verification.

Receipts are JSON files in a `receipts/` directory: 000_source.json,
001_<transform_name>.json, ... The chain file `chain.json` is an ordered list
of receipt filenames plus the public key hex.

Signing covers the canonical JCS bytes of the receipt body, meaning the whole
receipt object minus its `signature` block.
"""

from __future__ import annotations

import datetime as dt
import inspect
import json
from pathlib import Path
from typing import Any, Callable

from . import SPEC_VERSION
from .canonical import canonical_json_bytes
from .keys import (
    Ed25519PrivateKey,
    key_fingerprint,
    public_hex_from_private,
    sign,
    verify,
)
from .totals import control_totals, totals_delta

CHAIN_FILENAME = "chain.json"
SOURCE_RECEIPT_NAME = "000_source.json"


def _now_iso() -> str:
    """Current UTC time as YYYY-MM-DDTHH:MM:SSZ."""
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def code_hash_of(func: Callable[..., Any]) -> str:
    """SHA-256 of inspect.getsource() of a function -> lowercase hex.

    Callers pass the *undecorated* function so editing the transform body (but
    not the wrapper) changes the hash.
    """
    import hashlib

    source = inspect.getsource(func)
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _sign_body(body: dict[str, Any], private_key: Ed25519PrivateKey) -> dict[str, Any]:
    """Attach a signature block to a receipt body and return the full receipt."""
    message = canonical_json_bytes(body)
    public_hex = public_hex_from_private(private_key)
    signature = {
        "alg": "ed25519",
        "key_fingerprint": key_fingerprint(bytes.fromhex(public_hex)),
        "value": sign(private_key, message),
        # FUTURE: attach external anchoring here (Sigstore transparency-log
        # entry or an RFC 3161 timestamp over `message`) so a receipt can be
        # proven to have existed at a point in time, independent of this key.
    }
    return {**body, "signature": signature}


def build_source_manifest(
    *,
    filename: str,
    evidence_hash: str,
    byte_size: int,
    declared_origin: str,
    semantic_hash: str,
    records: list[dict[str, Any]],
    private_key: Ed25519PrivateKey,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build and sign a source manifest (ingest receipt)."""
    body = {
        "kind": "source_manifest",
        "spec_version": SPEC_VERSION,
        "created_at": created_at or _now_iso(),
        "source": {
            "filename": filename,
            "evidence_hash": evidence_hash,
            "byte_size": byte_size,
            "declared_origin": declared_origin,
        },
        "semantic_hash": semantic_hash,
        "control_totals": control_totals(records),
    }
    return _sign_body(body, private_key)


def build_transform_receipt(
    *,
    name: str,
    code_hash: str,
    code_file: str,
    input_semantic_hash: str,
    output_semantic_hash: str,
    output_records: list[dict[str, Any]],
    private_key: Ed25519PrivateKey,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build and sign a transform receipt."""
    body = {
        "kind": "transform_receipt",
        "spec_version": SPEC_VERSION,
        "created_at": created_at or _now_iso(),
        "transform": {
            "name": name,
            "code_hash": code_hash,
            "code_file": code_file,
        },
        "input_semantic_hash": input_semantic_hash,
        "output_semantic_hash": output_semantic_hash,
        "output_control_totals": control_totals(output_records),
    }
    return _sign_body(body, private_key)


# ---------------------------------------------------------------------------
# Hash accessors that paper over the source vs. transform field naming
# ---------------------------------------------------------------------------
def output_hash_of(receipt: dict[str, Any]) -> str:
    """The hash a receipt hands to the next link (its output)."""
    if receipt["kind"] == "source_manifest":
        return receipt["semantic_hash"]
    return receipt["output_semantic_hash"]


def input_hash_of(receipt: dict[str, Any]) -> str | None:
    """The hash a receipt expects from the previous link, or None for source."""
    if receipt["kind"] == "source_manifest":
        return None
    return receipt["input_semantic_hash"]


def totals_of(receipt: dict[str, Any]) -> dict[str, Any]:
    """The control totals describing a receipt's output."""
    if receipt["kind"] == "source_manifest":
        return receipt["control_totals"]
    return receipt["output_control_totals"]


def stage_name_of(receipt: dict[str, Any]) -> str:
    """Human-legible stage name for a receipt."""
    if receipt["kind"] == "source_manifest":
        return "source"
    return receipt["transform"]["name"]


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------
def _receipt_body(receipt: dict[str, Any]) -> dict[str, Any]:
    """The receipt minus its signature block, i.e. the signed bytes' source."""
    return {k: v for k, v in receipt.items() if k != "signature"}


def write_receipt(chain_dir: str, filename: str, receipt: dict[str, Any]) -> Path:
    """Write a receipt JSON file (pretty-printed for human inspection)."""
    path = Path(chain_dir) / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return path


def read_receipt(chain_dir: str, filename: str) -> dict[str, Any]:
    # Receipt filenames come from chain.json, which is attacker-controlled in
    # the tamper-evident model. Confine reads to chain_dir so a crafted entry
    # like "../../etc/passwd" cannot make `verify` read arbitrary files.
    base = Path(chain_dir).resolve()
    target = (base / filename).resolve()
    if target.parent != base:
        raise ValueError(f"Unsafe receipt path outside chain directory: {filename!r}")
    # A crafted or corrupted chain.json should surface as a clean ValueError,
    # not an unhandled FileNotFoundError / JSONDecodeError.
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read receipt {filename!r}: {exc}") from exc


def read_chain(chain_path: str) -> dict[str, Any]:
    return json.loads(Path(chain_path).read_text(encoding="utf-8"))


def write_chain(chain_dir: str, receipt_files: list[str], public_hex: str) -> Path:
    """Write/overwrite chain.json listing receipt files plus the public key."""
    chain = {
        "spec_version": SPEC_VERSION,
        "public_key": public_hex,
        "receipts": receipt_files,
    }
    path = Path(chain_dir) / CHAIN_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(chain, indent=2) + "\n", encoding="utf-8")
    return path


def next_receipt_filename(chain_dir: str, transform_name: str) -> str:
    """Next sequential receipt filename, e.g. 001_transform_clean.json."""
    existing = read_chain_files(chain_dir)
    index = len(existing)
    return f"{index:03d}_{transform_name}.json"


def read_chain_files(chain_dir: str) -> list[str]:
    """Receipt filenames currently in chain.json, or [] if none yet."""
    chain_path = Path(chain_dir) / CHAIN_FILENAME
    if not chain_path.exists():
        return []
    return read_chain(str(chain_path)).get("receipts", [])


def load_receipts(chain_dir: str) -> list[dict[str, Any]]:
    """Load all receipts in chain order from a chain directory."""
    return [read_receipt(chain_dir, name) for name in read_chain_files(chain_dir)]


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
class ChainResult:
    """Outcome of verifying a chain."""

    def __init__(self) -> None:
        self.ok: bool = True
        self.lines: list[str] = []  # human-legible report lines
        self.broken_link: int | None = None  # downstream index of first break

    def fail(self, *lines: str) -> None:
        self.ok = False
        self.lines.extend(lines)


def verify_signature(receipt: dict[str, Any], public_hex: str) -> bool:
    """Re-verify a receipt's signature against the public key hex."""
    signature = receipt.get("signature")
    if not signature or "value" not in signature:
        return False
    try:
        # Receipt JSON is attacker-controlled: a body with floats or unknown
        # types makes canonical_json_bytes raise, so fail closed rather than
        # crash verification.
        message = canonical_json_bytes(_receipt_body(receipt))
    except (TypeError, ValueError):
        return False
    return verify(public_hex, message, signature["value"])


def verify_chain(
    receipts: list[dict[str, Any]],
    public_hex: str,
    data_semantic_hash: str | None = None,
    data_totals: dict[str, Any] | None = None,
) -> ChainResult:
    """Verify signatures, links, and (optionally) a current-data hash.

    Checks in order: every receipt's signature; every link (receipt N input
    hash == receipt N-1 output hash); if data_semantic_hash is given, that it
    matches the final receipt's output hash. On the first broken link, emits the
    pinpointed report including the totals delta between adjacent receipts.
    """
    result = ChainResult()

    if not receipts:
        result.fail("✗ CHAIN EMPTY: no receipts to verify")
        return result

    # 1) Signatures.
    for index, receipt in enumerate(receipts):
        if not verify_signature(receipt, public_hex):
            result.fail(
                f"✗ SIGNATURE INVALID on receipt {index} ({stage_name_of(receipt)})"
            )
    if not result.ok:
        return result

    # 2) Links.
    for index in range(1, len(receipts)):
        upstream = receipts[index - 1]
        downstream = receipts[index]
        expected = output_hash_of(upstream)
        found = input_hash_of(downstream)
        if found != expected:
            result.broken_link = index
            delta = totals_delta(totals_of(upstream), totals_of(downstream))
            delta_text = ", ".join(delta) if delta else "(no totals changes detected)"
            result.fail(
                f"✗ CHAIN BROKEN at link {index - 1} -> {index} "
                f"({stage_name_of(downstream)})",
                f"  expected input hash {_short(expected)}  "
                f"(output of {stage_name_of(upstream)})",
                f"  found    input hash {_short(found)}",
                f"  Control totals delta vs upstream: {delta_text}",
            )
            return result

    # 3) Optional current-data check against the final receipt.
    if data_semantic_hash is not None:
        final = receipts[-1]
        expected = output_hash_of(final)
        if data_semantic_hash != expected:
            if data_totals is not None:
                delta = totals_delta(totals_of(final), data_totals)
                delta_text = ", ".join(delta) if delta else "(no totals changes detected)"
            else:
                delta_text = "(pass the data records to see which values moved)"
            result.fail(
                f"✗ DATA MISMATCH against final receipt ({stage_name_of(final)})",
                f"  expected output hash {_short(expected)}",
                f"  found    data hash   {_short(data_semantic_hash)}",
                f"  Control totals delta vs receipt: {delta_text}",
            )
            return result

    rows = totals_of(receipts[-1]).get("row_count", "?")
    transforms = sum(1 for r in receipts if r["kind"] == "transform_receipt")
    result.lines.append(
        f"✓ CHAIN INTACT: {len(receipts)} receipts, {transforms} transforms, "
        f"final row_count {rows}"
    )
    return result


def _short(value: str | None) -> str:
    """Abbreviate a hash for the report, keeping head and tail."""
    if value is None:
        return "(none)"
    if len(value) <= 10:
        return value
    return f"{value[:4]}...{value[-2:]}"
