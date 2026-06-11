"""Command-line entry points for Tamper Signal.

Commands:
  receipts keygen --out keys/
  receipts ingest <file.xlsx> --origin "..." --key keys/signing.key --out receipts/
  receipts verify receipts/chain.json --pub keys/signing.pub [--data <current.xlsx>] [--json]
  receipts init
  receipts doctor [--url http://localhost:8787/chain.json]
  receipts serve
  receipts demo
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .canonical import (
    evidence_hash,
    load_records,
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
    records = load_records(str(source_path), sheet=args.sheet)

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

    # Public key precedence: explicit --pub (repeatable, for key rotation),
    # else the key embedded in chain.json.
    chain_key = chain.get("public_key")
    public_hex: str | list[str] | None
    if args.pub:
        public_hex = [load_public_key_hex(path) for path in args.pub]
    else:
        public_hex = chain_key
    if not public_hex:
        print("No public key: pass --pub or embed one in chain.json", file=sys.stderr)
        return 1

    data_hash = None
    data_totals = None
    if args.data:
        records = load_records(args.data, sheet=args.sheet)
        data_hash = semantic_hash(records)
        data_totals = control_totals(records)

    result = verify_chain(
        receipts,
        public_hex,
        data_hash,
        data_totals,
        chain_public_hex=chain_key,
        receipt_names=chain.get("receipts", []),
        warn_drift=args.warn_drift,
    )
    # Exit codes are the traffic light: 0 green, 1 red, 2 yellow.
    code = {"green": 0, "red": 1, "yellow": 2}[result.verdict]
    if args.json:
        import json as _json

        from .receipts import stage_name_of, totals_of

        payload = {
            "verdict": result.verdict,
            "exit_code": code,
            "spec_version": chain.get("spec_version"),
            "receipts": len(receipts),
            "transforms": sum(
                1 for r in receipts if isinstance(r, dict) and r.get("kind") == "transform_receipt"
            ),
            "stages": [stage_name_of(r) for r in receipts],
            "final_row_count": (totals_of(receipts[-1]).get("row_count") if receipts else None),
            "caveats": result.caveats,
            "broken_link": result.broken_link_detail,
            "data_mismatch": result.data_mismatch,
            "report": result.lines,
        }
        if args.anchor:
            anchor_lines: list[str] = []
            code = _check_anchor(args, code, anchor_lines.append)
            payload["anchor"] = anchor_lines
            payload["exit_code"] = code
        print(_json.dumps(payload, indent=2))
    else:
        for line in result.lines:
            print(line)
        if args.anchor:
            code = _check_anchor(args, code, print)
    return code


GITIGNORE_LINES = ["keys/", "*.key"]


def cmd_init(args: argparse.Namespace) -> int:
    """Idempotent project scaffold: keys, .gitignore safety, receipts dir."""
    from .keys import PRIVATE_KEY_NAME, generate_keys

    actions: list[str] = []
    key_dir = Path(args.keys)
    private_path = key_dir / PRIVATE_KEY_NAME
    if private_path.exists():
        actions.append(f"keys: {private_path} already exists (left untouched)")
    else:
        _, public_path = generate_keys(str(key_dir))
        actions.append(f"keys: generated {private_path} and {public_path}")

    gitignore = Path(".gitignore")
    existing = gitignore.read_text(encoding="utf-8").splitlines() if gitignore.exists() else []
    missing = [line for line in GITIGNORE_LINES if line not in existing]
    if missing:
        block = existing + ["", "# Tamper Signal: never commit private key material"] + missing \
            if existing else ["# Tamper Signal: never commit private key material"] + missing
        gitignore.write_text("\n".join(block) + "\n", encoding="utf-8")
        actions.append(f".gitignore: added {', '.join(missing)}")
    else:
        actions.append(".gitignore: already covers keys/ and *.key")

    receipts_dir = Path(args.receipts)
    if receipts_dir.exists():
        actions.append(f"receipts: {receipts_dir}/ already exists")
    else:
        receipts_dir.mkdir(parents=True)
        actions.append(f"receipts: created {receipts_dir}/")

    for action in actions:
        print(f"  - {action}")
    print(
        "\nNext: receipts ingest <export-file> --origin \"...\" "
        f"--key {private_path} --out {receipts_dir}/"
    )
    print("Then wrap each transform with @receipt_step (see AGENTS.md).")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """Integration self-check with actionable fixes. Exit 1 on any failure."""
    import subprocess
    import sys as _sys

    checks: list[tuple[str, bool, str]] = []  # (message, ok, fix)
    warns: list[str] = []

    version_ok = _sys.version_info >= (3, 11)
    checks.append(
        (
            f"python {_sys.version_info.major}.{_sys.version_info.minor}",
            version_ok,
            "Tamper Signal needs Python 3.11+",
        )
    )

    key_path = Path(args.key)
    checks.append(
        (
            f"private key at {key_path}",
            key_path.exists(),
            "run `receipts init` (or `receipts keygen --out keys/`)",
        )
    )

    if key_path.exists():
        try:
            tracked = (
                subprocess.run(
                    ["git", "ls-files", "--error-unmatch", str(key_path)],
                    capture_output=True,
                ).returncode
                == 0
            )
            checks.append(
                (
                    "private key is not tracked by git",
                    not tracked,
                    f"git rm --cached {key_path} and add `keys/` plus `*.key` to .gitignore",
                )
            )
        except FileNotFoundError:
            warns.append("git not found; could not confirm the private key is untracked")

    gitignore = Path(".gitignore")
    covered = gitignore.exists() and any(
        line in gitignore.read_text(encoding="utf-8").splitlines() for line in GITIGNORE_LINES
    )
    if not covered:
        warns.append(".gitignore does not mention keys/ or *.key; run `receipts init` to add it")

    chain_path = Path(args.chain)
    if chain_path.exists():
        chain = read_chain(str(chain_path))
        try:
            receipts = [
                read_receipt(str(chain_path.parent), name) for name in chain.get("receipts", [])
            ]
            result = verify_chain(
                receipts,
                chain.get("public_key"),
                chain_public_hex=chain.get("public_key"),
                receipt_names=chain.get("receipts", []),
            )
            checks.append(
                (
                    f"chain verifies ({result.verdict})",
                    result.verdict != "red",
                    "the chain is broken; do not ship it. See `receipts verify` output",
                )
            )
            if result.verdict == "yellow":
                warns.extend(result.caveats)
        except ValueError as exc:
            checks.append((f"chain loads ({chain_path})", False, str(exc)))
    else:
        warns.append(f"no chain at {chain_path}; run `receipts ingest` to start one")

    if args.url:
        import json as _json
        import urllib.request

        try:
            with urllib.request.urlopen(args.url, timeout=5) as response:
                served = _json.loads(response.read())
            checks.append(
                (
                    f"chain served at {args.url}",
                    isinstance(served.get("receipts"), list),
                    "the URL responded but does not look like chain.json",
                )
            )
        except Exception as exc:  # noqa: BLE001 - any fetch failure is the same finding
            checks.append(
                (
                    f"chain served at {args.url}",
                    False,
                    f"could not fetch ({exc}); is the receipts directory being served? Try `receipts serve`",
                )
            )

    failures = 0
    for message, ok, fix in checks:
        if ok:
            print(f"  ✓ {message}")
        else:
            failures += 1
            print(f"  ✗ {message}\n      fix: {fix}")
    for warn in warns:
        print(f"  ⚠ {warn}")
    print(f"\n{'All checks passed.' if not failures else f'{failures} check(s) failed.'}")
    return 1 if failures else 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Serve the receipts directory on localhost with CORS for local dev."""
    import http.server
    import socketserver
    from functools import partial

    directory = str(Path(args.dir).resolve())

    class Handler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    handler = partial(Handler, directory=directory)
    print(f"Serving {directory} at http://localhost:{args.port}/chain.json")
    print("CORS is open and caching is off: local development only. Ctrl+C to stop.")
    try:
        with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    """Write the canonical table document for the verified Data tab.

    Refuses to export data that does not descend from the chain: the Data tab
    only ever shows attested data, so an export of mismatched data would be a
    lie waiting to render.
    """
    import json as _json

    from .canonical import canonical_document, load_records as _load
    from .receipts import output_hash_of

    chain = read_chain(args.chain)
    chain_dir = Path(args.chain).parent
    try:
        receipts = [read_receipt(str(chain_dir), name) for name in chain.get("receipts", [])]
    except ValueError as exc:
        print(f"Cannot load chain: {exc}", file=sys.stderr)
        return 1
    if not receipts:
        print("Chain is empty; nothing to export against.", file=sys.stderr)
        return 1

    records = _load(args.data, sheet=args.sheet)
    document = canonical_document(records)
    data_hash = semantic_hash(records)
    expected = output_hash_of(receipts[-1])
    if data_hash != expected:
        print("✗ Refusing to export: the data does not match the final receipt.", file=sys.stderr)
        print(f"  expected output hash {expected}", file=sys.stderr)
        print(f"  found    data hash   {data_hash}", file=sys.stderr)
        print("  The Data tab only shows attested data. Re-run the pipeline or fix --data.", file=sys.stderr)
        return 1

    out_path = Path(args.out) if args.out else chain_dir / "table.json"
    out_path.write_text(_json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"Exported verified table: {out_path}")
    print(f"  rows {len(document['rows'])}, columns {len(document['headers'])}")
    print(f"  semantic_hash {data_hash} (matches final receipt)")
    return 0


