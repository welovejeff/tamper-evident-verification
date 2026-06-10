"""End-to-end demo: keygen -> ingest -> transforms -> verify PASS -> tamper FAIL.

The PASS-then-FAIL console transcript is the acceptance demo. The console FAIL
uses the `verify --data` path (a tampered dashboard file no longer matches the
final receipt). A second, re-signed broken-link chain is written to
receipts_tampered/ so badge.html can render the red state too (the badge
re-checks signatures and hash links, not data).
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from .canonical import (
    canonical_json_bytes,
    evidence_hash,
    load_xlsx,
    semantic_hash,
    write_xlsx,
)
from .keys import (
    generate_keys,
    key_fingerprint,
    load_private_key,
    public_hex_from_private,
    sign,
)
from .receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    load_receipts,
    read_chain,
    read_receipt,
    verify_chain,
    write_chain,
    write_receipt,
)
from .totals import control_totals, totals_delta
from .wrapper import receipt_step

# Demo workspace, all relative to the repo root (the cwd `receipts demo` runs in).
KEYS_DIR = "keys"
RECEIPTS_DIR = "receipts"
TAMPERED_DIR = "receipts_tampered"
DATA_DIR = "demo_data"
SAMPLE = "examples/sample_export.xlsx"
KEY_PATH = f"{KEYS_DIR}/signing.key"
PUB_PATH = f"{KEYS_DIR}/signing.pub"


def _rule(title: str) -> None:
    print("\n" + "=" * 68)
    print(title)
    print("=" * 68)


def run_demo(serve: bool = True, port: int = 8000) -> int:
    # Import the sample generator and transforms from examples/.
    sys.path.insert(0, str(Path("examples").resolve()))
    from make_sample_export import make as make_sample  # type: ignore
    from transform_clean import transform_clean  # type: ignore
    from transform_aggregate import transform_aggregate  # type: ignore

    # Fresh workspace each run so the demo is reproducible.
    for path in (RECEIPTS_DIR, TAMPERED_DIR, DATA_DIR):
        shutil.rmtree(path, ignore_errors=True)

    _rule("1. keygen")
    generate_keys(KEYS_DIR)
    private_key = load_private_key(KEY_PATH)
    public_hex = public_hex_from_private(private_key)
    print(f"Keypair in {KEYS_DIR}/  fingerprint {key_fingerprint(bytes.fromhex(public_hex))}")
    print(f"Private key written to {KEY_PATH}. Do not commit it.", file=sys.stderr)

    _rule("2. generate + ingest sample export")
    make_sample(SAMPLE)
    raw = Path(SAMPLE).read_bytes()
    source_records = load_xlsx(SAMPLE)
    manifest = build_source_manifest(
        filename=Path(SAMPLE).name,
        evidence_hash=evidence_hash(raw),
        byte_size=len(raw),
        declared_origin="Sample social export, May 2026",
        semantic_hash=semantic_hash(source_records),
        records=source_records,
        private_key=private_key,
    )
    write_receipt(RECEIPTS_DIR, SOURCE_RECEIPT_NAME, manifest)
    write_chain(RECEIPTS_DIR, [SOURCE_RECEIPT_NAME], public_hex)
    print(f"Ingested {Path(SAMPLE).name}: {manifest['control_totals']['row_count']} rows")
    print(f"  semantic_hash {manifest['semantic_hash']}")

    _rule("3. run transforms through @receipt_step")

    @receipt_step(chain_dir=RECEIPTS_DIR, key_path=KEY_PATH, code_file="examples/transform_clean.py")
    def clean(records):
        return transform_clean(records)

    @receipt_step(chain_dir=RECEIPTS_DIR, key_path=KEY_PATH, code_file="examples/transform_aggregate.py")
    def aggregate(records):
        return transform_aggregate(records)

    clean_out = clean(source_records)
    write_xlsx(clean_out, f"{DATA_DIR}/clean.xlsx")
    print(f"transform_clean    -> {len(clean_out)} rows")
    # Make the silent row drop visible: delta between the source manifest and
    # the clean receipt. This is the narrative point of the demo.
    source_to_clean = load_receipts(RECEIPTS_DIR)
    from .receipts import totals_of as _totals_of

    drop = totals_delta(_totals_of(source_to_clean[0]), _totals_of(source_to_clean[1]))
    if drop:
        print("  receipt caught the change vs source: " + ", ".join(drop))

    dashboard = aggregate(clean_out)
    dashboard_path = f"{DATA_DIR}/dashboard.xlsx"
    write_xlsx(dashboard, dashboard_path)
    print(f"transform_aggregate -> {len(dashboard)} rows  ({dashboard_path})")

    _rule("4. verify (expect PASS)")
    receipts = load_receipts(RECEIPTS_DIR)
    data_records = load_xlsx(dashboard_path)
    result = verify_chain(
        receipts, public_hex, semantic_hash(data_records), control_totals(data_records)
    )
    for line in result.lines:
        print(line)
    assert result.ok, "demo invariant: clean chain must verify"

    _rule("5. tamper the dashboard, re-verify (expect FAIL)")
    tampered = [dict(r) for r in data_records]
    target = tampered[0]
    before = target.get("spend_usd")
    target["spend_usd"] = float(before) - 98.40 if before is not None else -98.40
    tampered_path = f"{DATA_DIR}/dashboard_tampered.xlsx"
    write_xlsx(tampered, tampered_path)
    print(f"Edited one spend_usd in {tampered_path}: {before} -> {target['spend_usd']}\n")
    tampered_records = load_xlsx(tampered_path)
    fail = verify_chain(
        receipts,
        public_hex,
        semantic_hash(tampered_records),
        control_totals(tampered_records),
    )
    for line in fail.lines:
        print(line)
    assert not fail.ok, "demo invariant: tampered data must fail"

    # Also write a re-signed broken-link chain so the badge can show red.
    _write_tampered_chain(private_key, public_hex)

    print(f"\nExit code from the failing verify would be 1.")

    if serve:
        _serve_badge(port)
    return 0


def _write_tampered_chain_to(src_dir: str, dst_dir: str, private_key, public_hex: str) -> None:
    """Copy an intact chain, then break link 1->2 by re-signing receipt 001.

    Receipt 001's output hash and totals are altered (as if its output were
    tampered) and the receipt is re-signed so its signature still verifies. The
    badge then reports a broken link, not an invalid signature, and the expanded
    view shows the totals delta.
    """
    shutil.copytree(src_dir, dst_dir)
    files = read_chain(f"{dst_dir}/chain.json")["receipts"]
    # The first transform receipt is index 1 in the chain.
    target_name = files[1]
    receipt = read_receipt(dst_dir, target_name)

    # Pretend its output was tampered: nudge a numeric sum and the output hash.
    sums = receipt["output_control_totals"]["numeric_sums"]
    if "spend_usd" in sums:
        from decimal import Decimal

        sums["spend_usd"] = str(Decimal(sums["spend_usd"]) - Decimal("98.40"))
    receipt["output_semantic_hash"] = "0" * 64

    body = {k: v for k, v in receipt.items() if k != "signature"}
    receipt["signature"] = {
        "alg": "ed25519",
        "key_fingerprint": key_fingerprint(bytes.fromhex(public_hex)),
        "value": sign(private_key, canonical_json_bytes(body)),
    }
    write_receipt(dst_dir, target_name, receipt)


def _write_tampered_chain(private_key, public_hex: str) -> None:
    _write_tampered_chain_to(RECEIPTS_DIR, TAMPERED_DIR, private_key, public_hex)
    print(f"Wrote {TAMPERED_DIR}/ with a broken link for the badge red state.")


def _serve_badge(port: int) -> None:
    """Serve the repo root so badge.html can fetch the receipts directories."""
    import http.server
    import socketserver

    url = f"http://localhost:{port}/badge/badge.html"
    print(f"\nServing badge at {url}")
    print(f"Inline status light demo at http://localhost:{port}/badge/light.html")
    print("Press Ctrl+C to stop.")
    handler = http.server.SimpleHTTPRequestHandler
    try:
        # Bind to localhost only: this serves the whole repo directory
        # (including generated receipts), so it should not be reachable from
        # other machines on the network.
        with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
