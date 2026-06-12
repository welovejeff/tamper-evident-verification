"""Per-period bucketed control totals (spec 1.2) and 1.1 backward compat.

Bucketing is a totals-only feature: canonical bytes and semantic hashes must
not move. The frozen chains under tests/fixtures/chains-1.1/ are the last
Python-signed 1.1 chains in existence (the library now mints 1.2), so they
are the backward-compat contract for R19.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from pathlib import Path

import pytest

from tamper_signal.canonical import load_csv, load_xlsx, semantic_hash, write_xlsx
from tamper_signal.receipts import load_receipts, read_chain, verify_chain
from tamper_signal.totals import UNBUCKETED_KEY, control_totals

FIXTURES_1_1 = Path(__file__).parent / "fixtures" / "chains-1.1"


def dated_records() -> list[dict]:
    return [
        {"day": dt.date(2026, 5, 1), "amount": 10.5, "label": "a"},
        {"day": dt.date(2026, 5, 1), "amount": 4.5, "label": "b"},
        {"day": dt.date(2026, 5, 2), "amount": 20, "label": None},
        {"day": dt.date(2026, 5, 3), "amount": 3, "label": "c"},
    ]


# ---------------------------------------------------------------------------
# Cross-format parity
# ---------------------------------------------------------------------------
def test_xlsx_typed_dates_and_csv_iso_strings_bucket_identically(tmp_path):
    xlsx_path = str(tmp_path / "data.xlsx")
    write_xlsx(dated_records(), xlsx_path)
    csv_path = tmp_path / "data.csv"
    csv_path.write_text(
        "day,amount,label\n"
        "2026-05-01,10.5,a\n"
        "2026-05-01,4.5,b\n"
        "2026-05-02,20,\n"
        "2026-05-03,3,c\n",
        encoding="utf-8",
    )

    from_xlsx = load_xlsx(xlsx_path)
    from_csv = load_csv(str(csv_path))
    assert semantic_hash(from_xlsx) == semantic_hash(from_csv)

    xlsx_totals = control_totals(from_xlsx)
    csv_totals = control_totals(from_csv)
    assert xlsx_totals["bucket_column"] == csv_totals["bucket_column"] == "day"
    assert xlsx_totals["period_buckets"] == csv_totals["period_buckets"]
    assert xlsx_totals["period_buckets"]["2026-05-01"] == {
        "row_count": 2,
        "numeric_sums": {"amount": "15"},
        "null_counts": {},
    }
    assert xlsx_totals["period_buckets"]["2026-05-02"]["null_counts"] == {"label": 1}


def test_semantic_hash_unchanged_from_1_1_for_existing_data():
    # The first golden vector's frozen 1.1 hash. Bucketing must not move it.
    records = [
        {"date": dt.date(2026, 5, 3), "campaign_name": "c",
         "impressions": 300, "spend_usd": 30.0, "active": True},
        {"date": dt.date(2026, 5, 1), "campaign_name": "a",
         "impressions": "100", "spend_usd": "10.50", "active": False},
        {"date": dt.date(2026, 5, 2), "campaign_name": None,
         "impressions": 200, "spend_usd": 20.25, "active": None},
    ]
    assert semantic_hash(records) == (
        "64b96900ef4e99d550bc3382dcfc64afb39c26c247835366bd8e0d55107d1c8c"
    )


# ---------------------------------------------------------------------------
# Bucket-column detection
# ---------------------------------------------------------------------------
def test_date_column_under_threshold_produces_no_buckets():
    records = [{"day": dt.date(2026, 5, 1), "amount": i} for i in range(8)]
    records += [{"day": "yesterday", "amount": 8}, {"day": "soon", "amount": 9}]
    totals = control_totals(records)  # 8/10 = 80% < 90%
    assert "bucket_column" not in totals
    assert "period_buckets" not in totals


def test_two_qualifying_columns_need_an_explicit_choice():
    records = [
        {"created": dt.date(2026, 5, 1), "settled": dt.date(2026, 5, 3), "amount": 1},
        {"created": dt.date(2026, 5, 2), "settled": dt.date(2026, 5, 3), "amount": 2},
    ]
    ambiguous = control_totals(records)
    assert "period_buckets" not in ambiguous

    explicit = control_totals(records, bucket_column="created")
    assert explicit["bucket_column"] == "created"
    assert set(explicit["period_buckets"]) == {"2026-05-01", "2026-05-02"}

    # The override is normalized like any header.
    assert control_totals(records, bucket_column="  Created ")["bucket_column"] == "created"

    with pytest.raises(ValueError, match="does not qualify"):
        control_totals(records, bucket_column="amount")


def test_no_date_shaped_column_yields_no_buckets():
    records = [
        {"campaign": "a", "spend": "10.50", "clicks": 3},
        {"campaign": "b", "spend": "4", "clicks": 7},
    ]
    totals = control_totals(records)
    assert "bucket_column" not in totals
    assert "period_buckets" not in totals


# ---------------------------------------------------------------------------
# Bucket keys
# ---------------------------------------------------------------------------
def test_bare_date_and_midnight_datetime_share_a_bucket():
    records = [
        {"day": dt.date(2026, 5, 2), "amount": 1},
        {"day": dt.datetime(2026, 5, 2, 0, 0, 0), "amount": 2},  # naive midnight
        {"day": "2026-05-02 00:00", "amount": 3},  # ISO string midnight
        {"day": dt.datetime(2026, 5, 2, 1, 30,
                            tzinfo=dt.timezone(dt.timedelta(hours=2))), "amount": 4},
    ]
    buckets = control_totals(records)["period_buckets"]
    # The aware 01:30+02:00 timestamp is 2026-05-01T23:30Z, the previous UTC day.
    assert buckets == {
        "2026-05-01": {"row_count": 1, "numeric_sums": {"amount": "4"}, "null_counts": {}},
        "2026-05-02": {"row_count": 3, "numeric_sums": {"amount": "6"}, "null_counts": {}},
    }


def test_null_and_unparseable_rows_land_in_unbucketed():
    records = [{"day": dt.date(2026, 5, 1), "amount": 1} for _ in range(18)]
    records.append({"day": "2026-13-05", "amount": 2})  # shaped, not a real date
    records.append({"day": None, "amount": 3})
    totals = control_totals(records)  # 18/19 non-null date-shaped: qualifies
    assert totals["bucket_column"] == "day"
    unbucketed = totals["period_buckets"][UNBUCKETED_KEY]
    assert unbucketed["row_count"] == 2
    assert unbucketed["numeric_sums"] == {"amount": "5"}
    assert unbucketed["null_counts"] == {"day": 1}


# ---------------------------------------------------------------------------
# Conservation: buckets partition the table
# ---------------------------------------------------------------------------
def test_bucket_totals_sum_to_whole_table_totals():
    records = dated_records() + [{"day": None, "amount": "7.25", "label": ""}]
    totals = control_totals(records)
    buckets = totals["period_buckets"].values()

    assert sum(b["row_count"] for b in buckets) == totals["row_count"]
    for column, table_sum in totals["numeric_sums"].items():
        parts = sum(
            (Decimal(b["numeric_sums"][column]) for b in buckets), Decimal(0)
        )
        assert parts == Decimal(table_sum)
    for column, table_nulls in totals["null_counts"].items():
        parts_nulls = sum(b["null_counts"].get(column, 0) for b in buckets)
        assert parts_nulls == table_nulls


# ---------------------------------------------------------------------------
# Backward compat: frozen 1.1 chains under the 1.2 code (R19)
# ---------------------------------------------------------------------------
def _verify_fixture(name: str):
    chain_dir = FIXTURES_1_1 / name
    chain = read_chain(str(chain_dir / "chain.json"))
    assert chain["spec_version"] == "1.1"  # guard the freeze itself
    return verify_chain(
        load_receipts(str(chain_dir)),
        chain["public_key"],
        chain_public_hex=chain["public_key"],
        receipt_names=chain["receipts"],
    )


def test_frozen_1_1_intact_chain_still_verifies_green():
    result = _verify_fixture("intact")
    assert result.verdict == "green"
    assert result.ok


def test_frozen_1_1_tampered_chain_still_breaks_red():
    result = _verify_fixture("tampered")
    assert result.verdict == "red"
    assert result.broken_link == 2
    assert "spend_usd" in "\n".join(result.lines)


def test_frozen_1_1_gap_chain_still_caveats_yellow():
    result = _verify_fixture("gap")
    assert result.verdict == "yellow"
    assert any("coverage gap" in caveat for caveat in result.caveats)
