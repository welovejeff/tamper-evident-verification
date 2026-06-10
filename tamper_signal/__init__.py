"""Tamper Signal: a signed receipt chain for analytics pipelines.

Each pipeline stage emits a signed receipt containing the hash of its input,
the hash of its code, the hash of its output, and human-legible control totals.
Receipts link because each stage's input hash must equal the prior stage's
output hash. A verifier replays the chain and reports PASS, or FAIL with the
exact broken link.

This proves continuity, not correctness. If the source export is wrong, the
chain faithfully verifies wrong numbers.
"""

SPEC_VERSION = "1.0"

from .wrapper import receipt_step

__all__ = ["SPEC_VERSION", "receipt_step"]
