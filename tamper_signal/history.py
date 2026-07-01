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
import math
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable

from . import SPEC_VERSION
from .canonical import canonical_json_bytes, decimal_to_plain_string
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
    write_text_atomic,
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


def run_stages(receipts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-stage identity and totals in the snapshot's stage shape.

    Shared by build_run_snapshot and `receipts diff`'s chain-dir adapter so a
    live chain and an archived snapshot always compare in the same shape:
    [{name, kind, code_hash?, code_file?, totals}].
    """
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
    return stages


def run_source(receipts: list[dict[str, Any]]) -> dict[str, Any]:
    """Source identity in the snapshot's source shape (filename, origin, columns)."""
    source = receipts[0] if receipts else {}
    return {
        "filename": _str_at(source, "source", "filename", default=""),
        "declared_origin": _str_at(source, "source", "declared_origin", default=""),
        "columns": _source_columns(totals_of(source)),
    }


def build_run_snapshot(
    receipts: list[dict[str, Any]],
    chain: dict[str, Any],
    *,
    key: Ed25519PrivateKey | None = None,
    chain_dir: str | None = None,
    created_at: str | None = None,
    breached: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Build a run snapshot body from a verified chain; sign it when keyed.

    `chain_dir` is only needed for chains that record no receipt_hashes (the
    tail hash is then computed from the last receipt file). `created_at`
    exists for tests and fixtures; production callers take the clock.

    `breached` is the baseline-advancement guard from cross-run judgment
    ({bucket_key: [metric, ...]}): bucket/metric pairs this run's judgment
    flagged as band breaches or settled movement. Later judgments refuse to
    advance baselines from those pairs, so a tampered value never becomes the
    baseline by surviving one yellow. Snapshots without the field (including
    every pre-1.2 snapshot) mean nothing breached.
    """
    source = receipts[0] if receipts else {}

    body: dict[str, Any] = {
        "kind": "run_snapshot",
        "spec_version": SPEC_VERSION,
        "created_at": created_at or _now_iso(),
        "chain_tail_hash": chain_tail_hash(chain_dir if chain_dir is not None else ".", chain),
        "source": run_source(receipts),
        "stages": run_stages(receipts),
    }
    if breached:
        body["breached"] = breached
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
    path = Path(chain_dir) / HISTORY_DIRNAME / f"{snapshot_body_hash(snapshot)}.json"
    return write_text_atomic(path, json.dumps(snapshot, indent=2) + "\n")


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


# Granularities `receipts log` collapses run history into, derived from a
# snapshot's created_at in UTC. Day, month, and quarter key off the calendar
# date; week keys off the ISO-8601 week-numbering year (so 2024-12-30, a
# Monday, lands in 2025-W01, not 2024). Both stacks derive these identically;
# node/history.js periodKey is pinned against the same expectations.
LOG_GRANULARITIES = ("day", "week", "month", "quarter")


def period_key(created_at_iso: str, granularity: str) -> str:
    """The period bucket key for one snapshot's created_at (UTC).

    day -> YYYY-MM-DD, week -> ISO week YYYY-Www, month -> YYYY-MM,
    quarter -> YYYY-Qn. Raises ValueError for an unparseable timestamp or an
    unknown granularity so the CLI can surface a clean error.
    """
    parsed = _parse_created_at(created_at_iso)
    if parsed is None:
        raise ValueError(f"unparseable created_at: {created_at_iso!r}")
    day = parsed.date()
    if granularity == "day":
        return day.isoformat()
    if granularity == "month":
        return f"{day.year:04d}-{day.month:02d}"
    if granularity == "quarter":
        quarter = (day.month - 1) // 3 + 1
        return f"{day.year:04d}-Q{quarter}"
    if granularity == "week":
        iso_year, iso_week, _iso_weekday = day.isocalendar()
        return f"{iso_year:04d}-W{iso_week:02d}"
    raise ValueError(f"unknown granularity: {granularity!r}")


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
    breached: dict[str, list[str]] | None = None,
) -> Path | None:
    """Build and write a run snapshot unless the latest one already covers it.

    Returns the written (or pre-existing) path, or None when the latest valid
    snapshot already records the same chain tail hash (re-verifying an
    unchanged run is a no-op). Raises on build/write failure; CLI callers
    catch everything and degrade to a stderr notice. `breached` threads to
    build_run_snapshot (the baseline-advancement guard).
    """
    # An empty chain has no run to archive. Returning None (rather than letting
    # chain_tail_hash raise) means programmatic callers get a clean no-op
    # instead of an unhandled error.
    try:
        tail = chain_tail_hash(chain_dir, chain)
    except ValueError:
        return None
    latest = latest_snapshot(
        chain_dir, trusted_keys=trusted_keys, on_notice=on_notice
    )
    if latest is not None and latest["snapshot"].get("chain_tail_hash") == tail:
        return None
    snapshot = build_run_snapshot(
        receipts, chain, key=key, chain_dir=chain_dir, breached=breached
    )
    return write_run_snapshot(chain_dir, snapshot)


# ---------------------------------------------------------------------------
# Cross-run judgment (U6)
#
# With a signed tolerance declaration and run history present, CLI verify
# judges the SOURCE MANIFEST's period buckets across runs under the hardened
# two-zone rules and emits typed, flood-controlled yellow caveats plus an
# additive caveat_details array. The tolerance is read ONLY from the chain's
# verified source manifest, never from a snapshot (snapshot copies are
# display-only). All arithmetic is Decimal on the decimal strings; floats
# never enter the math. Mirrored byte-for-byte by node/history.js
# judgeCrossRun.
# ---------------------------------------------------------------------------

# Detail period key for the flat-band (whole-table) fallback comparison.
WHOLE_TABLE_PERIOD = "whole-table"

# A bucket key is a valid period date ONLY in strict extended ISO form
# (YYYY-MM-DD). Python's date.fromisoformat also accepts basic-ISO (20260601)
# and ISO-week (2026-W01) shapes, but the JS regex in node/history.js does
# not; gating on this regex first keeps bucket-date acceptance byte-identical
# across stacks (R14), so a crafted snapshot key cannot settle in one stack
# and stay forever-settling in the other.
_BUCKET_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

BUCKET_LOSS_CAVEAT = "bucket column no longer detected; period judgment unavailable"

COLUMNS_CHANGED_CAVEAT = (
    "source columns changed since a prior run; judged the metrics on the "
    "shared columns only"
)


def empty_judgment() -> dict[str, Any]:
    """A judgment result with every key present and empty.

    Callers rely on the four keys always being present (the CLI ships
    `details` as caveat_details unconditionally), so this is the single
    source of the empty shape.
    """
    return {"caveats": [], "details": [], "notices": [], "breached": {}}


def _source_stage_totals(snapshot: dict[str, Any]) -> dict[str, Any] | None:
    """The source stage's totals in a snapshot, or None when unusable."""
    stages = snapshot.get("stages")
    if not isinstance(stages, list):
        return None
    for stage in stages:
        if isinstance(stage, dict) and stage.get("name") == "source":
            totals = stage.get("totals")
            return totals if isinstance(totals, dict) else None
    return None


def _buckets_of(totals: dict[str, Any]) -> dict[str, Any] | None:
    value = totals.get("period_buckets")
    return value if isinstance(value, dict) else None


def _bucket_deadline(key: Any, settle_hours: int) -> dt.datetime | None:
    """bucket_end (24:00 UTC of the bucket's day) + the settling window.

    Non-date bucket keys (e.g. "_unbucketed") have no end of day: they never
    settle and are band-judged forever.
    """
    if not isinstance(key, str) or not _BUCKET_DATE_RE.match(key):
        return None
    try:
        day = dt.date.fromisoformat(key)
    except ValueError:
        return None
    end = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc) + dt.timedelta(
        days=1
    )
    return end + dt.timedelta(hours=settle_hours)


def _tainted(snapshot: dict[str, Any], bucket: str, metric: str) -> bool:
    """True when this snapshot's judgment flagged the bucket/metric pair.

    Tainted observations never advance baselines (the breached guard):
    judgment keeps comparing against the most recent clean observation.
    """
    breached = snapshot.get("breached")
    if not isinstance(breached, dict):
        return False
    metrics = breached.get(bucket)
    return isinstance(metrics, list) and metric in metrics


def _metric_value(entry: Any, metric: str) -> Decimal | None:
    """A metric's Decimal value in a bucket entry or whole-table totals.

    Metric ids: "row_count", a numeric_sums column name, or
    "null_counts[<column>]" (absent null counts read as 0, since entries only
    list columns with at least one null). Values in snapshots are
    attacker-influenced; anything unparseable reads as None (judged silently
    out of scope), never a crash.
    """
    if not isinstance(entry, dict):
        return None
    if metric == "row_count":
        value = entry.get("row_count")
        if isinstance(value, int) and not isinstance(value, bool):
            return Decimal(value)
        return None
    if metric.startswith("null_counts[") and metric.endswith("]"):
        nulls = entry.get("null_counts")
        value = nulls.get(metric[len("null_counts[") : -1], 0) if isinstance(nulls, dict) else 0
        if isinstance(value, int) and not isinstance(value, bool):
            return Decimal(value)
        return None
    sums = entry.get("numeric_sums")
    value = sums.get(metric) if isinstance(sums, dict) else None
    return _read_decimal(value)


def _read_decimal(value: Any) -> Decimal | None:
    """Read a numeric metric value as Decimal, identically across stacks.

    Sums are normally quantized decimal strings ("12", "12.45"), but an
    attacker-influenced or older snapshot can carry a JSON number instead.
    A string, an int (not bool), and an integer-or-finite float all read as
    the same Decimal so 12, 12.0, and "12" judge identically in both stacks
    (R14). bool, None, NaN, and infinities read as None (silently out of
    scope), never a crash.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            parsed = Decimal(value)
        except InvalidOperation:
            return None
        return parsed if parsed.is_finite() else None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        # Round-trip through the JCS-canonical repr so a float reads the same
        # decimal both stacks would serialize: 12.0 -> "12", not "12.0".
        return Decimal(repr(value))
    return None


def _bucket_metric_names(*entries: Any) -> list[str]:
    """Judged metric ids for a bucket: row_count, numeric sums, null counts."""
    sums: set[str] = set()
    nulls: set[str] = set()
    for entry in entries:
        if isinstance(entry, dict):
            s = entry.get("numeric_sums")
            if isinstance(s, dict):
                sums.update(str(k) for k in s)
            n = entry.get("null_counts")
            if isinstance(n, dict):
                nulls.update(str(k) for k in n)
    names = ["row_count"]
    names.extend(sorted(sums))
    names.extend(f"null_counts[{k}]" for k in sorted(nulls))
    return names


def _flat_metric_names(*totals: Any) -> list[str]:
    """Flat-band metric ids: whole-table row_count plus numeric sums (R11)."""
    sums: set[str] = set()
    for t in totals:
        if isinstance(t, dict):
            s = t.get("numeric_sums")
            if isinstance(s, dict):
                sums.update(str(k) for k in s)
    return ["row_count"] + sorted(sums)


def _signed_plain(value: Decimal) -> str:
    """Plain decimal string with an explicit sign: "+9", "-22", "+9.45"."""
    sign = "-" if value < 0 else "+"
    return sign + decimal_to_plain_string(abs(value))


def _pct_string(delta: Decimal, base: Decimal) -> str:
    """Signed percent of delta against |base|, quantized to 0.1: "+9.2%".

    Sign follows the movement direction (the delta), magnitude is
    |delta| / |base|. Round-half-even at one decimal place matches the exact
    BigInt algorithm in node/history.js.
    """
    from decimal import ROUND_HALF_EVEN

    pct = (abs(delta) / abs(base) * Decimal(100)).quantize(
        Decimal("0.1"), rounding=ROUND_HALF_EVEN
    )
    sign = "-" if delta < 0 else "+"
    return f"{sign}{decimal_to_plain_string(pct)}%"


def _record(
    rtype: str,
    metric: str | None,
    period: str,
    before: Decimal | None,
    after: Decimal | None,
    *,
    zero: bool = False,
    flat: bool = False,
) -> dict[str, Any]:
    return {
        "type": rtype,
        "metric": metric,
        "period": period,
        "before": before,
        "after": after,
        "zero": zero,
        "flat": flat,
    }


def _clamped_elapsed_days(
    first_created: dt.datetime,
    current_created: dt.datetime,
    settle_hours: int,
    now_utc: dt.datetime,
) -> int:
    """Days from the first observation to now, clamped both ways (>= 1).

    The cumulative bound widens with elapsed days, so two clocks must be
    pinned or it could be widened without limit:
    - current_created is clamped to now + FUTURE_SKEW_SECONDS, so a run that
      stamps its own created_at far in the future cannot buy a wider
      allowance (the loaded-snapshot future guard never saw this run's own
      created_at).
    - the result is capped at the settle window in days (ceil(settle/24)), so
      an arbitrarily long gap cannot ratchet the allowance unbounded; past the
      window the bucket is frozen, not endlessly widening.
    """
    horizon = now_utc + dt.timedelta(seconds=FUTURE_SKEW_SECONDS)
    clamped_current = min(current_created, horizon)
    raw_days = math.ceil((clamped_current - first_created).total_seconds() / 86400)
    cap = max(1, math.ceil(settle_hours / 24))
    return max(1, min(raw_days, cap))


def _judge_flat(
    matching: list[tuple[dt.datetime, dict[str, Any], dict[str, Any]]],
    current_totals: dict[str, Any],
    band: Decimal,
    settle_hours: int,
    current_created: dt.datetime,
    now_utc: dt.datetime,
) -> list[dict[str, Any]]:
    """Flat-band fallback: whole-table row_count + numeric sums.

    Hardened to mirror the settling-bucket path so the no-bucket path (a plain
    CSV with no period axis) cannot be ratcheted sub-band every run without
    limit:
    - PER-STEP band against the most recent UNTAINTED observation, AND
    - a CUMULATIVE bound (band * clamped elapsed_days) against the FIRST
      untainted observation.
    Either breach flags. Breaches record under the WHOLE_TABLE_PERIOD sentinel
    so the breached guard keeps a breached whole-table value from becoming the
    next baseline (a breached observation is tainted and skipped as a base).
    """
    records: list[dict[str, Any]] = []
    metrics = _flat_metric_names(*[totals for _created, _snapshot, totals in matching], current_totals)
    for metric in metrics:
        cur = _metric_value(current_totals, metric)
        if cur is None:
            continue
        clean = [
            (created, totals)
            for created, snapshot, totals in matching
            if not _tainted(snapshot, WHOLE_TABLE_PERIOD, metric)
            and _metric_value(totals, metric) is not None
        ]
        if not clean:
            continue
        previous = _metric_value(clean[-1][1], metric)
        first_created = clean[0][0]
        first = _metric_value(clean[0][1], metric)
        breach: dict[str, Any] | None = None
        if previous is not None:
            if previous == 0:
                if cur != 0:
                    breach = _record(
                        "band_breach", metric, WHOLE_TABLE_PERIOD, previous, cur, zero=True, flat=True
                    )
            elif abs(cur - previous) > band * abs(previous):
                breach = _record("band_breach", metric, WHOLE_TABLE_PERIOD, previous, cur, flat=True)
        if breach is None and first is not None:
            elapsed_days = _clamped_elapsed_days(
                first_created, current_created, settle_hours, now_utc
            )
            if first == 0:
                if cur != 0:
                    breach = _record(
                        "band_breach", metric, WHOLE_TABLE_PERIOD, first, cur, zero=True, flat=True
                    )
            elif abs(cur - first) > band * Decimal(elapsed_days) * abs(first):
                breach = _record("band_breach", metric, WHOLE_TABLE_PERIOD, first, cur, flat=True)
        if breach is not None:
            records.append(breach)
    return records


def _judge_buckets(
    matching: list[tuple[dt.datetime, dict[str, Any], dict[str, Any]]],
    current_buckets: dict[str, Any],
    current_created: dt.datetime,
    band: Decimal,
    settle_hours: int,
    now_utc: dt.datetime,
) -> list[dict[str, Any]]:
    """Two-zone judgment of every bucket present in the current run."""
    records: list[dict[str, Any]] = []
    for key in sorted(current_buckets):
        entry = current_buckets[key]
        if not isinstance(entry, dict):
            continue
        observations: list[tuple[dt.datetime, dict[str, Any], dict[str, Any]]] = []
        for created, snapshot, totals in matching:
            buckets = _buckets_of(totals)
            if buckets is None:
                continue
            observed = buckets.get(key)
            if isinstance(observed, dict):
                observations.append((created, snapshot, observed))
        if not observations:
            continue  # no prior observation: new data, never judged
        prior_created = observations[-1][0]
        deadline = _bucket_deadline(key, settle_hours)
        settled_at_prior = deadline is not None and prior_created > deadline
        # Re-observation freeze: the prior observation was still settling, but
        # this run lands WELL past the settling window (more than one full
        # settle window beyond the deadline). The bucket has had ample time to
        # settle; handing it another fresh band * elapsed_days allowance would
        # let a large drift ride in as "still settling." Freeze it against the
        # most recent untainted value instead. AE9 (current just past the
        # deadline, inside one settle window) stays in the settling zone and
        # keeps its bounded allowance, so it stays green.
        settle_span = dt.timedelta(hours=settle_hours)
        settled_now = (
            deadline is not None
            and not settled_at_prior
            and current_created > deadline + settle_span
        )

        for metric in _bucket_metric_names(entry, observations[-1][2]):
            cur = _metric_value(entry, metric)
            if cur is None:
                continue
            # The breached guard: baselines only come from observations whose
            # bucket/metric pair was not flagged in that run's judgment.
            clean = [
                (created, snapshot, observed)
                for created, snapshot, observed in observations
                if not _tainted(snapshot, key, metric)
                and _metric_value(observed, metric) is not None
            ]
            if not clean:
                continue
            if settled_at_prior:
                # FROZEN: judged against the first post-window observation
                # (the settled baseline); a reappearing bucket with no
                # post-window history is judged against the most recent
                # settling-era value.
                post = [obs for obs in clean if obs[0] > deadline]
                base_entry = post[0][2] if post else clean[-1][2]
                base = _metric_value(base_entry, metric)
                if base is None or cur == base:
                    continue
                records.append(_record("settled_movement", metric, key, base, cur))
            elif settled_now:
                # FROZEN on re-observation: the settled baseline is the most
                # recent untainted settling-era value; any movement flags.
                base = _metric_value(clean[-1][2], metric)
                if base is None or cur == base:
                    continue
                records.append(_record("settled_movement", metric, key, base, cur))
            else:
                previous = _metric_value(clean[-1][2], metric)
                first_created = clean[0][0]
                first = _metric_value(clean[0][2], metric)
                breach: dict[str, Any] | None = None
                if previous is not None:
                    if previous == 0:
                        if cur != 0:
                            breach = _record("band_breach", metric, key, previous, cur, zero=True)
                    elif abs(cur - previous) > band * abs(previous):
                        breach = _record("band_breach", metric, key, previous, cur)
                if breach is None and first is not None:
                    elapsed_days = _clamped_elapsed_days(
                        first_created, current_created, settle_hours, now_utc
                    )
                    if first == 0:
                        if cur != 0:
                            breach = _record("band_breach", metric, key, first, cur, zero=True)
                    elif abs(cur - first) > band * Decimal(elapsed_days) * abs(first):
                        breach = _record("band_breach", metric, key, first, cur)
                if breach is not None:
                    records.append(breach)
    return records


def _judge_removals(
    latest_buckets: dict[str, Any], current_buckets: dict[str, Any]
) -> list[dict[str, Any]]:
    """Interior disappearance: a bucket between the current run's min and max
    bucket keys, present in the latest older snapshot, absent now. Trailing-
    edge drops (rolling windows) are out of scope and silent."""
    present = sorted(
        k
        for k in current_buckets
        if isinstance(current_buckets.get(k), dict) and _bucket_deadline(k, 0) is not None
    )
    if not present:
        return []
    lo, hi = present[0], present[-1]
    records: list[dict[str, Any]] = []
    for key in sorted(latest_buckets):
        if key in current_buckets or _bucket_deadline(key, 0) is None:
            continue
        if lo <= key <= hi:
            entry = latest_buckets.get(key)
            before = _metric_value(entry, "row_count")
            records.append(_record("bucket_removed", None, key, before, None))
    return records


def _pick_worst(rtype: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    """The worst record in a (type, metric) group; ties keep the earliest.

    Band breaches rank zero-baseline movement above everything, then by
    |delta| / |before| compared by cross-multiplication (exact in both
    stacks); settled movement ranks by |delta|.
    """
    best = items[0]
    for record in items[1:]:
        if rtype == "band_breach":
            if record["zero"] and not best["zero"]:
                best = record
            elif record["zero"] == best["zero"] and not record["zero"]:
                d_r = abs(record["after"] - record["before"])
                b_r = abs(record["before"])
                d_b = abs(best["after"] - best["before"])
                b_b = abs(best["before"])
                if d_r * b_b > d_b * b_r:
                    best = record
        elif rtype == "settled_movement":
            if abs(record["after"] - record["before"]) > abs(best["after"] - best["before"]):
                best = record
    return best


def _detail_values(record: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    before = record["before"]
    after = record["after"]
    before_s = decimal_to_plain_string(before) if before is not None else None
    after_s = decimal_to_plain_string(after) if after is not None else None
    delta_s = _signed_plain(after - before) if before is not None and after is not None else None
    return before_s, after_s, delta_s


def _rows_suffix(metric: str | None, magnitude: Decimal | None) -> str:
    if metric != "row_count":
        return ""
    return " row" if magnitude is not None and abs(magnitude) == 1 else " rows"


def _format_records(records: list[dict[str, Any]], out: dict[str, Any]) -> None:
    """Flood control: one caveat string and one details entry per
    (type, metric), naming the bucket count and the worst delta; the full
    per-bucket detail rides in caveat_details. Copy follows MESSAGING.md:
    lowercase, locates exactly, never blames, no em dashes, ASCII only."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in records:
        groups.setdefault((record["type"], record["metric"] or ""), []).append(record)

    for rtype, _metric_key in sorted(groups):
        items = sorted(groups[(rtype, _metric_key)], key=lambda r: r["period"])
        metric = items[0]["metric"]
        count = len(items)

        if rtype == "bucket_loss":
            out["caveats"].append(BUCKET_LOSS_CAVEAT)
            out["details"].append(
                {"type": rtype, "metric": None, "periods": 0, "worst": None, "buckets": []}
            )
            continue

        if rtype == "columns_changed":
            out["caveats"].append(COLUMNS_CHANGED_CAVEAT)
            out["details"].append(
                {"type": rtype, "metric": None, "periods": 0, "worst": None, "buckets": []}
            )
            continue

        worst = _pick_worst(rtype, items)
        before_s, after_s, delta_s = _detail_values(worst)
        worst_entry: dict[str, Any] = {
            "period": worst["period"],
            "before": before_s,
            "after": after_s,
            "delta": delta_s,
        }
        if rtype == "band_breach" and not worst["zero"]:
            worst_entry["delta_pct"] = _pct_string(
                worst["after"] - worst["before"], worst["before"]
            )
        buckets = []
        for record in items:
            b, a, d = _detail_values(record)
            buckets.append({"period": record["period"], "before": b, "after": a, "delta": d})
        out["details"].append(
            {
                "type": rtype,
                "metric": metric,
                "periods": count,
                "worst": worst_entry,
                "buckets": buckets,
            }
        )

        if rtype == "band_breach":
            if worst["zero"]:
                display = f"0 -> {after_s}{_rows_suffix(metric, worst['after'])}"
            else:
                display = worst_entry["delta_pct"]
            if worst["flat"]:
                out["caveats"].append(
                    f"totals drift beyond declared band: {metric} moved {display} "
                    "against the previous run (whole-table comparison)"
                )
            else:
                plural = "bucket" if count == 1 else "buckets"
                out["caveats"].append(
                    f"totals drift beyond declared band: {metric} breached in "
                    f"{count} {plural}, worst {worst['period']} ({display})"
                )
        elif rtype == "settled_movement":
            display = f"{delta_s}{_rows_suffix(metric, worst['after'] - worst['before'])}"
            plural = "settled bucket" if count == 1 else "settled buckets"
            out["caveats"].append(
                f"settled period moved: {metric} changed in {count} {plural}, "
                f"worst {worst['period']} ({display})"
            )
        elif rtype == "bucket_removed":
            plural = "bucket" if count == 1 else "buckets"
            verb = "is" if count == 1 else "are"
            out["caveats"].append(
                f"period buckets removed: {count} interior {plural} present in the "
                f"previous run {verb} absent from this run, worst {items[0]['period']}"
            )

    # The baseline-advancement guard for the snapshot this run will write:
    # bucket/metric pairs that breached or moved while settled. Flat-band
    # (whole-table) breaches record under the WHOLE_TABLE_PERIOD sentinel (the
    # record's period) so a breached whole-table value cannot become the next
    # flat baseline either.
    breached: dict[str, set[str]] = {}
    for record in records:
        if record["type"] in ("band_breach", "settled_movement"):
            breached.setdefault(record["period"], set()).add(record["metric"])
    out["breached"] = {key: sorted(metrics) for key, metrics in sorted(breached.items())}


def judge_cross_run(
    receipts: list[dict[str, Any]],
    chain: dict[str, Any],
    snapshots: list[dict[str, Any]],
    *,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """Judge the source manifest's period buckets against run history.

    Pure and side-effect-free: takes the verified chain's receipts, the chain
    document, and validated snapshot bodies (as loaded by load_snapshots);
    returns {"caveats": [str], "details": [...], "notices": [str],
    "breached": {bucket: [metric, ...]}}. The CLI appends the caveat strings
    to the verify result (yellow, never red), prints the notices to stderr,
    ships the details as the additive caveat_details JSON field, and threads
    the breached map into the snapshot it archives.

    Judgment rules (the two-zone model, hardened):
    - tolerance comes ONLY from the signed source manifest; missing means no
      judgment and no output at all (verification stays exact, R6).
    - snapshots of this very run (same chain tail) and snapshots newer than
      the current run are out of scope; history must match the source
      identity (filename + columns) or judgment skips with one notice.
    - zone is classified AT THE PRIOR OBSERVATION: settled iff the prior
      snapshot was taken after bucket_end (24:00 UTC) + settle_hours.
      Settled buckets are frozen (any movement flags); settling buckets get
      the inclusive band per-step AND a cumulative cap of
      band * max(1, elapsed_days since first observation).
    - zero baselines: 0 -> n is a breach reported with the absolute delta;
      0 -> 0 is green. Exactly at the band is green.
    - buckets absent from the current run are silent unless they disappear
      from the interior of the current bucket range (bucket_removed).
    """
    out = empty_judgment()
    source = receipts[0] if receipts and isinstance(receipts[0], dict) else {}
    tolerance = source.get("tolerance") if isinstance(source, dict) else None
    if not isinstance(tolerance, dict):
        return out

    band: Decimal | None = None
    band_raw = tolerance.get("band")
    if isinstance(band_raw, str):
        try:
            parsed = Decimal(band_raw)
        except InvalidOperation:
            parsed = None
        if parsed is not None and parsed.is_finite() and parsed > 0:
            band = parsed
    settle_raw = tolerance.get("settle_hours")
    settle_ok = isinstance(settle_raw, int) and not isinstance(settle_raw, bool) and settle_raw >= 0
    if band is None or not settle_ok:
        out["notices"].append("cross-run judgment skipped: tolerance declaration is malformed")
        return out
    settle_hours = settle_raw

    now_utc = now or dt.datetime.now(dt.timezone.utc)
    tail_receipt = receipts[-1] if receipts and isinstance(receipts[-1], dict) else {}
    current_created = _parse_created_at(tail_receipt.get("created_at")) or now_utc

    # The current run's own snapshot (re-verify) never judges itself.
    tail: str | None = None
    if isinstance(chain, dict):
        names = chain.get("receipts")
        hashes = chain.get("receipt_hashes")
        if isinstance(names, list) and names and isinstance(hashes, dict):
            last = names[-1]
            if isinstance(last, str) and isinstance(hashes.get(last), str):
                tail = hashes[last]

    usable: list[tuple[dt.datetime, dict[str, Any]]] = []
    for snapshot in snapshots:
        if not isinstance(snapshot, dict):
            continue
        if tail is not None and snapshot.get("chain_tail_hash") == tail:
            continue
        created = _parse_created_at(snapshot.get("created_at"))
        if created is None:
            continue
        usable.append((created, snapshot))
    usable.sort(key=lambda pair: pair[0])

    if not usable:
        out["notices"].append("no run history yet; cross-run judgment begins on the next verify")
        return out

    older = [(created, snapshot) for created, snapshot in usable if created <= current_created]
    if not older:
        out["notices"].append(
            "cross-run judgment skipped: archived runs are newer than this chain"
        )
        return out

    identity = run_source(receipts)
    current_columns = identity["columns"] if isinstance(identity["columns"], list) else []
    matching: list[tuple[dt.datetime, dict[str, Any], dict[str, Any]]] = []
    columns_changed = False
    for created, snapshot in older:
        snapshot_source = snapshot.get("source")
        if not isinstance(snapshot_source, dict):
            continue
        # A FILENAME mismatch is a different source: full skip (handled by the
        # empty-matching notice below). A COLUMN-SET change to the same file is
        # not: we still judge the metrics on the shared columns and emit a
        # typed columns_changed caveat, rather than going blind on every drift.
        if snapshot_source.get("filename") != identity["filename"]:
            continue
        totals = _source_stage_totals(snapshot)
        if totals is None:
            continue
        snapshot_columns = snapshot_source.get("columns")
        if isinstance(snapshot_columns, list) and snapshot_columns != current_columns:
            columns_changed = True
        matching.append((created, snapshot, totals))
    if not matching:
        out["notices"].append(
            "cross-run judgment skipped: source identity differs from history"
        )
        return out

    current_totals = totals_of(receipts[0])
    current_buckets = _buckets_of(current_totals)
    latest_totals = matching[-1][2]
    latest_buckets = _buckets_of(latest_totals)

    records: list[dict[str, Any]] = []
    if current_buckets is not None and latest_buckets is not None:
        records.extend(
            _judge_buckets(
                matching, current_buckets, current_created, band, settle_hours, now_utc
            )
        )
        records.extend(_judge_removals(latest_buckets, current_buckets))
    elif current_buckets is not None:
        # Mixed spec (AE14): the previous run predates period buckets. The
        # flat band covers that comparison; bucket history starts fresh.
        out["notices"].append(
            "previous run snapshot has no period buckets; "
            "compared whole-table totals under the flat band"
        )
        records.extend(
            _judge_flat(matching, current_totals, band, settle_hours, current_created, now_utc)
        )
    else:
        if latest_buckets is not None:
            # The previous run had buckets and this one does not: the bucket
            # column went missing, so period judgment is unavailable. The
            # flat band still covers whole-table totals.
            records.append(_record("bucket_loss", None, "", None, None))
        records.extend(
            _judge_flat(matching, current_totals, band, settle_hours, current_created, now_utc)
        )

    if columns_changed:
        records.append(_record("columns_changed", None, "", None, None))

    _format_records(records, out)
    return out
