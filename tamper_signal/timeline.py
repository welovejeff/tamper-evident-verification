"""The narrow, published provenance timeline (plan U3).

`timeline.json` is the one document a remote viewer fetches for the
chain-of-custody view: the chain's imports and changes, each change's
control-totals and any signed annotations (reason + self-declared author), and a
minimal reupload count. It deliberately omits per-day period buckets and run
cadence (KTD2) — that richer history is CLI-local (U7) and never served.

Integrity has two layers. The document carries `chain_tail` (the tail receipt's
content hash); the console checks it against the chain it independently
verified, so a `timeline.json` from a different chain is rejected. When a signing
key is available the whole document is also signed, so its own bytes are
tamper-evident under the chain's key. The verdict still comes from `chain.json`,
never from this document (R16).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import SPEC_VERSION
from .annotations import read_annotations, resolve_annotations
from .keys import Ed25519PrivateKey
from .receipts import _now_iso, _sign_body, output_hash_of, stage_name_of, totals_of

TIMELINE_FILENAME = "timeline.json"
_ARCHIVE_DIRNAME = "archive"

# The narrow totals a published entry carries: top-level aggregates only. The
# per-day `period_buckets` and `date_ranges` stay CLI-local (KTD2).
_NARROW_TOTALS_KEYS = ("row_count", "numeric_sums", "null_counts")


def _narrow_totals(receipt: dict[str, Any]) -> dict[str, Any]:
    totals = totals_of(receipt)
    return {k: totals[k] for k in _NARROW_TOTALS_KEYS if k in totals}


def build_timeline(
    receipts: list[dict[str, Any]],
    chain: dict[str, Any],
    chain_dir: str,
    *,
    key: Ed25519PrivateKey | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build the timeline document from a chain and its resolved annotations.

    Signed when `key` is given (mirrors run snapshots): the chain-tail binding
    works without a key, the signature is the additional self-integrity layer.
    """
    files = chain.get("receipts", [])
    hashes = chain.get("receipt_hashes", {})
    public_hex = chain.get("public_key", "")
    resolved = resolve_annotations(
        read_annotations(chain_dir), public_hex, set(hashes.values())
    )
    by_target: dict[str, list[dict[str, Any]]] = {}
    for annotation in resolved:
        by_target.setdefault(annotation["target"], []).append(annotation)

    entries: list[dict[str, Any]] = []
    prev_rows: int | None = None
    for index, (filename, receipt) in enumerate(zip(files, receipts)):
        totals = _narrow_totals(receipt)
        rows = totals.get("row_count")
        entry: dict[str, Any] = {
            "index": index,
            "stage": stage_name_of(receipt),
            "created_at": receipt.get("created_at", ""),
            "output_hash": output_hash_of(receipt),
            "totals": totals,
        }
        if receipt.get("kind") == "source_manifest":
            entry["kind"] = "import"
            entry["origin"] = (receipt.get("source") or {}).get("declared_origin", "")
        else:
            entry["kind"] = "change"
            entry["code_hash"] = (receipt.get("transform") or {}).get("code_hash", "")
            if isinstance(prev_rows, int) and isinstance(rows, int):
                entry["row_delta"] = rows - prev_rows
        target = hashes.get(filename, "")
        annotations = by_target.get(target, [])
        if annotations:
            entry["annotations"] = [
                {
                    "reason": annotation.get("reason", ""),
                    "author": annotation.get("author", ""),
                    "self_declared": True,
                    "superseded": annotation.get("_superseded", False),
                    "hash": annotation.get("_hash", ""),
                }
                for annotation in annotations
            ]
        entries.append(entry)
        if isinstance(rows, int):
            prev_rows = rows

    body: dict[str, Any] = {
        "kind": "timeline",
        "spec_version": SPEC_VERSION,
        "created_at": created_at or _now_iso(),
        "chain_tail": hashes.get(files[-1], "") if files else "",
        "public_key": public_hex,
        "entries": entries,
    }
    archive = Path(chain_dir) / _ARCHIVE_DIRNAME
    if archive.is_dir():
        count = sum(1 for child in archive.iterdir() if child.is_dir())
        if count:
            # Narrow by design: a count only, never the archived contents.
            body["reuploads"] = {"count": count}

    if key is not None:
        return _sign_body(body, key)
    return body


def write_timeline(chain_dir: str, timeline: dict[str, Any], out: str | None = None) -> Path:
    """Write the timeline document; default `<chain_dir>/timeline.json`."""
    path = Path(out) if out else Path(chain_dir) / TIMELINE_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(timeline, indent=2) + "\n", encoding="utf-8")
    return path
