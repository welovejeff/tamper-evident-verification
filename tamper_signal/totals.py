"""Control totals.

Computed on canonicalized data and included in every manifest/receipt. Where
the hashes say "broken", the totals say "how broken" (e.g. 22 rows silently
dropped). Kept human-legible. All numeric sums are quantized decimal strings,
never floats.
"""

from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from .canonical import (
    _coerce_decimal,
    decimal_to_plain_string,
    normalize_cell,
    normalize_header,
)

# A column qualifies as numeric / date when at least this share of its non-null
# values parse as that type.
_TYPE_THRESHOLD = 0.90

# ISO shapes recognized for BUCKETING ONLY (period_buckets). Canonicalization
# (canonical.py) is untouched: a date-shaped string still canonicalizes as a
# string, so semantic hashes do not move. The shapes are strict:
#   date:     YYYY-MM-DD
#   datetime: YYYY-MM-DD then "T" or " ", HH:MM, optional :SS, optional .fff,
#             optional "Z" or +HH:MM/-HH:MM offset.
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$"
)

# Bucket key for rows whose bucket-column value is null or unparseable.
UNBUCKETED_KEY = "_unbucketed"


def _columns(records: list[dict[str, Any]]) -> list[str]:
    """Union of normalized column names, in first-seen order."""
    columns: list[str] = []
    seen: set[str] = set()
    for record in records:
        for key in record.keys():
            name = normalize_header(key)
            if name not in seen:
                seen.add(name)
                columns.append(name)
    return columns


def _try_date(value: Any) -> bool:
    """True only for real date/datetime objects.

    Date detection runs on canonicalized values. A date/datetime serializes to
    an ISO string, but a cell that is merely a date-shaped *string* stays a
    string under canonicalization (its semantic hash is a string too), so it is
    intentionally NOT counted as a date here. That makes this a straight type
    check rather than a parse.
    """
    return isinstance(value, (dt.date, dt.datetime))


def _bucket_key_for(normalized: str | bool | None) -> str | None:
    """Canonical UTC day key (YYYY-MM-DD) for a normalized cell, or None.

    Typed dates/datetimes arrive already normalized by normalize_cell, which
    applies canonical.py's rules: aware datetimes convert to UTC and midnight
    datetimes collapse to the bare date. Date-shaped strings (which stay
    strings under canonicalization) are parsed here under the SAME rules:
    naive datetimes are assumed UTC, aware ones convert to UTC, and the key is
    the date component after that normalization. Strings that match a shape
    but do not parse as a real date (e.g. month 13) return None.
    """
    if not isinstance(normalized, str):
        return None
    if _ISO_DATE_RE.match(normalized):
        try:
            dt.date.fromisoformat(normalized)
        except ValueError:
            return None
        return normalized
    if _ISO_DATETIME_RE.match(normalized):
        try:
            parsed = dt.datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(dt.timezone.utc)
        return parsed.date().isoformat()
    return None


def _period_buckets(
    norm_records: list[dict[str, Any]],
    bucket_column: str,
    columns: list[str],
    numeric_columns: list[str],
) -> dict[str, dict[str, Any]]:
    """Aggregate per-UTC-day buckets keyed off `bucket_column`.

    Column classification happened ONCE on the whole table (the caller passes
    `numeric_columns` from it), so per-bucket numeric_sums always sum to the
    whole-table sums. Rows whose bucket value is null or unparseable land
    under UNBUCKETED_KEY. All sums stay Decimal until serialization.
    """
    row_counts: dict[str, int] = {}
    sums: dict[str, dict[str, Decimal]] = {}
    nulls: dict[str, dict[str, int]] = {}

    for record in norm_records:
        key = _bucket_key_for(normalize_cell(record.get(bucket_column)))
        if key is None:
            key = UNBUCKETED_KEY
        row_counts[key] = row_counts.get(key, 0) + 1
        bucket_sums = sums.setdefault(key, {c: Decimal(0) for c in numeric_columns})
        bucket_nulls = nulls.setdefault(key, {})
        for column in numeric_columns:
            d = _coerce_decimal(record.get(column))
            if d is not None:
                bucket_sums[column] += d
        for column in columns:
            if normalize_cell(record.get(column)) is None:
                bucket_nulls[column] = bucket_nulls.get(column, 0) + 1

    return {
        key: {
            "row_count": row_counts[key],
            "numeric_sums": {
                column: decimal_to_plain_string(total)
                for column, total in sums[key].items()
            },
            "null_counts": nulls[key],
        }
        for key in sorted(row_counts)
    }


