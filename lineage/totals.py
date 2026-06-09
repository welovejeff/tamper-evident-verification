"""Control totals.

Computed on canonicalized data and included in every manifest/receipt. Where
the hashes say "broken", the totals say "how broken" (e.g. 22 rows silently
dropped). Kept human-legible. All numeric sums are quantized decimal strings,
never floats.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
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
    """Whether a value normalizes to an ISO date or datetime string."""
    if isinstance(value, (dt.date, dt.datetime)):
        return True
    normalized = normalize_cell(value)
    if not isinstance(normalized, str) or normalized == "":
        return False
    # normalize_cell only emits the two ISO shapes for genuine date/datetimes;
    # string cells that merely look date-like are NOT reparsed here, matching
    # the rule that date detection runs on canonicalized values.
    return False


def control_totals(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute control totals over a list-of-dicts.

    Returns row_count, column_count, numeric_sums, date_ranges, null_counts.
    A column counts as numeric/date when >= 90% of its non-null values parse as
    that type. null_counts lists only columns with at least one null.
    """
    columns = _columns(records)
    row_count = len(records)

    null_counts: dict[str, int] = {}
    numeric_sums: dict[str, str] = {}
    date_ranges: dict[str, dict[str, str]] = {}

    for column in columns:
        non_null: list[Any] = []
        nulls = 0
        for record in records:
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

    return {
        "row_count": row_count,
        "column_count": len(columns),
        "numeric_sums": numeric_sums,
        "date_ranges": date_ranges,
        "null_counts": null_counts,
    }


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
                diff = Decimal(after) - Decimal(before)
                lines.append(
                    f"{column} {before} -> {after} ({decimal_to_plain_string(diff)})"
                )
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
