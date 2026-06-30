"""Signed annotations: a reason and a self-declared author attached to a
specific receipt in the chain.

An annotation binds to its target by the target receipt's content hash (the
same sha256 `chain.json` records in `receipt_hashes`), carried INSIDE the
signed body so the binding is tamper-evident: a later append cannot retarget a
signed reason. A correction is a new annotation that supersedes a prior one by
its content hash; nothing is ever overwritten (R5).

The `author` is signed attribution, not verified identity: the signature proves
the bytes are unaltered, but the holder of the chain key can sign any author
string. Surfaces that render it must say "self-declared" (U4).

Annotations are NOT chain links (they carry no input/output hashes); they are
sidecar signed records under `<chain_dir>/annotations/`, surfaced by the
provenance timeline. Resolution drops any annotation that does not verify, whose
target is not a known receipt hash, or whose `supersedes` pointer dangles.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from . import SPEC_VERSION
from .canonical import canonical_json_bytes
from .keys import Ed25519PrivateKey
from .receipts import _now_iso, _sign_body, verify_signature, write_text_atomic

ANNOTATIONS_DIRNAME = "annotations"
PENDING_DIRNAME = "pending"


def _annotation_body(annotation: dict[str, Any]) -> dict[str, Any]:
    """The annotation minus its signature and any transient field.

    Excludes the signature block and any underscore-prefixed key (the
    `_hash`/`_superseded` that `resolve_annotations` adds), so re-hashing a
    resolved item yields the same content address as the original signed body —
    the transient render metadata can never leak into the signed bytes.
    """
    return {k: v for k, v in annotation.items() if k != "signature" and not k.startswith("_")}


def annotation_body_hash(annotation: dict[str, Any]) -> str:
    """sha256 hex of the annotation body's canonical bytes (the filename stem)."""
    return hashlib.sha256(canonical_json_bytes(_annotation_body(annotation))).hexdigest()


