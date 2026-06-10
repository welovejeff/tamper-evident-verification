"""Generate the committed demo chains under examples/chains/.

The GitHub Pages landing page (and anything else that needs a receipt chain
without running `receipts demo` first) verifies these in the browser:

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

from tamper_signal.canonical import canonical_document, evidence_hash, load_xlsx, semantic_hash
from tamper_signal.demo import _write_tampered_chain_to
from tamper_signal.keys import generate_keys, load_private_key, public_hex_from_private
from tamper_signal.receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    load_receipts,
    verify_chain,
    write_chain,
    write_receipt,
)
from tamper_signal.wrapper import receipt_step

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

        @receipt_step(chain_dir=INTACT_DIR, key_path=f"{key_dir}/signing.key",
                      code_file="examples/transform_clean.py")
        def clean(rows):
            return transform_clean(rows)

        @receipt_step(chain_dir=INTACT_DIR, key_path=f"{key_dir}/signing.key",
                      code_file="examples/transform_aggregate.py")
        def aggregate(rows):
            return transform_aggregate(rows)

        final = aggregate(clean(records))

        # The verified Data tab fixtures: the canonical table document the
        # browser re-hashes (table.json), plus a one-cell-tampered copy that
        # must render as NOT THE ATTESTED DATA.
        import copy
        import json

        document = canonical_document(final)
        pathlib_write = lambda name, doc: (
            __import__("pathlib").Path(INTACT_DIR, name).write_text(
                json.dumps(doc, indent=2) + "\n", encoding="utf-8"
            )
        )
        pathlib_write("table.json", document)
        tampered_doc = copy.deepcopy(document)
        spend_col = tampered_doc["headers"].index("spend_usd")
        tampered_doc["rows"][0][spend_col] = "999999.99"
        pathlib_write("table-tampered.json", tampered_doc)

        result = verify_chain(load_receipts(INTACT_DIR), public_hex)
        assert result.verdict == "green", result.lines
        print(f"{INTACT_DIR}: {result.lines[0]}")

        _write_tampered_chain_to(INTACT_DIR, TAMPERED_DIR, private_key, public_hex)
        # The tampered dir keeps the same table data; the chain itself is
        # what's broken there. (copytree already carried table.json over.)
        broken = verify_chain(load_receipts(TAMPERED_DIR), public_hex)
        assert broken.verdict == "red", broken.lines
        print(f"{TAMPERED_DIR}: {broken.lines[0]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
