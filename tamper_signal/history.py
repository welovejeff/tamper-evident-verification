"""Run snapshots: the durable memory of CLI-verified runs.

Every CLI verify with a non-red final verdict archives a compact run snapshot
to `<chain dir>/history/`. Refreshes overwrite the chain in place, so these
snapshots are the only durable record of prior runs; `receipts diff`,
`receipts log`, and cross-run judgment all read them.

Snapshots are content-addressed: the filename is the sha256 of the body's
canonical JCS bytes, so concurrent verifies of the same run write the same
file and a re-verify is a no-op. When a private key is available the body is
signed with the same signature block receipts carry; without one the snapshot
is written unsigned (a consumer verifying a published chain holds no private
key). History is honestly weaker evidence than the chain: snapshots sit
outside chain.json's receipt_hashes and anchoring.

Everything that reads history is defensive: garbage files, unverifiable
signatures, future timestamps, and symlinks out of the history directory are
skipped with a notice, never a crash, never a red verdict.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any, Callable

from . import SPEC_VERSION
from .canonical import canonical_json_bytes
from .keys import Ed25519PrivateKey
from .receipts import (
    _kind,
    _now_iso,
    _sign_body,
    _str_at,
    receipt_file_hashes,
    stage_name_of,
    totals_of,
    verify_signature,
)

HISTORY_DIRNAME = "history"

# A snapshot whose created_at is further in the future than this many seconds
# (relative to the reading clock) is treated as unverifiable and skipped.
FUTURE_SKEW_SECONDS = 300

# Notices are plain strings handed to a callable (the CLI routes them to
# stderr); a missing callable drops them silently for programmatic callers.
Notice = Callable[[str], None]


def _no_notice(_message: str) -> None:
    return None


def _snapshot_body(snapshot: dict[str, Any]) -> dict[str, Any]:
    """The snapshot minus its signature block (the signed/hashed bytes)."""
    return {k: v for k, v in snapshot.items() if k != "signature"}


def snapshot_body_hash(snapshot: dict[str, Any]) -> str:
    """sha256 hex of the snapshot body's canonical bytes (the filename stem)."""
    return hashlib.sha256(canonical_json_bytes(_snapshot_body(snapshot))).hexdigest()


def chain_tail_hash(chain_dir: str, chain: dict[str, Any]) -> str:
    """The sha256 already recorded in chain.json for the LAST receipt file.

    This is the snapshot's link back to the run it describes: the same hash
    chain.json records under receipt_hashes (sha256 of the receipt file's raw
    bytes). Chains written before receipt hashes were recorded fall back to
    computing the identical hash from the file on disk.
    """
    names = chain.get("receipts") if isinstance(chain, dict) else None
    if not isinstance(names, list) or not names:
        raise ValueError("chain.json lists no receipts")
    last = names[-1]
    if not isinstance(last, str):
        raise ValueError("chain.json receipt entries are not filenames")
    recorded = chain.get("receipt_hashes")
    if isinstance(recorded, dict) and isinstance(recorded.get(last), str):
        return recorded[last]
    return receipt_file_hashes(chain_dir, [last])[last]


def _source_columns(totals: dict[str, Any]) -> list[str]:
    """Sorted normalized column names visible in the source control totals.

    Control totals do not record a full column list, so this is the union of
    the column-keyed maps (numeric_sums, date_ranges, null_counts) plus the
    bucket column, which can otherwise be absent from all three (an ISO-string
    date column is neither numeric nor a typed-date range).
    """
    names: set[str] = set()
    for key in ("numeric_sums", "date_ranges", "null_counts"):
        value = totals.get(key)
        if isinstance(value, dict):
            names.update(str(k) for k in value)
    bucket = totals.get("bucket_column")
    if isinstance(bucket, str):
        names.add(bucket)
    return sorted(names)


