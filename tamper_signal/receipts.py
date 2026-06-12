"""Receipt creation and chain verification.

Receipts are JSON files in a `receipts/` directory: 000_source.json,
001_<transform_name>.json, ... The chain file `chain.json` is an ordered list
of receipt filenames plus the public key hex.

Signing covers the canonical JCS bytes of the receipt body, meaning the whole
receipt object minus its `signature` block.
"""

from __future__ import annotations

import datetime as dt
import hashlib
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
        # External anchoring lives at the chain level: `receipts anchor`
        # (tamper_signal/anchor.py) signs chain.json into the Sigstore
        # transparency log, proving the chain existed at a point in time
        # independent of this key.
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
    tolerance: dict[str, Any] | None = None,
    bucket_column: str | None = None,
) -> dict[str, Any]:
    """Build and sign a source manifest (ingest receipt).

    `tolerance` is the producer's declared continuity expectation
    ({"band": "<plain decimal string>", "settle_hours": <int>, and optionally
    "bucket_column": "<normalized name>"}). It joins the body before signing,
    so the signature covers it; absent declaration means absent field. The
    band is a decimal STRING because floats never enter signed bodies.

    `bucket_column` threads to control_totals so period_buckets key off the
    declared column (a non-qualifying name raises ValueError there).
    """
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
        "control_totals": control_totals(records, bucket_column=bucket_column),
    }
    if tolerance is not None:
        body["tolerance"] = tolerance
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
# Hash accessors that paper over the source vs. transform field naming.
#
# These are deliberately defensive: receipt JSON is attacker-controlled, so a
# malformed receipt must make verify_chain report a clean failure rather than
# crash with KeyError/TypeError. Missing/wrong-typed hashes return distinct
# sentinels (an output can never equal an input sentinel, so two malformed
# receipts never look "linked"), and totals always returns a dict.
# ---------------------------------------------------------------------------
_MISSING_OUTPUT = "<missing-output-hash>"
_MISSING_INPUT = "<missing-input-hash>"


def _str_at(receipt: Any, *keys: str, default: str) -> str:
    """Follow `keys` into nested dicts; return default unless a str is found."""
    cur = receipt
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur if isinstance(cur, str) else default


def _kind(receipt: Any) -> Any:
    return receipt.get("kind") if isinstance(receipt, dict) else None


def output_hash_of(receipt: dict[str, Any]) -> str:
    """The hash a receipt hands to the next link (its output)."""
    if _kind(receipt) == "source_manifest":
        return _str_at(receipt, "semantic_hash", default=_MISSING_OUTPUT)
    return _str_at(receipt, "output_semantic_hash", default=_MISSING_OUTPUT)


def input_hash_of(receipt: dict[str, Any]) -> str | None:
    """The hash a receipt expects from the previous link, or None for source."""
    if _kind(receipt) == "source_manifest":
        return None
    return _str_at(receipt, "input_semantic_hash", default=_MISSING_INPUT)


def totals_of(receipt: dict[str, Any]) -> dict[str, Any]:
    """The control totals describing a receipt's output (always a dict)."""
    key = "control_totals" if _kind(receipt) == "source_manifest" else "output_control_totals"
    value = receipt.get(key) if isinstance(receipt, dict) else None
    return value if isinstance(value, dict) else {}


def stage_name_of(receipt: dict[str, Any]) -> str:
    """Human-legible stage name for a receipt, with a safe fallback."""
    if _kind(receipt) == "source_manifest":
        return "source"
    name = _str_at(receipt, "transform", "name", default="")
    return name or "<unknown>"


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


def receipt_file_hashes(chain_dir: str, receipt_files: list[str]) -> dict[str, str]:
    """sha256 of each receipt file's raw bytes, keyed by filename."""
    return {
        name: hashlib.sha256((Path(chain_dir) / name).read_bytes()).hexdigest()
        for name in receipt_files
    }


