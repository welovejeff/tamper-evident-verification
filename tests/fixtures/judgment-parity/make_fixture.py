"""Regenerate the judgment-parity fixture (run from the repo root).

    python3 tests/fixtures/judgment-parity/make_fixture.py

A Python-signed chain with a tolerance declaration, plus a Python-written run
snapshot of the PRIOR run under history/, arranged so cross-run judgment
deterministically yields one band breach (a settling bucket moved +9%) and
one settled movement (a settled bucket's spend moved +1). All timestamps are
pinned in the past, so the verdict never depends on the test machine's clock.

Both CLIs verify this chain and must emit byte-identical caveat_details JSON
(expected_caveat_details.json, also written by this script from Python's
judge_cross_run): tests/test_judgment.py and node/test/judgment.test.js copy
the fixture to a temp dir (verify writes new snapshots) and compare. The
signing key derives from a fixed seed so regeneration reproduces identical
bytes; rerun this after any change that moves receipt, snapshot, or
caveat_details bytes, in the same commit.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tamper_signal.canonical import evidence_hash, semantic_hash
from tamper_signal.history import (
    build_run_snapshot,
    judge_cross_run,
    write_run_snapshot,
)
from tamper_signal.keys import public_hex_from_private
from tamper_signal.receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    write_chain,
    write_receipt,
)

TOLERANCE = {"band": "0.05", "settle_hours": 72, "bucket_column": "day"}

# The prior run: bucket 2026-05-01 (settled long before the snapshot) sums to
# spend 30; bucket 2026-06-11 (still settling at the snapshot time) is 100.
PRIOR_ROWS = [
    {"day": "2026-05-01", "spend": "10"},
    {"day": "2026-05-01", "spend": "20"},
    {"day": "2026-06-11", "spend": "100"},
]

# The current run: the settled bucket's spend moved 30 -> 31 (settled
# movement, frozen zone) and the settling bucket moved 100 -> 109 (+9%, a
# band breach against the 5% band).
CURRENT_ROWS = [
    {"day": "2026-05-01", "spend": "10"},
    {"day": "2026-05-01", "spend": "21"},
    {"day": "2026-06-11", "spend": "109"},
]


def _manifest(rows, private, created_at):
    raw = ("day,spend\n" + "\n".join(f"{r['day']},{r['spend']}" for r in rows) + "\n").encode(
        "utf-8"
    )
    return build_source_manifest(
        filename="export.csv",
        evidence_hash=evidence_hash(raw),
        byte_size=len(raw),
        declared_origin="judgment parity fixture",
        semantic_hash=semantic_hash(rows),
        records=rows,
        private_key=private,
        created_at=created_at,
        tolerance=TOLERANCE,
        bucket_column="day",
    )


def main() -> None:
    out = Path(__file__).resolve().parent
    for stale in list(out.glob("*.json")) + [out / "history"]:
        if stale.is_dir():
            shutil.rmtree(stale)
        elif stale.exists():
            stale.unlink()

    seed = hashlib.sha256(b"tamper-signal judgment-parity fixture v1").digest()
    private = Ed25519PrivateKey.from_private_bytes(seed)
    public_hex = public_hex_from_private(private)

    # 1) The prior run's chain, archived as a snapshot the way verify would.
    prior = _manifest(PRIOR_ROWS, private, "2026-06-11T00:00:00Z")
    write_receipt(str(out), SOURCE_RECEIPT_NAME, prior)
    write_chain(str(out), [SOURCE_RECEIPT_NAME], public_hex)
    prior_chain = json.loads((out / "chain.json").read_text(encoding="utf-8"))
    snapshot = build_run_snapshot(
        [prior],
        prior_chain,
        key=private,
        chain_dir=str(out),
        created_at="2026-06-11T00:05:00Z",
    )
    write_run_snapshot(str(out), snapshot)

    # 2) The current run's chain overwrites the prior one in place, exactly
    # like a scheduled re-ingest.
    current = _manifest(CURRENT_ROWS, private, "2026-06-12T00:00:00Z")
    write_receipt(str(out), SOURCE_RECEIPT_NAME, current)
    write_chain(str(out), [SOURCE_RECEIPT_NAME], public_hex)
    chain = json.loads((out / "chain.json").read_text(encoding="utf-8"))

    # 3) Pin the expected caveat_details from Python's judgment; the node CLI
    # must reproduce these bytes exactly.
    judgment = judge_cross_run([current], chain, [snapshot])
    expected = {
        "caveats": judgment["caveats"],
        "caveat_details": judgment["details"],
        "breached": judgment["breached"],
    }
    (out / "expected_caveat_details.json").write_text(
        json.dumps(expected, indent=2) + "\n", encoding="utf-8"
    )
    print("caveats:")
    for caveat in judgment["caveats"]:
        print(f"  - {caveat}")
    print(f"public key: {public_hex}")


if __name__ == "__main__":
    main()