def build_annotation(
    *,
    target: str,
    reason: str,
    author: str = "",
    supersedes: str | None = None,
    private_key: Ed25519PrivateKey,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build and sign an annotation bound to `target` (a receipt content hash).

    `target`, `reason`, and `author` all join the body before signing, so the
    signature covers them. `supersedes` (a prior annotation's content hash) is
    included only when given. All leaves are strings, so no float ever reaches
    the canonical bytes.
    """
    body: dict[str, Any] = {
        "kind": "annotation",
        "spec_version": SPEC_VERSION,
        "created_at": created_at or _now_iso(),
        "target": target,
        "reason": reason,
        "author": author,
    }
    if supersedes is not None:
        body["supersedes"] = supersedes
    return _sign_body(body, private_key)


def write_annotation(chain_dir: str, annotation: dict[str, Any]) -> Path:
    """Write to `<chain_dir>/annotations/<body-hash>.json`; return the path.

    Content-addressed and atomic, mirroring run snapshots: concurrent writers of
    the same annotation produce the same filename, and an existing file is left
    untouched.
    """
    directory = Path(chain_dir) / ANNOTATIONS_DIRNAME
    path = directory / f"{annotation_body_hash(annotation)}.json"
    return write_text_atomic(path, json.dumps(annotation, indent=2) + "\n")


def read_annotations(chain_dir: str) -> list[dict[str, Any]]:
    """Load every annotation file under `<chain_dir>/annotations/`, oldest first.

    Unreadable or non-JSON files are skipped, not fatal: a stray file in the
    directory must not break the custody view.
    """
    directory = Path(chain_dir) / ANNOTATIONS_DIRNAME
    if not directory.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def _content_body(record: dict[str, Any]) -> dict[str, Any]:
    """A signed record minus its signature and any transient underscore key, so
    re-hashing it reproduces the original content address."""
    return {k: v for k, v in record.items() if k != "signature" and not k.startswith("_")}


def pending_event_body_hash(event: dict[str, Any]) -> str:
    """sha256 hex of a pending event's body canonical bytes (the filename stem
    and the content address an acceptance annotation targets)."""
    return hashlib.sha256(canonical_json_bytes(_content_body(event))).hexdigest()


def build_pending_event(
    *,
    candidate: dict[str, Any],
    judgment: dict[str, Any],
    private_key: Ed25519PrivateKey,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build and sign a withheld watch change for human review (U4/KTD10).

    A pending event is a signed-but-unaccepted record that captures the **full
    reviewed candidate** — the built source manifest, its records, and the chain
    tail it was judged against — so acceptance commits exactly what was reviewed,
    never a re-derived delta. It is signed (the holder of the chain key vouches
    the bytes are unaltered) but is NOT a chain link and is never served. All
    leaves are strings/ints/null, so no float reaches the canonical bytes.
    """
    body: dict[str, Any] = {
        "kind": "pending_event",
        "spec_version": SPEC_VERSION,
        "created_at": created_at or _now_iso(),
        "source_id": candidate["manifest"]["source"]["filename"],
        "base_tail": candidate.get("base_tail"),
        "caveats": list(judgment.get("caveats", [])),
        "details": list(judgment.get("details", [])),
        "candidate": {
            "manifest": candidate["manifest"],
            "records": candidate["records"],
            "public_hex": candidate["public_hex"],
            "trusted_keys": list(candidate.get("trusted_keys", [])),
        },
    }
    return _sign_body(body, private_key)


def write_pending_event(chain_dir: str, event: dict[str, Any]) -> Path:
    """Write to `<chain_dir>/pending/<body-hash>.json` (content-addressed,
    atomic). The directory is added to the `receipts serve` 404 blocklist — a
    held change must never be published until a human accepts it."""
    directory = Path(chain_dir) / PENDING_DIRNAME
    path = directory / f"{pending_event_body_hash(event)}.json"
    return write_text_atomic(path, json.dumps(event, indent=2) + "\n")


def read_pending_events(chain_dir: str) -> list[dict[str, Any]]:
    """Load every pending event under `<chain_dir>/pending/`, oldest first.

    Returns the raw signed events (no transient keys added), mirroring
    `read_annotations`, so a caller can `verify_signature` an item directly;
    compute the content address with `pending_event_body_hash` when needed.
    Unreadable or non-JSON files are skipped, not fatal."""
    directory = Path(chain_dir) / PENDING_DIRNAME
    if not directory.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            event = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(event, dict) and event.get("kind") == "pending_event":
            out.append(event)
    out.sort(key=lambda item: (item.get("created_at") or "", pending_event_body_hash(item)))
    return out


def remove_pending_event(chain_dir: str, body_hash: str) -> bool:
    """Delete the pending event with `body_hash`, confined to the pending dir
    (the hash is content-derived, but resolve the path and re-check containment
    so a crafted value can never escape). Returns True if a file was removed."""
    directory = (Path(chain_dir) / PENDING_DIRNAME).resolve()
    target = (directory / f"{body_hash}.json").resolve()
    if directory not in target.parents:
        return False
    try:
        target.unlink()
        return True
    except FileNotFoundError:
        return False


def resolve_annotations(
    annotations: list[dict[str, Any]],
    public_hex: str,
    valid_targets: set[str],
) -> list[dict[str, Any]]:
    """Filter to verifying, well-bound annotations and apply supersession.

    Drops any annotation whose signature does not verify under `public_hex`, or
    whose `target` is not in `valid_targets` (the chain's receipt content
    hashes). A `supersedes` pointer counts only when it references an annotation
    that itself survived this filter; a dangling or non-verifying pointer is
    ignored. When multiple survivors supersede the same target the target stays
    superseded (forks are retained and visible).

    Returns the surviving annotations, each augmented with `_hash` (its content
    address) and `_superseded` (bool), sorted oldest-first by `created_at`.
    """
    survivors: list[tuple[str, dict[str, Any]]] = []
    for annotation in annotations:
        if not isinstance(annotation, dict) or annotation.get("kind") != "annotation":
            continue
        if annotation.get("target") not in valid_targets:
            continue
        if not verify_signature(annotation, public_hex):
            continue
        survivors.append((annotation_body_hash(annotation), annotation))

    present = {h for h, _ in survivors}
    superseded: set[str] = set()
    for _, annotation in survivors:
        pointer = annotation.get("supersedes")
        if isinstance(pointer, str) and pointer in present:
            superseded.add(pointer)

    resolved: list[dict[str, Any]] = []
    for body_hash, annotation in survivors:
        item = dict(annotation)
        item["_hash"] = body_hash
        item["_superseded"] = body_hash in superseded
        resolved.append(item)
    # Tiebreak on the stored content hash, NOT a recomputed one: the augmented
    # item carries `_hash`/`_superseded`, so re-hashing it would diverge from
    # node/annotations.js (which sorts on the same stored hash) and break the
    # byte-identical cross-stack timeline.
    resolved.sort(key=lambda item: (item.get("created_at") or "", item["_hash"]))
    return resolved