def cmd_anchor(args: argparse.Namespace) -> int:
    """Anchor chain.json in the Sigstore transparency log."""
    from .anchor import AnchorUnavailable, anchor_chain, anchor_path_for

    try:
        record = anchor_chain(args.chain, staging=args.staging)
    except AnchorUnavailable as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"⚓ Anchored {record['anchored']} in the Sigstore {record['instance']} log")
    print(f"  identity {record['identity']} (issuer {record['issuer']})")
    print(f"  integrated at {record['integrated_time'] or '(pending)'}")
    print(f"  anchor record -> {anchor_path_for(args.chain)}")
    print("Re-run after every pipeline run that changes the chain; verify with: receipts verify --anchor")
    return 0


def _check_anchor(args: argparse.Namespace, code: int, emit) -> int:
    """Fold anchor verification into the verify verdict and exit code."""
    from .anchor import AnchorUnavailable, anchor_path_for, verify_anchor

    anchor_file = anchor_path_for(args.chain)
    if not anchor_file.exists():
        emit("⚠ no anchor found; run `receipts anchor` to prove existence at a point in time")
        return max(code, 2) if code != 1 else code
    try:
        info = verify_anchor(args.chain, identity=args.anchor_identity, issuer=args.anchor_issuer)
    except AnchorUnavailable as exc:
        emit(f"⚠ anchor present but not checkable: {exc}")
        return max(code, 2) if code != 1 else code
    if info["ok"]:
        emit(
            f"⚓ anchored: this exact chain existed at {info['integrated_time']} "
            f"(Sigstore log, identity {info['identity']})"
        )
        return code
    emit(
        "✗ ANCHOR MISMATCH: chain.json does not verify against its anchor "
        f"({info['error']}). The chain changed after it was anchored"
        + (f" at {info['integrated_time']}" if info.get("integrated_time") else "")
        + ", or the anchor was replaced."
    )
    return 1


