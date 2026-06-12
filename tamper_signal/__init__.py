"""Tamper Signal: a signed receipt chain for analytics pipelines.

Each pipeline stage emits a signed receipt containing the hash of its input,
the hash of its code, the hash of its output, and human-legible control totals.
Receipts link because each stage's input hash must equal the prior stage's
output hash. A verifier replays the chain and reports PASS, or FAIL with the
exact broken link.

This proves continuity, not correctness. If the source export is wrong, the
chain faithfully verifies wrong numbers.
"""

# 1.1: numeric-looking text canonicalizes as the number it parses to (cell
# normalization), so format round-trips that stringify numbers keep the
# semantic hash stable. Chains recorded under 1.0 still verify; receipts
# created for the same data before/after this change can differ in semantic
# hash when text cells carry non-canonical numeric forms ("30.00" vs 30.0).
# 1.2: control totals gain optional per-period buckets. When exactly one
# column is date-shaped (>= 90% of its non-null values are typed
# dates/datetimes or ISO-shaped date strings, a bucketing-only rule), totals
# carry "bucket_column" and "period_buckets": per-UTC-day row_count,
# numeric_sums and null_counts, with unbucketable rows under "_unbucketed".
# Canonicalization is unchanged, so semantic hashes do not move; chains
# recorded under 1.0 and 1.1 still verify.
SPEC_VERSION = "1.2"

from .wrapper import receipt_step

__all__ = ["SPEC_VERSION", "receipt_step"]
