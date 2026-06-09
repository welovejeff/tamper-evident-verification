"""Command-line entry points for lineage-receipts.

Commands:
  lineage keygen --out keys/
  lineage ingest <file.xlsx> --origin "..." --key keys/signing.key --out receipts/
  lineage verify receipts/chain.json --pub keys/signing.pub [--data <current.xlsx>]
  lineage demo
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .canonical import (
    evidence_hash,
    load_xlsx,
    semantic_hash,
)
from .keys import generate_keys, load_private_key, load_public_key_hex, public_hex_from_private
from .receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    read_chain,
    read_receipt,
    verify_chain,
    write_chain,
    write_receipt,
)
from .totals import control_totals


def cmd_keygen(args: argparse.Namespace) -> int:
    private_path, public_path = generate_keys(args.out)
    print(f"Public key written to {public_path}")
    # Warning goes to stderr so it is not swallowed by output redirection.
    print(
        f"Private key written to {private_path}. Do not commit it.",
        file=sys.stderr,
    )
    return 0


def cmd_ingest(args: argparse.Namespace) -> int:
    source_path = Path(args.file)
    raw = source_path.read_bytes()
    records = load_xlsx(str(source_path), sheet=args.sheet)

    private_key = load_private_key(args.key)
    public_hex = public_hex_from_private(private_key)

    manifest = build_source_manifest(
        filename=source_path.name,
        evidence_hash=evidence_hash(raw),
        byte_size=len(raw),
        declared_origin=args.origin,
        semantic_hash=semantic_hash(records),
        records=records,
        private_key=private_key,
    )
    write_receipt(args.out, SOURCE_RECEIPT_NAME, manifest)
    write_chain(args.out, [SOURCE_RECEIPT_NAME], public_hex)

    totals = manifest["control_totals"]
    print(f"Ingested {source_path.name}")
    print(f"  evidence_hash {manifest['source']['evidence_hash']}")
    print(f"  semantic_hash {manifest['semantic_hash']}")
    print(f"  rows {totals['row_count']}, columns {totals['column_count']}")
    print(f"  source manifest -> {Path(args.out) / SOURCE_RECEIPT_NAME}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    chain = read_chain(args.chain)
    chain_dir = str(Path(args.chain).parent)
    # Load exactly the receipts named in the chain file the user pointed at,
    # rather than re-reading chain_dir/chain.json, so verify validates the set
    # the user asked for. Fail cleanly if any receipt cannot be loaded.
    try:
        receipts = [read_receipt(chain_dir, name) for name in chain.get("receipts", [])]
    except ValueError as exc:
        print(f"Cannot load chain: {exc}", file=sys.stderr)
        return 1

    # Public key precedence: explicit --pub, else the key embedded in chain.json.
    public_hex = load_public_key_hex(args.pub) if args.pub else chain.get("public_key")
    if not public_hex:
        print("No public key: pass --pub or embed one in chain.json", file=sys.stderr)
        return 1

    data_hash = None
    data_totals = None
    if args.data:
        records = load_xlsx(args.data, sheet=args.sheet)
        data_hash = semantic_hash(records)
        data_totals = control_totals(records)

    result = verify_chain(receipts, public_hex, data_hash, data_totals)
    for line in result.lines:
        print(line)
    return 0 if result.ok else 1


def cmd_demo(args: argparse.Namespace) -> int:
    from .demo import run_demo

    return run_demo(serve=not args.no_serve, port=args.port)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lineage",
        description="Signed data lineage receipts for analytics pipelines.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_keygen = sub.add_parser("keygen", help="Generate an Ed25519 signing keypair")
    p_keygen.add_argument("--out", default="keys/", help="Output directory")
    p_keygen.set_defaults(func=cmd_keygen)

    p_ingest = sub.add_parser("ingest", help="Create a signed source manifest")
    p_ingest.add_argument("file", help="Source .xlsx file")
    p_ingest.add_argument("--origin", default="", help="Free-text declared origin")
    p_ingest.add_argument("--key", default="keys/signing.key", help="Private key path")
    p_ingest.add_argument("--out", default="receipts/", help="Receipts directory")
    p_ingest.add_argument("--sheet", default=None, help="Worksheet name (optional)")
    p_ingest.set_defaults(func=cmd_ingest)

    p_verify = sub.add_parser("verify", help="Verify a receipt chain")
    p_verify.add_argument("chain", help="Path to chain.json")
    p_verify.add_argument("--pub", default=None, help="Public key (.pub) path")
    p_verify.add_argument("--data", default=None, help="Current data file to check")
    p_verify.add_argument("--sheet", default=None, help="Worksheet name (optional)")
    p_verify.set_defaults(func=cmd_verify)

    p_demo = sub.add_parser("demo", help="Run the full end-to-end demo")
    p_demo.add_argument("--no-serve", action="store_true", help="Skip serving the badge")
    p_demo.add_argument("--port", type=int, default=8000, help="Badge server port")
    p_demo.set_defaults(func=cmd_demo)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