def cmd_demo(args: argparse.Namespace) -> int:
    from .demo import run_demo

    return run_demo(serve=not args.no_serve, port=args.port)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="receipts",
        description="Tamper Signal: signed receipts for analytics pipelines.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_keygen = sub.add_parser("keygen", help="Generate an Ed25519 signing keypair")
    p_keygen.add_argument("--out", default="keys/", help="Output directory")
    p_keygen.set_defaults(func=cmd_keygen)

    p_ingest = sub.add_parser("ingest", help="Create a signed source manifest")
    p_ingest.add_argument("file", help="Source data file (.xlsx, .csv, .tsv, .json, .ndjson)")
    p_ingest.add_argument("--origin", default="", help="Free-text declared origin")
    p_ingest.add_argument("--key", default="keys/signing.key", help="Private key path")
    p_ingest.add_argument("--out", default="receipts/", help="Receipts directory")
    p_ingest.add_argument("--sheet", default=None, help="Worksheet name (xlsx only, optional)")
    p_ingest.set_defaults(func=cmd_ingest)

    p_verify = sub.add_parser(
        "verify",
        help="Verify a receipt chain (exit 0 green, 1 red, 2 yellow)",
    )
    p_verify.add_argument("chain", help="Path to chain.json")
    p_verify.add_argument(
        "--pub",
        action="append",
        default=None,
        help="Trusted public key (.pub) path; repeat for key rotation",
    )
    p_verify.add_argument("--data", default=None, help="Current data file to check (.xlsx, .csv, .tsv, .json, .ndjson)")
    p_verify.add_argument("--sheet", default=None, help="Worksheet name (xlsx only, optional)")
    p_verify.add_argument(
        "--warn-drift",
        action="store_true",
        help="Flag any control-totals movement across links as a yellow caveat "
        "(for pipelines expected to preserve totals)",
    )
    p_verify.add_argument(
        "--json",
        action="store_true",
        help="Emit a structured JSON verdict instead of the text report",
    )
    p_verify.add_argument(
        "--anchor",
        action="store_true",
        help="Also verify the Sigstore anchor next to chain.json "
        "(missing anchor is a yellow caveat; mismatch is red)",
    )
    p_verify.add_argument("--anchor-identity", default=None, help="Expected anchor identity (overrides the recorded one)")
    p_verify.add_argument("--anchor-issuer", default=None, help="Expected anchor OIDC issuer (overrides the recorded one)")
    p_verify.set_defaults(func=cmd_verify)

    p_init = sub.add_parser(
        "init", help="Scaffold a project: keys, .gitignore safety, receipts dir (idempotent)"
    )
    p_init.add_argument("--keys", default="keys/", help="Key directory")
    p_init.add_argument("--receipts", default="receipts/", help="Receipts directory")
    p_init.set_defaults(func=cmd_init)

    p_doctor = sub.add_parser(
        "doctor", help="Self-check the integration (exit 1 on failures)"
    )
    p_doctor.add_argument("--key", default="keys/signing.key", help="Private key path")
    p_doctor.add_argument("--chain", default="receipts/chain.json", help="Chain path")
    p_doctor.add_argument("--url", default=None, help="Served chain.json URL to check")
    p_doctor.set_defaults(func=cmd_doctor)

    p_export = sub.add_parser(
        "export",
        help="Write the canonical table document (table.json) for the verified Data tab",
    )
    p_export.add_argument("--chain", default="receipts/chain.json", help="Path to chain.json")
    p_export.add_argument("--data", required=True, help="Data file that must match the final receipt")
    p_export.add_argument("--out", default=None, help="Output path (default: <chain dir>/table.json)")
    p_export.add_argument("--sheet", default=None, help="Worksheet name (xlsx only, optional)")
    p_export.set_defaults(func=cmd_export)

    p_anchor = sub.add_parser(
        "anchor",
        help="Anchor chain.json in the Sigstore transparency log (needs tamper-signal[anchor])",
    )
    p_anchor.add_argument("--chain", default="receipts/chain.json", help="Path to chain.json")
    p_anchor.add_argument("--staging", action="store_true", help="Use the Sigstore staging instance")
    p_anchor.set_defaults(func=cmd_anchor)

    p_serve = sub.add_parser(
        "serve", help="Serve the receipts directory on localhost with CORS (dev only)"
    )
    p_serve.add_argument("--dir", default="receipts/", help="Directory to serve")
    p_serve.add_argument("--port", type=int, default=8787, help="Port")
    p_serve.set_defaults(func=cmd_serve)

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
