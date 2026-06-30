"""The watch tick (plan U3): poll a live source once, judge a candidate under a
stable synthetic identity, and either auto-append clean data or withhold a
caveat-bearing change. Stateless by design — the recommended deployment runs
this under a systemd timer / cron, so the signing key is not resident between
ticks (KTD9).

The tick reuses the whole file-ingest canonicalization path: mapped feed records
are serialized to a throwaway LF CSV and handed to `judge_candidate_period`, so
a feed's `"30.00"` hashes exactly as a CSV's would (KTD7). The judge runs before
any write; only a clean, caveat-free judgment commits (KTD2).
"""

from __future__ import annotations

import csv
import io
import tempfile
from pathlib import Path
from typing import Any, Callable

from .receipts import SOURCE_RECEIPT_NAME, read_receipt
from .wrapper import commit_period, judge_candidate_period

# The notice judge_cross_run emits when no prior snapshot matches the current
# source identity. On the first tick (no history) it is benign; once history
# exists it means the identity drifted and judgment was silently skipped — the
# exact R13/R14 silent-no-op KTD11 forbids, so the watcher treats it as fatal.
_IDENTITY_SKIPPED = "cross-run judgment skipped: source identity differs from history"


class WatchIdentityError(RuntimeError):
    """A tick's source identity did not match history, so judgment was skipped.
    Raised rather than appending an unjudged change to a still-green chain."""


def records_to_csv(records: list[dict[str, Any]]) -> str:
    """Serialize mapped feed records to CSV text with LF line endings and a
    stable column order (first-seen union of keys), so the watcher can reuse the
    file-ingest canonicalization path. LF matters: the receipt byte-hash is
    line-ending sensitive (KTD7)."""
    if not records:
        return ""
    columns: list[str] = []
    for record in records:
        for key in record:
            if key not in columns:
                columns.append(key)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for record in records:
        writer.writerow({column: record.get(column, "") for column in columns})
    return buffer.getvalue()


def _new_period_count(candidate_manifest: dict[str, Any], chain_dir: str) -> int:
    """How many new periods this candidate introduces vs the committed source —
    the quantity a per-tick cap bounds. Counts period buckets the candidate has
    that the prior source manifest lacked; with no bucket column, falls back to
    row-count growth."""
    try:
        prior = read_receipt(chain_dir, SOURCE_RECEIPT_NAME)
    except (ValueError, OSError):
        return 0
    prior_totals = prior.get("control_totals") or {}
    cand_totals = candidate_manifest.get("control_totals") or {}
    prior_buckets = set((prior_totals.get("period_buckets") or {}))
    cand_buckets = set((cand_totals.get("period_buckets") or {}))
    if cand_buckets or prior_buckets:
        return len(cand_buckets - prior_buckets)
    prior_rows = prior_totals.get("row_count") or 0
    cand_rows = cand_totals.get("row_count") or 0
    return max(0, cand_rows - prior_rows)


def run_tick(
    records: list[dict[str, Any]],
    *,
    source_id: str,
    origin: str | None = None,
    chain_dir: str = "receipts/",
    key_path: str = "keys/signing.key",
    trusted_pub_hexes: tuple[str, ...] | list[str] = (),
    band: str | None = None,
    settle: str | None = None,
    bucket_column: str | None = None,
    per_tick_cap: int | None = None,
    on_withhold: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """One stateless watch tick over already-fetched, already-mapped records.

    `source_id` is the STABLE synthetic identity (constant across ticks) so
    judgment engages (KTD11); `origin` is the human attribution string (the URL
    or label) recorded in the signed manifest (KTD8) — defaults to `source_id`.

    Decision order (writes nothing until the final commit):
      - data identical to the committed source -> ``unchanged``
      - history exists but identity didn't match -> ``WatchIdentityError`` (KTD11)
      - more than ``per_tick_cap`` new periods -> ``rate_capped`` (volumetric guard)
      - any judgment caveat -> withhold via ``on_withhold`` (KTD2); else ``withheld``
      - clean, caveat-free -> ``commit_period`` -> ``appended``

    An untrusted signing key raises ``UntrustedSignerError`` from the judge
    before any of this (KTD8). Returns a decision dict carrying ``action``.
    """
    csv_text = records_to_csv(records)
    with tempfile.TemporaryDirectory() as tmp:
        feed_file = Path(tmp) / "feed.csv"
        feed_file.write_text(csv_text, encoding="utf-8", newline="")
        candidate, judgment = judge_candidate_period(
            str(feed_file),
            origin=origin or source_id,
            identity=source_id,
            chain_dir=chain_dir,
            key_path=key_path,
            trusted_pub_hexes=trusted_pub_hexes,
            band=band,
            settle=settle,
            bucket_column=bucket_column,
        )

    # No-op gate (KTD12): the data is fingerprinted by its semantic hash and
    # compared to the committed source. A server's 304/ETag never reaches here —
    # the watcher always fetched and judged the real content.
    prior = read_receipt(chain_dir, SOURCE_RECEIPT_NAME)
    if candidate["manifest"]["semantic_hash"] == prior.get("semantic_hash"):
        return {"action": "unchanged", "source_id": source_id}

    # KTD11: a skipped judgment while history exists is an identity mismatch.
    if candidate["compared"] and _IDENTITY_SKIPPED in judgment.get("notices", []):
        raise WatchIdentityError(
            f"watch tick for {source_id!r}: source identity differs from history; "
            "judgment was skipped, refusing to append an unjudged change."
        )

    # Volumetric guard: a feed flooding many new periods at once is capped.
    if per_tick_cap is not None:
        new_periods = _new_period_count(candidate["manifest"], chain_dir)
        if new_periods > per_tick_cap:
            return {
                "action": "rate_capped",
                "source_id": source_id,
                "new_periods": new_periods,
                "cap": per_tick_cap,
            }

    # Gate (KTD2): any caveat withholds; only a clean candidate auto-commits.
    if judgment.get("details"):
        extra = on_withhold(candidate, judgment) if on_withhold is not None else {}
        return {
            "action": "withheld",
            "source_id": source_id,
            "caveats": judgment.get("caveats", []),
            "details": judgment.get("details", []),
            **extra,
        }

    result = commit_period(candidate, judgment, chain_dir=chain_dir, key_path=key_path)
    return {
        "action": "appended",
        "source_id": source_id,
        "source_hash": result["source_hash"],
        "caveats": result["caveats"],
    }