def control_totals(
    records: list[dict[str, Any]], *, bucket_column: str | None = None
) -> dict[str, Any]:
    """Compute control totals over a list-of-dicts.

    Returns row_count, column_count, numeric_sums, date_ranges, null_counts.
    A column counts as numeric/date when >= 90% of its non-null values parse as
    that type. null_counts lists only columns with at least one null.

    When a bucket column resolves, the result also carries "bucket_column" and
    "period_buckets" (per-UTC-day row_count, numeric_sums, null_counts). A
    column qualifies for bucketing when >= 90% of its non-null values are
    typed dates/datetimes or ISO-shaped date strings (a bucketing-only rule;
    see _ISO_DATE_RE / _ISO_DATETIME_RE). Exactly one qualifying column is
    used automatically; with several, pass `bucket_column` to pick one (a name
    that fails detection raises ValueError); with none, no buckets.
    """
    columns = _columns(records)
    row_count = len(records)

    # Look up cells by normalized key so totals follow the same normalization
    # rules as hashing. canonicalize() accepts non-normalized list-of-dicts, so
    # totals must too, otherwise non-normalized keys would all read as null.
    norm_records = [
        {normalize_header(k): v for k, v in record.items()} for record in records
    ]

    null_counts: dict[str, int] = {}
    numeric_sums: dict[str, str] = {}
    date_ranges: dict[str, dict[str, str]] = {}
    bucket_candidates: list[str] = []

    for column in columns:
        non_null: list[Any] = []
        nulls = 0
        for record in norm_records:
            value = record.get(column)
            normalized = normalize_cell(value)
            if normalized is None:
                nulls += 1
            else:
                non_null.append(value)
        if nulls > 0:
            null_counts[column] = nulls

        if not non_null:
            continue

        # Bucket-column detection (bucketing only; canonicalization untouched):
        # typed dates/datetimes and ISO-shaped date strings both count.
        date_shaped = sum(
            1 for v in non_null if _bucket_key_for(normalize_cell(v)) is not None
        )
        if date_shaped / len(non_null) >= _TYPE_THRESHOLD:
            bucket_candidates.append(column)

        # Numeric detection + sum.
        decimals = [_coerce_decimal(v) for v in non_null]
        numeric = [d for d in decimals if d is not None]
        if len(numeric) / len(non_null) >= _TYPE_THRESHOLD:
            total = sum(numeric, Decimal(0))
            numeric_sums[column] = decimal_to_plain_string(total)
            continue

        # Date detection + range. Collect the normalized ISO strings.
        iso_values: list[str] = []
        for v in non_null:
            if _try_date(v):
                normalized = normalize_cell(v)
                if isinstance(normalized, str):
                    iso_values.append(normalized)
        if len(iso_values) / len(non_null) >= _TYPE_THRESHOLD and iso_values:
            date_ranges[column] = {"min": min(iso_values), "max": max(iso_values)}

    totals: dict[str, Any] = {
        "row_count": row_count,
        "column_count": len(columns),
        "numeric_sums": numeric_sums,
        "date_ranges": date_ranges,
        "null_counts": null_counts,
    }

    resolved: str | None = None
    if bucket_column is not None:
        resolved = normalize_header(bucket_column)
        if resolved not in bucket_candidates:
            raise ValueError(
                f"bucket column {resolved!r} does not qualify: fewer than 90% of "
                "its non-null values are dates or ISO-shaped date strings"
            )
    elif len(bucket_candidates) == 1:
        resolved = bucket_candidates[0]

    if resolved is not None:
        totals["bucket_column"] = resolved
        totals["period_buckets"] = _period_buckets(
            norm_records, resolved, columns, list(numeric_sums)
        )

    return totals


