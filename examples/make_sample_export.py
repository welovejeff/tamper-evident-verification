"""Generate sample_export.xlsx: ~5,000 rows of fake social data.

Deliberately messy so the demo has something to catch:
- a few null campaign names
- mixed date formats (real dates and date strings)
- ~1% of numeric cells stored as text

Seeded RNG so the output (and therefore every downstream hash) is reproducible.
"""

from __future__ import annotations

import datetime as dt
import random
from pathlib import Path

from openpyxl import Workbook

ROWS = 5000
SEED = 20260501

CHANNELS = ["facebook", "instagram", "tiktok", "youtube", "linkedin"]
CAMPAIGNS = [
    "spring_launch",
    "always_on",
    "retargeting_q2",
    "brand_awareness",
    "creator_collab",
]


def build_rows() -> list[list[object]]:
    rng = random.Random(SEED)
    start = dt.date(2026, 5, 1)
    header = ["date", "campaign_name", "channel", "impressions", "clicks", "spend_usd"]
    rows: list[list[object]] = [header]

    for i in range(ROWS):
        day = start + dt.timedelta(days=rng.randint(0, 30))

        # Mixed date formats: most as real dates, ~10% as ISO strings.
        if rng.random() < 0.10:
            date_cell: object = day.isoformat()
        else:
            date_cell = day

        # A few null campaign names (~0.2%).
        if rng.random() < 0.002:
            campaign: object = None
        else:
            campaign = rng.choice(CAMPAIGNS)

        channel = rng.choice(CHANNELS)
        impressions = rng.randint(500, 50000)
        clicks = rng.randint(0, impressions // 10)
        spend = round(rng.uniform(5.0, 800.0), 2)

        # ~1% of numeric cells stored as text.
        impressions_cell: object = str(impressions) if rng.random() < 0.01 else impressions
        clicks_cell: object = str(clicks) if rng.random() < 0.01 else clicks
        spend_cell: object = f"{spend:.2f}" if rng.random() < 0.01 else spend

        rows.append([date_cell, campaign, channel, impressions_cell, clicks_cell, spend_cell])

    return rows


def make(path: str = "examples/sample_export.xlsx") -> str:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "export"
    for row in build_rows():
        worksheet.append(row)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    workbook.save(path)
    return path


if __name__ == "__main__":
    out = make()
    print(f"Wrote {out}")
