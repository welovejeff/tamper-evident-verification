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
SPEC_VERSION = "1.1"

from .wrapper import receipt_step

__all__ = ["SPEC_VERSION", "receipt_step"]