def build_run_snapshot(
    receipts: list[dict[str, Any]],
    chain: dict[str, Any],
    *,
    key: Ed25519PrivateKey | None = None,
    chain_dir: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build a run snapshot body from a verified chain; sign it when keyed.

    `chain_dir` is only needed for chains that record no receipt_hashes (the
    tail hash is then computed from the last receipt file). `created_at`
    exists for tests and fixtures; production callers take the clock.
    """
    source = receipts[0] if receipts else {}
    source_totals = totals_of(source)
    stages: list[dict[str, Any]] = []
    for receipt in receipts:
        kind = _kind(receipt)
        stage: dict[str, Any] = {
            "name": stage_name_of(receipt),
            "kind": kind if isinstance(kind, str) else None,
            "totals": totals_of(receipt),
        }
        if kind == "transform_receipt":
            code_hash = _str_at(receipt, "transform", "code_hash", default="")
            if code_hash:
                stage["code_hash"] = code_hash
            code_file = _str_at(receipt, "transform", "code_file", default="")
            if code_file:
                stage["code_file"] = code_file
        stages.append(stage)

    body: dict[str, Any] = {
        "kind": "run_snapshot",
        "spec_version": SPEC_VERSION,
        "created_at": created_at or _now_iso(),
        "chain_tail_hash": chain_tail_hash(chain_dir if chain_dir is not None else ".", chain),
        "source": {
            "filename": _str_at(source, "source", "filename", default=""),
            "declared_origin": _str_at(source, "source", "declared_origin", default=""),
            "columns": _source_columns(source_totals),
        },
        "stages": stages,
    }
    tolerance = source.get("tolerance") if isinstance(source, dict) else None
    if isinstance(tolerance, dict):
        # DISPLAY-ONLY copy. Cross-run judgment (U6) reads the band from the
        # SIGNED source manifest in the chain, never from this snapshot copy:
        # an unsigned snapshot must not be able to relax a declared band.
        body["tolerance"] = tolerance
    if key is not None:
        return _sign_body(body, key)
    return body


def write_run_snapshot(chain_dir: str, snapshot: dict[str, Any]) -> Path:
    """Write a snapshot to <chain_dir>/history/<body-hash>.json; return path.

    Content-addressed: concurrent writers of the same run produce the same
    filename, and an existing file is left untouched (duplicate writes are
    harmless by construction).
    """
    history = Path(chain_dir) / HISTORY_DIRNAME
    history.mkdir(parents=True, exist_ok=True)
    path = history / f"{snapshot_body_hash(snapshot)}.json"
    if not path.exists():
        path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    return path


def _parse_created_at(value: Any) -> dt.datetime | None:
    """Parse a snapshot created_at to an aware UTC datetime, or None."""
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def load_snapshots(
    chain_dir: str,
    *,
    trusted_keys: tuple[str, ...] | list[str] = (),
    now: dt.datetime | None = None,
    on_notice: Notice | None = None,
) -> list[dict[str, Any]]:
    """Load and validate run snapshots, newest first.

    Returns one item per usable snapshot:
    {"filename", "path", "snapshot", "created_at", "body_hash",
     "signed": bool, "verified": bool}. `verified` is True only for signed
    snapshots whose signature verifies under one of `trusted_keys` (callers
    include the chain's embedded key); unsigned snapshots are usable but
    marked weaker (signed=False, verified=False).

    Defensive by contract: garbage JSON, non-snapshot files, unverifiable
    signatures, future timestamps, and paths that resolve outside the history
    directory are skipped with a notice. Never raises for bad content.
    """
    notice = on_notice or _no_notice
    history = Path(chain_dir) / HISTORY_DIRNAME
    if not history.is_dir():
        return []
    base = history.resolve()
    now_utc = now or dt.datetime.now(dt.timezone.utc)
    horizon = now_utc + dt.timedelta(seconds=FUTURE_SKEW_SECONDS)
    keys = [k for k in trusted_keys if isinstance(k, str) and k]

    items: list[dict[str, Any]] = []
    for path in sorted(history.glob("*.json")):
        # Mirror read_receipt's confinement: history filenames on disk are
        # not attacker-supplied the way chain.json entries are, but a symlink
        # placed in history/ must not make the scanner read outside it.
        resolved = path.resolve()
        if resolved.parent != base:
            notice(f"run history: skipping {path.name}: resolves outside the history directory")
            continue
        try:
            snapshot = json.loads(resolved.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            notice(f"run history: skipping unreadable snapshot {path.name}: {exc}")
            continue
        if not isinstance(snapshot, dict) or snapshot.get("kind") != "run_snapshot":
            notice(f"run history: skipping {path.name}: not a run snapshot")
            continue
        created = _parse_created_at(snapshot.get("created_at"))
        if created is None:
            notice(f"run history: skipping {path.name}: missing or malformed created_at")
            continue
        if created > horizon:
            notice(
                f"run history: skipping {path.name}: created_at "
                f"{snapshot.get('created_at')} is in the future"
            )
            continue
        try:
            body_hash = snapshot_body_hash(snapshot)
        except (TypeError, ValueError):
            notice(f"run history: skipping {path.name}: body does not canonicalize")
            continue
        signed = isinstance(snapshot.get("signature"), dict)
        verified = False
        if signed:
            verified = any(verify_signature(snapshot, k) for k in keys)
            if not verified:
                notice(
                    f"run history: skipping {path.name}: signature does not verify "
                    "under any trusted key"
                )
                continue
        items.append(
            {
                "filename": path.name,
                "path": str(resolved),
                "snapshot": snapshot,
                "created_at": snapshot["created_at"],
                "body_hash": body_hash,
                "signed": signed,
                "verified": verified,
            }
        )

    # Newest first; equal created_at ties break on the body hash so both
    # stacks (and concurrent runs) agree on which snapshot is "latest".
    items.sort(key=lambda item: (item["created_at"], item["body_hash"]), reverse=True)
    return items


def latest_snapshot(
    chain_dir: str,
    *,
    trusted_keys: tuple[str, ...] | list[str] = (),
    now: dt.datetime | None = None,
    on_notice: Notice | None = None,
) -> dict[str, Any] | None:
    """The newest snapshot that passes validation, or None."""
    items = load_snapshots(
        chain_dir, trusted_keys=trusted_keys, now=now, on_notice=on_notice
    )
    return items[0] if items else None


def history_has_tail(
    chain_dir: str,
    tail_hash: str,
    *,
    trusted_keys: tuple[str, ...] | list[str] = (),
) -> bool:
    """True when any usable snapshot records this chain tail hash."""
    return any(
        item["snapshot"].get("chain_tail_hash") == tail_hash
        for item in load_snapshots(chain_dir, trusted_keys=trusted_keys)
    )


def archive_run_snapshot(
    chain_dir: str,
    chain: dict[str, Any],
    receipts: list[dict[str, Any]],
    *,
    key: Ed25519PrivateKey | None = None,
    trusted_keys: tuple[str, ...] | list[str] = (),
    on_notice: Notice | None = None,
) -> Path | None:
    """Build and write a run snapshot unless the latest one already covers it.

    Returns the written (or pre-existing) path, or None when the latest valid
    snapshot already records the same chain tail hash (re-verifying an
    unchanged run is a no-op). Raises on build/write failure; CLI callers
    catch everything and degrade to a stderr notice.
    """
    tail = chain_tail_hash(chain_dir, chain)
    latest = latest_snapshot(
        chain_dir, trusted_keys=trusted_keys, on_notice=on_notice
    )
    if latest is not None and latest["snapshot"].get("chain_tail_hash") == tail:
        return None
    snapshot = build_run_snapshot(receipts, chain, key=key, chain_dir=chain_dir)
    return write_run_snapshot(chain_dir, snapshot)
