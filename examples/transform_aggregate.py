"""Sample vibe-coded transform 2: aggregate by channel + date.

Groups the cleaned rows by (channel, date) and sums impressions, clicks and
spend. The output is the dashboard-ready table.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal(0)
    return Decimal(str(value))


def transform_aggregate(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[Any, Any], dict[str, Decimal]] = defaultdict(
        lambda: {"impressions": Decimal(0), "clicks": Decimal(0), "spend_usd": Decimal(0)}
    )
    for record in records:
        key = (record.get("channel"), record.get("date"))
        bucket = groups[key]
        bucket["impressions"] += _to_decimal(record.get("impressions"))
        bucket["clicks"] += _to_decimal(record.get("clicks"))
        bucket["spend_usd"] += _to_decimal(record.get("spend_usd"))

    output: list[dict[str, Any]] = []
    for (channel, date), sums in groups.items():
        output.append(
            {
                "channel": channel,
                "date": date,
                "impressions": int(sums["impressions"]),
                "clicks": int(sums["clicks"]),
                "spend_usd": float(sums["spend_usd"]),
            }
        )
    return output
