"""Regenerate the snapshot-parity fixture (run from the repo root).

    python3 tests/fixtures/snapshot-parity/make_fixture.py

A tiny Python-signed chain (source + one transform) with a tolerance
declaration, plus the run snapshot Python archives for it under history/.
Node tests (node/test/history.test.js) rebuild the snapshot body from the
same chain and must produce byte-identical canonical bytes, the same content
address, and a verifying signature; Python tests load and verify the same
files. The signing key derives from a fixed seed so regeneration reproduces
identical bytes; rerun this after any spec bump that moves receipt or
snapshot bodies, in the same commit (see docs/solutions/logic-errors/
numeric-text-canonicalization-cross-format-hash-mismatch.md).
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
from tamper_signal.history import build_run_snapshot, write_run_snapshot
from tamper_signal.keys import public_hex_from_private
from tamper_signal.receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    build_transform_receipt,
    write_chain,
    write_receipt,
)


def main() -> None:
    out = Path(__file__).resolve().parent
    for stale in list(out.glob("*.json")) + [out / "history"]:
        if stale.is_dir():
            shutil.rmtree(stale)
        elif stale.exists():
            stale.unlink()

    seed = hashlib.sha256(b"tamper-signal snapshot-parity fixture v1").digest()
    private = Ed25519PrivateKey.from_private_bytes(seed)
    public_hex = public_hex_from_private(private)

    rows = [
        {"day": "2026-05-01", "campaign": "a", "spend": "10.5"},
        {"day": "2026-05-01", "campaign": "b", "spend": "4.5"},
        {"day": "2026-05-02", "campaign": "a", "spend": "20"},
        {"day": "2026-05-02", "campaign": "", "spend": "1"},
    ]
    raw = (
        "day,campaign,spend\n" + "\n".join(",".join(r.values()) for r in rows) + "\n"
    ).encode("utf-8")

    manifest = build_source_manifest(
        filename="export.csv",
        evidence_hash=evidence_hash(raw),
        byte_size=len(raw),
        declared_origin="snapshot parity fixture",
        semantic_hash=semantic_hash(rows),
        records=rows,
        private_key=private,
        created_at="2026-06-12T00:00:00Z",
        tolerance={"band": "0.05", "settle_hours": 72, "bucket_column": "day"},
        bucket_column="day",
    )
    cleaned = [r for r in rows if r["campaign"]]
    receipt = build_transform_receipt(
        name="clean",
        code_hash=hashlib.sha256(b"def clean(rows): ...").hexdigest(),
        code_file="pipeline.py",
        input_semantic_hash=semantic_hash(rows),
        output_semantic_hash=semantic_hash(cleaned),
        output_records=cleaned,
        private_key=private,
        created_at="2026-06-12T00:01:00Z",
    )
    write_receipt(str(out), SOURCE_RECEIPT_NAME, manifest)
    write_receipt(str(out), "001_clean.json", receipt)
    write_chain(str(out), [SOURCE_RECEIPT_NAME, "001_clean.json"], public_hex)

    chain = json.loads((out / "chain.json").read_text(encoding="utf-8"))
    snapshot = build_run_snapshot(
        [manifest, receipt],
        chain,
        key=private,
        chain_dir=str(out),
        created_at="2026-06-12T00:05:00Z",
    )
    path = write_run_snapshot(str(out), snapshot)
    print(f"fixture written: {path.name}")
    print(f"public key: {public_hex}")


if __name__ == "__main__":
    main()
