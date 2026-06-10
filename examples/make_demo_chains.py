"""Generate the committed demo chains under examples/chains/.

The GitHub Pages landing page (and anything else that needs a receipt chain
without running `lineage demo` first) verifies these in the browser:

    examples/chains/intact/    the clean three-receipt chain (green)
    examples/chains/tampered/  the same chain with link 1 -> 2 broken (red)

The signing keypair is created in a temp directory and discarded; receipts are
public by design and the chain embeds the public key, so verification needs no
key material from this repo. Yellow needs no third chain: pages demo it by
trusting a key that is not the chain's embedded key.

Run from the repo root: python examples/make_demo_chains.py
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from make_sample_export import make as make_sample
from transform_clean import transform_clean
from transform_aggregate import transform_aggregate

from lineage.canonical import evidence_hash, load_xlsx, semantic_hash
from lineage.demo import _write_tampered_chain_to
from lineage.keys import generate_keys, load_private_key, public_hex_from_private
from lineage.receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    load_receipts,
    verify_chain,
    write_chain,
    write_receipt,
)
from lineage.wrapper import lineage_step

INTACT_DIR = "examples/chains/intact"
TAMPERED_DIR = "examples/chains/tampered"


def main() -> int:
    for path in (INTACT_DIR, TAMPERED_DIR):
        shutil.rmtree(path, ignore_errors=True)

    with tempfile.TemporaryDirectory() as tmp:
        key_dir = f"{tmp}/keys"
        sample = f"{tmp}/sample_export.xlsx"
        generate_keys(key_dir)
        private_key = load_private_key(f"{key_dir}/signing.key")
        public_hex = public_hex_from_private(private_key)

        make_sample(sample)
        raw = Path(sample).read_bytes()
        records = load_xlsx(sample)
        manifest = build_source_manifest(
            filename="sample_export.xlsx",
            evidence_hash=evidence_hash(raw),
            byte_size=len(raw),
            declared_origin="Sample social export, May 2026",
            semantic_hash=semantic_hash(records),
            records=records,
            private_key=private_key,
        )
        write_receipt(INTACT_DIR, SOURCE_RECEIPT_NAME, manifest)
        write_chain(INTACT_DIR, [SOURCE_RECEIPT_NAME], public_hex)

        @lineage_step(chain_dir=INTACT_DIR, key_path=f"{key_dir}/signing.key",
                      code_file="examples/transform_clean.py")
        def clean(rows):
            return transform_clean(rows)

        @lineage_step(chain_dir=INTACT_DIR, key_path=f"{key_dir}/signing.key",
                      code_file="examples/transform_aggregate.py")
        def aggregate(rows):
            return transform_aggregate(rows)

        aggregate(clean(records))

        result = verify_chain(load_receipts(INTACT_DIR), public_hex)
        assert result.verdict == "green", result.lines
        print(f"{INTACT_DIR}: {result.lines[0]}")

        _write_tampered_chain_to(INTACT_DIR, TAMPERED_DIR, private_key, public_hex)
        broken = verify_chain(load_receipts(TAMPERED_DIR), public_hex)
        assert broken.verdict == "red", broken.lines
        print(f"{TAMPERED_DIR}: {broken.lines[0]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