def _dict_at(totals: dict[str, Any], key: str) -> dict[str, Any]:
    """A column-keyed map from totals, tolerating absent or non-dict values."""
    value = totals.get(key)
    return value if isinstance(value, dict) else {}


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def structured_totals_delta(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Structured, machine-readable delta between two control totals.

    Feeds `receipts diff` (--json and the human report). Only keys that
    CHANGED appear; an empty dict means no movement. Shape:

      row_count / column_count: {"before", "after", "delta"?}
      numeric_sums:  {col: {"before", "after", "delta"?}}  (absent side: None)
      null_counts:   {col: {"before", "after", "delta"}}   (absent side: 0)
      date_ranges:   {col: {"before": {min,max} | None, "after": ...}}
      period_buckets_changed: [bucket keys whose totals moved]

    The existing totals_delta() strings stay untouched (they feed verify's
    red report and the documented JSON). Key insertion order is fixed and
    mirrored by node/totals.js structuredTotalsDelta, so serialized output
    matches across stacks. Totals in receipt JSON are attacker-controlled:
    unparseable sums report before/after without a computed delta, never a
    crash.
    """
    delta: dict[str, Any] = {}

    for key in ("row_count", "column_count"):
        before = a.get(key)
        after = b.get(key)
        if before != after:
            entry: dict[str, Any] = {"before": before, "after": after}
            if _is_int(before) and _is_int(after):
                entry["delta"] = after - before
            delta[key] = entry

    up_sums = _dict_at(a, "numeric_sums")
    down_sums = _dict_at(b, "numeric_sums")
    sums: dict[str, Any] = {}
    for column in sorted(set(up_sums) | set(down_sums)):
        before = up_sums.get(column)
        after = down_sums.get(column)
        if before == after:
            continue
        entry = {"before": before, "after": after}
        if isinstance(before, str) and isinstance(after, str):
            try:
                entry["delta"] = decimal_to_plain_string(Decimal(after) - Decimal(before))
            except InvalidOperation:
                pass
        sums[column] = entry
    if sums:
        delta["numeric_sums"] = sums

    up_nulls = _dict_at(a, "null_counts")
    down_nulls = _dict_at(b, "null_counts")
    nulls: dict[str, Any] = {}
    for column in sorted(set(up_nulls) | set(down_nulls)):
        before = up_nulls.get(column, 0)
        after = down_nulls.get(column, 0)
        if before == after:
            continue
        entry = {"before": before, "after": after}
        if _is_int(before) and _is_int(after):
            entry["delta"] = after - before
        nulls[column] = entry
    if nulls:
        delta["null_counts"] = nulls

    up_ranges = _dict_at(a, "date_ranges")
    down_ranges = _dict_at(b, "date_ranges")
    ranges: dict[str, Any] = {}
    for column in sorted(set(up_ranges) | set(down_ranges)):
        before = up_ranges.get(column)
        after = down_ranges.get(column)
        if before != after:
            ranges[column] = {
                "before": before if isinstance(before, dict) else None,
                "after": after if isinstance(after, dict) else None,
            }
    if ranges:
        delta["date_ranges"] = ranges

    up_buckets = a.get("period_buckets")
    down_buckets = b.get("period_buckets")
    if isinstance(up_buckets, dict) or isinstance(down_buckets, dict):
        up_buckets = up_buckets if isinstance(up_buckets, dict) else {}
        down_buckets = down_buckets if isinstance(down_buckets, dict) else {}
        moved = sorted(
            key
            for key in set(up_buckets) | set(down_buckets)
            if up_buckets.get(key) != down_buckets.get(key)
        )
        if moved:
            delta["period_buckets_changed"] = moved

    return delta


def totals_delta(upstream: dict[str, Any], downstream: dict[str, Any]) -> list[str]:
    """Human-legible lines describing only what changed between two totals.

    Used by `verify` to print the diagnosability line. Compares row_count,
    column_count, numeric_sums and null_counts; emits one line per change.
    """
    lines: list[str] = []

    up_rows = upstream.get("row_count", 0)
    down_rows = downstream.get("row_count", 0)
    if up_rows != down_rows:
        diff = down_rows - up_rows
        lines.append(f"row_count {up_rows} -> {down_rows} ({diff:+d})")

    up_cols = upstream.get("column_count", 0)
    down_cols = downstream.get("column_count", 0)
    if up_cols != down_cols:
        diff = down_cols - up_cols
        lines.append(f"column_count {up_cols} -> {down_cols} ({diff:+d})")

    up_sums = upstream.get("numeric_sums", {})
    down_sums = downstream.get("numeric_sums", {})
    for column in sorted(set(up_sums) | set(down_sums)):
        before = up_sums.get(column)
        after = down_sums.get(column)
        if before != after:
            if before is not None and after is not None:
                try:
                    diff = Decimal(after) - Decimal(before)
                    lines.append(
                        f"{column} {before} -> {after} ({decimal_to_plain_string(diff)})"
                    )
                except InvalidOperation:
                    # Sums in receipt JSON are attacker-controlled; if either
                    # side is not a valid decimal, still report before/after but
                    # omit the computed diff rather than crashing `verify`.
                    lines.append(f"{column} {before} -> {after}")
            elif after is None:
                lines.append(f"{column} {before} -> (removed)")
            else:
                lines.append(f"{column} (added) -> {after}")

    up_nulls = upstream.get("null_counts", {})
    down_nulls = downstream.get("null_counts", {})
    for column in sorted(set(up_nulls) | set(down_nulls)):
        before = up_nulls.get(column, 0)
        after = down_nulls.get(column, 0)
        if before != after:
            lines.append(f"null_counts[{column}] {before} -> {after} ({after - before:+d})")

    return lines
