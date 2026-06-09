"""Sample vibe-coded transform 1: clean the raw export.

Drops rows with a null campaign_name and coerces text-numbers to real numbers.
Dropping rows is the point: the totals delta between receipt 0 and receipt 1
visibly shows the silent row drop. That is a feature, not a bug, and is exactly
the kind of thing the receipt chain is meant to surface.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

NUMERIC_COLUMNS = ("impressions", "clicks", "spend_usd")


def _coerce_number(value: Any) -> Any:
    """Turn a text-number into an int/float; leave real numbers untouched."""
    if isinstance(value, str):
        text = value.strip()
        try:
            number = Decimal(text)
        except InvalidOperation:
            return value
        # Integers stay ints, fractional values become floats.
        return int(number) if number == number.to_integral_value() else float(number)
    return value


def transform_clean(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for record in records:
        campaign = record.get("campaign_name")
        if campaign is None or (isinstance(campaign, str) and campaign.strip() == ""):
            continue  # drop rows with no campaign name
        new_record = dict(record)
        for column in NUMERIC_COLUMNS:
            if column in new_record:
                new_record[column] = _coerce_number(new_record[column])
        cleaned.append(new_record)
    return cleaned