def write_chain(chain_dir: str, receipt_files: list[str], public_hex: str) -> Path:
    """Write/overwrite chain.json listing receipt files plus the public key.

    chain.json records the sha256 of each receipt file so it commits to the
    receipt contents, not just their names: anchoring chain.json then
    transitively witnesses every receipt. The receipt files must already be
    on disk (every caller writes receipts before the chain).
    """
    chain = {
        "spec_version": SPEC_VERSION,
        "public_key": public_hex,
        "receipts": receipt_files,
        "receipt_hashes": receipt_file_hashes(chain_dir, receipt_files),
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
    """Outcome of verifying a chain.

    `ok` means the chain verifies (green or yellow). `verdict` is the traffic
    light: "green" (intact, no caveats), "yellow" (verifies, with caveats a
    human should look at), "red" (broken, with the exact link).
    """

    def __init__(self) -> None:
        self.ok: bool = True
        self.lines: list[str] = []  # human-legible report lines
        self.broken_link: int | None = None  # downstream index of first break
        self.caveats: list[str] = []  # yellow-verdict caveats, one per finding
        # Structured failure details for machine consumers (verify --json).
        self.broken_link_detail: dict[str, Any] | None = None
        self.data_mismatch: dict[str, Any] | None = None
        self.receipt_mismatch: list[str] | None = None  # files vs chain.json hashes

    @property
    def verdict(self) -> str:
        if not self.ok:
            return "red"
        return "yellow" if self.caveats else "green"

    def fail(self, *lines: str) -> None:
        self.ok = False
        self.lines.extend(lines)

    def caveat(self, text: str) -> None:
        self.caveats.append(text)


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


def _fingerprint_or(public_hex: str | None, fallback: str = "<malformed key>") -> str:
    """Fingerprint of a raw-hex public key, or a safe placeholder."""
    try:
        return key_fingerprint(bytes.fromhex(public_hex or ""))
    except ValueError:
        return fallback


def _coverage_gaps(receipt_names: list[str]) -> list[str]:
    """Gaps in the generated NNN_ receipt numbering, e.g. 000,001,003.

    Only meaningful when every filename carries the numeric prefix the writer
    generates; hand-named receipt sets opt out rather than getting flagged.
    Returns one human-legible fragment per gap.
    """
    indices: list[int] = []
    for name in receipt_names:
        prefix = name.split("_", 1)[0]
        if not (len(prefix) == 3 and prefix.isdigit()):
            return []
        indices.append(int(prefix))
    gaps: list[str] = []
    if indices and indices[0] != 0:
        gaps.append(f"chain starts at {indices[0]:03d}, not 000")
    for pos in range(1, len(indices)):
        if indices[pos] != indices[pos - 1] + 1:
            gaps.append(f"numbering jumps {indices[pos - 1]:03d} -> {indices[pos]:03d}")
    return gaps


def _as_trusted_keys(public_hex: str | list[str] | None) -> list[str]:
    """Normalize the trusted-key argument to a list (rotation support)."""
    if public_hex is None:
        return []
    if isinstance(public_hex, str):
        return [public_hex]
    return [key for key in public_hex if key]


def verify_chain(
    receipts: list[dict[str, Any]],
    public_hex: str | list[str],
    data_semantic_hash: str | None = None,
    data_totals: dict[str, Any] | None = None,
    *,
    chain_public_hex: str | None = None,
    receipt_names: list[str] | None = None,
    warn_drift: bool = False,
    recorded_hashes: dict[str, str] | None = None,
    actual_hashes: dict[str, str] | None = None,
) -> ChainResult:
    """Verify signatures, links, and (optionally) a current-data hash.

    Checks in order: every receipt's signature; every link (receipt N input
    hash == receipt N-1 output hash); if data_semantic_hash is given, that it
    matches the final receipt's output hash. On the first broken link, emits the
    pinpointed report including the totals delta between adjacent receipts.

    The keyword-only arguments feed the yellow verdict (verifies, with caveats):

    `public_hex` may be a single trusted key or a list of them (key
    rotation: new receipts sign under the new key while old receipts still
    verify under the old one; a signature valid under ANY trusted key is
    trusted).

    - chain_public_hex: the key embedded in chain.json. A receipt whose
      signature fails under every trusted key but verifies under this
      key makes the chain internally consistent yet vouched for by a key the
      caller does not trust: the "unrecognized signing key" caveat, not a
      broken chain. Signatures invalid under both keys are still red.
    - receipt_names: the filenames listed in chain.json. A gap in their NNN_
      numbering suggests a stage ran without leaving a receipt (coverage gap).
    - warn_drift: flag any control-totals movement across intact links as a
      caveat. Off by default because filters and aggregations legitimately
      move totals; turn it on for pipelines expected to preserve them.
    - recorded_hashes / actual_hashes: the receipt-file sha256 map chain.json
      records and the one computed from the files on disk. A mismatch means a
      receipt was rewritten after chain.json was: red, at the exact file.
      Chains written before hashes were recorded pass None and skip the check.
    """
    result = ChainResult()

    if not receipts:
        result.fail("✗ CHAIN EMPTY: no receipts to verify")
        return result

    # 0) Receipt files against the hashes chain.json records. This is what
    # lets an anchored chain.json transitively witness receipt contents.
    if recorded_hashes is not None and actual_hashes is not None:
        mismatched = [
            name
            for name in (receipt_names or [])
            if actual_hashes.get(name) != recorded_hashes.get(name)
        ]
        if mismatched:
            result.receipt_mismatch = mismatched
            for name in mismatched:
                result.fail(
                    f"✗ RECEIPT FILE MISMATCH: {name} does not match the hash "
                    "recorded in chain.json; the receipt was rewritten after the chain was"
                )
            return result

    # 1) Signatures, against the trusted keys first, the chain key as fallback.
    trusted = _as_trusted_keys(public_hex)
    unrecognized: list[int] = []
    use_fallback = bool(chain_public_hex) and chain_public_hex not in trusted
    for index, receipt in enumerate(receipts):
        if any(verify_signature(receipt, key) for key in trusted):
            continue
        if use_fallback and verify_signature(receipt, chain_public_hex):
            unrecognized.append(index)
            continue
        result.fail(
            f"✗ SIGNATURE INVALID on receipt {index} ({stage_name_of(receipt)})"
        )
    if not result.ok:
        return result
    if unrecognized:
        stages = ", ".join(stage_name_of(receipts[i]) for i in unrecognized)
        fingerprints = ", ".join(_fingerprint_or(key) for key in trusted) or "(none)"
        result.caveat(
            f"unrecognized signing key: {len(unrecognized)} receipt(s) ({stages}) "
            f"verify under the chain's embedded key {_fingerprint_or(chain_public_hex)}, "
            f"not any of the {len(trusted)} trusted key(s) ({fingerprints})"
        )

    # 2) Links.
    for index in range(1, len(receipts)):
        upstream = receipts[index - 1]
        downstream = receipts[index]
        expected = output_hash_of(upstream)
        found = input_hash_of(downstream)
        if found != expected:
            result.broken_link = index
            delta = totals_delta(totals_of(upstream), totals_of(downstream))
            result.broken_link_detail = {
                "link": [index - 1, index],
                "stage": stage_name_of(downstream),
                "expected_input_hash": expected,
                "found_input_hash": found,
                "totals_delta": delta,
            }
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
                delta = None
                delta_text = "(pass the data records to see which values moved)"
            result.data_mismatch = {
                "stage": stage_name_of(final),
                "expected_output_hash": expected,
                "found_data_hash": data_semantic_hash,
                "totals_delta": delta,
            }
            result.fail(
                f"✗ DATA MISMATCH against final receipt ({stage_name_of(final)})",
                f"  expected output hash {_short(expected)}",
                f"  found    data hash   {_short(data_semantic_hash)}",
                f"  Control totals delta vs receipt: {delta_text}",
            )
            return result

    # 4) Yellow caveats. Only reachable when the chain itself verifies; red
    # findings above return early and take precedence.
    for gap in _coverage_gaps(receipt_names or []):
        result.caveat(
            f"coverage gap: receipt {gap}; a stage may have run "
            "without leaving a receipt"
        )

    if warn_drift:
        for index in range(1, len(receipts)):
            delta = totals_delta(totals_of(receipts[index - 1]), totals_of(receipts[index]))
            if delta:
                result.caveat(
                    f"totals drift at link {index - 1} -> {index} "
                    f"({stage_name_of(receipts[index])}): " + ", ".join(delta)
                )

    rows = totals_of(receipts[-1]).get("row_count", "?")
    transforms = sum(1 for r in receipts if r["kind"] == "transform_receipt")
    if result.caveats:
        result.lines.append(
            f"⚠ CHAIN VERIFIES, WITH CAVEATS: {len(receipts)} receipts, "
            f"{transforms} transforms, final row_count {rows}"
        )
        for caveat in result.caveats:
            result.lines.append(f"  - {caveat}")
        result.lines.append("  A human should look.")
    else:
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
