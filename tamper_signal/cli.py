"""Command-line entry points for Tamper Signal.

Commands:
  receipts keygen --out keys/
  receipts ingest <file.xlsx> --origin "..." --key keys/signing.key --out receipts/
  receipts verify receipts/chain.json --pub keys/signing.pub [--data <current.xlsx>] [--json]
  receipts diff [A] [B] [--chain receipts/] [--json]
  receipts log [--chain receipts/] [--granularity day|week|month|quarter] [--metric <name>] [--json]
  receipts init
  receipts doctor [--url http://localhost:8787/chain.json]
  receipts serve
  receipts demo
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import color
from .canonical import (
    decimal_to_plain_string,
    load_records,
    semantic_hash,
)
from .keys import generate_keys, load_private_key, load_public_key_hex, public_hex_from_private
from .receipts import (
    CHAIN_FILENAME,
    SOURCE_RECEIPT_NAME,
    read_chain,
    read_receipt,
    receipt_file_hashes,
    verify_chain,
)
from .totals import control_totals
from .wrapper import (
    DEFAULT_BAND,
    DEFAULT_SETTLE_HOURS,
    ingest_file,
    parse_band,
    parse_settle,
)

# parse_band, parse_settle, DEFAULT_BAND, and DEFAULT_SETTLE_HOURS live in
# wrapper.py now (alongside the programmatic ingest_file), but stay importable
# from tamper_signal.cli for callers and tests that referenced them here.
__all__ = ["DEFAULT_BAND", "DEFAULT_SETTLE_HOURS", "parse_band", "parse_settle", "main"]

# Where replace-mode ingest preserves the prior chain (content-addressed by tail).
# Like history/, this is CLI-local and never published, so `serve` 404s it too.
ARCHIVE_DIRNAME = "archive"

# Shipped inside every verified bundle so a recipient who has never heard of
# Tamper Signal can still verify it. Plain instructions, no Tamper Signal install
# assumed. Kept in sync with the JS CLI and the browser export (node/cli.js,
# badge/table.js) -- it is documentation, not hashed content, so exact parity is
# not required, but the wording should not drift.
BUNDLE_README = """\
# Verified data bundle (Tamper Signal)

This zip is a verified export from Tamper Signal. It holds the data file plus
chain.json and the receipt files that prove it.

## Verify it yourself, offline

Install either stack (chains are interchangeable across them):

    pip install tamper-signal       # Python 3.11+, command: receipts
    npm install -g tamper-signal    # Node 18.17+, command: tamper-signal

Then, from the folder you unzipped this into:

    receipts verify chain.json

The exit code is the traffic light: 0 green (intact), 2 yellow (verifies, with
caveats), 1 red (broken, at the exact link, with the totals that moved).

## What a green light proves

Continuity, not correctness. It proves this data descends unchanged from the
signed source, not that the source was right to begin with. Green means nobody
changed the data between the export and you.

https://tampersignal.com
"""


def cmd_keygen(args: argparse.Namespace) -> int:
    private_path, public_path = generate_keys(args.out)
    print(f"Public key written to {public_path}")
    # Warning goes to stderr so it is not swallowed by output redirection.
    print(
        f"Private key written to {private_path}. Do not commit it.",
        file=sys.stderr,
    )
    return 0


def _is_unsnapshotted_reset(chain_dir: str) -> bool:
    """True when ingest is about to reset a chain whose run never reached
    history (no snapshot records the outgoing chain's tail hash): the totals
    of that run are about to become unrecoverable. Never raises (a malformed
    old chain reads as never-snapshotted, since it certainly was never
    snapshotted as-is). Computed from the OUTGOING chain BEFORE ingest_file
    overwrites it; the caller emits the warning only after ingest succeeds.
    """
    chain_path = Path(chain_dir) / CHAIN_FILENAME
    if not chain_path.exists():
        return False
    from .history import chain_tail_hash, history_has_tail

    try:
        old_chain = read_chain(str(chain_path))
        tail = chain_tail_hash(chain_dir, old_chain)
        keys = [k for k in [old_chain.get("public_key")] if isinstance(k, str) and k]
        return not history_has_tail(chain_dir, tail, trusted_keys=keys)
    except Exception:  # noqa: BLE001 - a chain we cannot read was never archived
        return True


def _archive_prior_chain(chain_dir: str) -> Path | None:
    """Before a replace reset, copy the prior chain.json and its receipts into
    <chain_dir>/archive/<tail>/ so the prior chain is preserved, not silently
    overwritten (R9). Content-addressed by the prior chain's tail hash: the same
    prior chain re-archives idempotently and a different prior chain never
    collides. Returns the archive directory, or None when there is nothing to
    archive. Never raises (archiving is best-effort audit, never blocks ingest).
    """
    import shutil

    chain_path = Path(chain_dir) / CHAIN_FILENAME
    if not chain_path.is_file():
        return None
    from .history import chain_tail_hash

    try:
        chain = read_chain(str(chain_path))
        tail = chain_tail_hash(chain_dir, chain)
    except (OSError, ValueError):
        return None
    dest = Path(chain_dir) / ARCHIVE_DIRNAME / tail
    if dest.exists():
        return dest  # this exact prior chain is already archived
    try:
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(chain_path, dest / CHAIN_FILENAME)
        for name in chain.get("receipts", []):
            src = Path(chain_dir) / name
            if src.is_file():
                shutil.copy2(src, dest / name)
    except OSError:
        return None
    return dest


def _cmd_ingest_period(args: argparse.Namespace) -> int:
    """`ingest --as period`: continue the chain's run history under a trusted
    signer. Refuses an untrusted signer rather than appending silently."""
    from .wrapper import UntrustedSignerError, append_period

    # Like replace, compute the unsnapshotted-reset condition and preserve the
    # prior chain before append_period's ingest overwrites chain.json. (A refused
    # untrusted import leaves the prior chain untouched, so the archive copy is an
    # idempotent no-op in that case.)
    unsnapshotted_reset = _is_unsnapshotted_reset(args.out)
    _archive_prior_chain(args.out)

    trusted = [h for h in (load_public_key_hex(p) for p in (args.pub or [])) if h]
    try:
        result = append_period(
            args.file,
            origin=args.origin,
            chain_dir=args.out,
            key_path=args.key,
            trusted_pub_hexes=trusted,
            band=args.band,
            settle=args.settle,
            bucket_column=args.bucket_column,
            sheet=args.sheet,
        )
    except UntrustedSignerError as exc:
        if args.json:
            _print_json({"ok": False, "error": f"Refusing to append a period: {exc}"})
        else:
            print(f"✗ Refusing to append a period: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        if args.json:
            _print_json({"ok": False, "error": str(exc)})
        else:
            print(str(exc), file=sys.stderr)
        return 1

    if unsnapshotted_reset:
        print(
            "warning: previous run was never verified; its totals will not enter history",
            file=sys.stderr,
        )

    manifest = result["manifest"]
    totals = manifest["control_totals"]
    if args.json:
        _caveats = result.get("caveats") or []
        _print_json(
            {
                "source": manifest["source"]["filename"],
                "evidence_hash": manifest["source"]["evidence_hash"],
                "semantic_hash": manifest["semantic_hash"],
                "row_count": totals["row_count"],
                "column_count": totals["column_count"],
                "mode": "period",
                "verdict": "yellow" if _caveats else "green",
                "caveats": _caveats,
                "compared": bool(result.get("compared")),
            }
        )
        return 2 if _caveats else 0
    print(f"Imported next period: {manifest['source']['filename']}")
    print(f"  evidence_hash {color.dim(manifest['source']['evidence_hash'])}")
    print(f"  semantic_hash {color.dim(manifest['semantic_hash'])}")
    print(f"  rows {totals['row_count']}, columns {totals['column_count']}")
    caveats = result.get("caveats") or []
    if caveats:
        print("  the light is yellow, a human should look:")
        for caveat in caveats:
            print(f"    - {caveat}")
        return 2
    if result.get("compared"):
        print("  in band against the prior run (the light stays green)")
    else:
        print("  recorded as the first period (no prior run to compare)")
    return 0


def _print_json(payload: dict) -> None:
    """Emit a structured payload on stdout (the established --json convention)."""
    import json as _json

    print(_json.dumps(payload, indent=2))


def cmd_ingest(args: argparse.Namespace) -> int:
    if os.environ.get("TAMPER_SIGNAL_KEY"):
        # The env var silently outranks --key; say so where it matters.
        print("Signing with TAMPER_SIGNAL_KEY from the environment (overrides --key)", file=sys.stderr)

    if getattr(args, "mode", "replace") == "period":
        return _cmd_ingest_period(args)

    # Compute the unsnapshotted-reset condition from the OUTGOING chain before
    # ingest_file overwrites chain.json; emit the warning only after ingest
    # validation passes (below), so an invalid flag exits 1 with no warning.
    unsnapshotted_reset = _is_unsnapshotted_reset(args.out)
    # Preserve the prior chain before the reset overwrites it (R9).
    _archive_prior_chain(args.out)

    # ingest_file parses the tolerance declaration, builds and signs the source
    # manifest, and RESETS chain.json to it -- the same call a Python pipeline
    # uses to declare tolerance programmatically. Invalid band/settle values
    # and a non-qualifying --bucket-column raise ValueError before anything is
    # written; surface them as a clean error and exit 1.
    try:
        result = ingest_file(
            args.file,
            origin=args.origin,
            chain_dir=args.out,
            key_path=args.key,
            band=args.band,
            settle=args.settle,
            bucket_column=args.bucket_column,
            sheet=args.sheet,
        )
    except ValueError as exc:
        if args.json:
            _print_json({"ok": False, "error": str(exc)})
        else:
            print(str(exc), file=sys.stderr)
        return 1

    if unsnapshotted_reset:
        print(
            "warning: previous run was never verified; its totals will not enter history",
            file=sys.stderr,
        )

    manifest = result["manifest"]
    tolerance = manifest.get("tolerance")
    totals = manifest["control_totals"]
    if args.json:
        _print_json(
            {
                "source": manifest["source"]["filename"],
                "evidence_hash": manifest["source"]["evidence_hash"],
                "semantic_hash": manifest["semantic_hash"],
                "row_count": totals["row_count"],
                "column_count": totals["column_count"],
                "tolerance": tolerance,
                "source_manifest": str(Path(args.out) / SOURCE_RECEIPT_NAME),
            }
        )
        return 0
    print(f"Ingested {manifest['source']['filename']}")
    print(f"  evidence_hash {color.dim(manifest['source']['evidence_hash'])}")
    print(f"  semantic_hash {color.dim(manifest['semantic_hash'])}")
    print(f"  rows {totals['row_count']}, columns {totals['column_count']}")
    if tolerance is not None:
        bucket_column = tolerance.get("bucket_column")
        extra = f", bucket_column {bucket_column}" if bucket_column else ""
        print(
            f"  tolerance band {tolerance['band']}, "
            f"settle_hours {tolerance['settle_hours']}{extra} (signed into the manifest)"
        )
    print(f"  source manifest -> {Path(args.out) / SOURCE_RECEIPT_NAME}")
    return 0


def _resolve_snapshot_key():
    """The private key snapshots sign with, or None for unsigned snapshots.

    Same precedence as ingest: TAMPER_SIGNAL_KEY from the environment wins,
    else the default keys/signing.key when it exists. Verify takes no --key
    flag (verification needs no private key), so an absent key just means the
    snapshot is written unsigned.
    """
    default_key = Path("keys/signing.key")
    if not os.environ.get("TAMPER_SIGNAL_KEY") and not default_key.exists():
        return None
    return load_private_key(str(default_key))


def _archive_after_verify(
    chain_dir: str,
    chain: dict,
    receipts: list,
    trusted_keys: list[str],
    breached: dict | None = None,
) -> None:
    """Archive a run snapshot after a non-red final verdict.

    Never raises and never changes the verdict or exit code: any failure
    (key load, history scan, signing, write) degrades to a stderr notice.
    Notices go to stderr ONLY so the --json stdout payload stays untouched.
    `breached` is the baseline-advancement guard from this run's judgment.
    """
    from .history import archive_run_snapshot

    def notice(message: str) -> None:
        print(message, file=sys.stderr)

    try:
        key = _resolve_snapshot_key()
    except Exception as exc:  # noqa: BLE001 - degrade to unsigned, never fail verify
        notice(f"could not load a signing key for the run snapshot: {exc}")
        key = None
    if key is not None:
        # Snapshots this machine signs must count as valid on the next run
        # even when the signing key differs from the chain key, or the
        # idempotence check would re-write a snapshot on every verify.
        trusted_keys = trusted_keys + [public_hex_from_private(key)]
    try:
        archive_run_snapshot(
            chain_dir,
            chain,
            receipts,
            key=key,
            trusted_keys=trusted_keys,
            on_notice=notice,
            breached=breached,
        )
    except Exception as exc:  # noqa: BLE001 - archiving must never fail the verify
        notice(f"could not archive run snapshot: {exc}")


def _judge_after_verify(
    chain_dir: str,
    chain: dict,
    receipts: list,
    trusted_keys: list[str],
) -> dict:
    """Run cross-run judgment for a non-red verify; never raises.

    Returns judge_cross_run's shape ({caveats, details, notices, breached}).
    With no tolerance declaration in the source manifest this is a no-op with
    zero output (AE13: verification stays exact and silent). Any failure
    degrades to an empty judgment with a notice, never a verdict change.
    """
    from .history import empty_judgment, judge_cross_run, load_snapshots

    source = receipts[0] if receipts and isinstance(receipts[0], dict) else {}
    if not isinstance(source.get("tolerance"), dict):
        return empty_judgment()
    notices: list[str] = []
    try:
        try:
            key = _resolve_snapshot_key()
        except Exception:  # noqa: BLE001 - judging without the machine key is fine
            key = None
        keys = [k for k in trusted_keys if k]
        if key is not None:
            keys.append(public_hex_from_private(key))
        items = load_snapshots(chain_dir, trusted_keys=keys, on_notice=notices.append)
        judgment = judge_cross_run(receipts, chain, [i["snapshot"] for i in items])
    except Exception as exc:  # noqa: BLE001 - judgment must never fail the verify
        empty = empty_judgment()
        empty["notices"] = notices + [f"cross-run judgment skipped: {exc}"]
        return empty
    judgment["notices"] = notices + judgment["notices"]
    return judgment


def _fold_judgment_caveats(result, caveats: list[str]) -> None:
    """Fold judgment caveats into a ChainResult so the verdict property,
    summary lines, and exit mapping work untouched. A green report becomes
    the standard yellow report; a yellow report gains the new caveat lines
    before its closing "A human should look." line (existing machinery, never
    duplicated)."""
    new_lines = [f"  - {caveat}" for caveat in caveats]
    if result.caveats:
        result.lines[-1:-1] = new_lines
    else:
        header = result.lines[-1] if result.lines else ""
        summary = header.removeprefix("✓ CHAIN INTACT: ")
        if result.lines:
            result.lines[-1] = f"⚠ CHAIN VERIFIES, WITH CAVEATS: {summary}"
        result.lines.extend(new_lines)
        result.lines.append("  A human should look.")
    result.caveats.extend(caveats)


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
        # An empty key file must not silently shrink the trusted set: the
        # filtered-out key would fall back to the chain-embedded key instead.
        empty = [path for path, key in zip(args.pub, public_hex) if not key]
        if empty:
            print(f"Empty public key file passed to --pub: {', '.join(empty)}", file=sys.stderr)
            return 1
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

    # Chains that record receipt hashes get them enforced; older chains skip.
    recorded_hashes = chain.get("receipt_hashes")
    if not isinstance(recorded_hashes, dict):
        recorded_hashes = None
    actual_hashes = (
        receipt_file_hashes(chain_dir, chain.get("receipts", []))
        if recorded_hashes is not None
        else None
    )

    result = verify_chain(
        receipts,
        public_hex,
        data_hash,
        data_totals,
        chain_public_hex=chain_key,
        receipt_names=chain.get("receipts", []),
        warn_drift=args.warn_drift,
        recorded_hashes=recorded_hashes,
        actual_hashes=actual_hashes,
    )
    # Cross-run judgment (U6) runs AFTER the within-run verdict and BEFORE
    # the anchor fold and exit-code finalization: a red verify never judges,
    # and judgment caveats are yellow, never red (R12). It lives in the CLI
    # layer so verify_chain stays pure and the browser verifier untouched.
    judgment = {"caveats": [], "details": [], "notices": [], "breached": {}}
    if result.verdict != "red":
        judgment = _judge_after_verify(
            chain_dir, chain, receipts, _as_key_list(public_hex) + [chain_key or ""]
        )
        if judgment["caveats"]:
            _fold_judgment_caveats(result, judgment["caveats"])
        for line in judgment["notices"]:
            print(line, file=sys.stderr)
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
            # Additive (R18): typed cross-run detail. Always present, [] when
            # judgment found nothing or never ran, so consumers can rely on
            # the key. Anchor caveats deliberately have no details entry.
            "caveat_details": judgment["details"],
            "broken_link": result.broken_link_detail,
            "data_mismatch": result.data_mismatch,
            "receipt_mismatch": result.receipt_mismatch,
            "report": result.lines,
        }
        if args.anchor:
            anchor_lines: list[str] = []
            code = _check_anchor(
                args.chain,
                code,
                anchor_lines.append,
                identity=args.anchor_identity,
                issuer=args.anchor_issuer,
                allow_staging=args.anchor_staging,
                covers_receipts=recorded_hashes is not None,
            )
            # Keep the payload self-consistent: the anchor outcome is part of
            # the verdict, not a side channel next to it.
            payload["anchor"] = anchor_lines
            payload["exit_code"] = code
            payload["verdict"] = {0: "green", 1: "red", 2: "yellow"}[code]
            payload["report"] = payload["report"] + anchor_lines
            payload["caveats"] = payload["caveats"] + [
                line.removeprefix("⚠ ") for line in anchor_lines if line.startswith("⚠")
            ]
        print(_json.dumps(payload, indent=2))
    else:
        if color.should_color():
            print(f"{color.light(result.verdict)} {color.colorize(result.verdict.upper(), result.verdict)}")
        for line in result.lines:
            print(line)
        if args.anchor:
            code = _check_anchor(
                args.chain,
                code,
                print,
                identity=args.anchor_identity,
                issuer=args.anchor_issuer,
                allow_staging=args.anchor_staging,
                covers_receipts=recorded_hashes is not None,
            )
    # Archive the run snapshot AFTER the anchor fold settled the final exit
    # code: a red run (including an anchor mismatch) never poisons history.
    if code != 1:
        trusted = [key for key in _as_key_list(public_hex) + [chain_key] if key]
        _archive_after_verify(
            chain_dir, chain, receipts, trusted, breached=judgment["breached"] or None
        )
    return code


def _as_key_list(public_hex) -> list[str]:
    """Normalize the verify key argument (str or list) to a list."""
    if public_hex is None:
        return []
    if isinstance(public_hex, str):
        return [public_hex]
    return list(public_hex)


GITIGNORE_LINES = ["keys/", "*.key"]


def cmd_init(args: argparse.Namespace) -> int:
    """Idempotent project scaffold: keys, .gitignore safety, receipts dir."""
    from .keys import PRIVATE_KEY_NAME, generate_keys

    _banner = color.banner()
    if _banner:
        print(_banner)

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

    failures = sum(1 for _message, ok, _fix in checks if not ok)
    if args.json:
        _print_json(
            {
                "checks": [
                    {"name": message, "ok": ok, "fix": fix} for message, ok, fix in checks
                ],
                "warnings": warns,
                "all_passed": failures == 0,
            }
        )
        return 1 if failures else 0
    for message, ok, fix in checks:
        if ok:
            print(f"  {color.colorize('✓', 'green')} {message}")
        else:
            print(f"  {color.colorize('✗', 'red')} {message}\n      fix: {fix}")
    for warn in warns:
        print(f"  {color.colorize('⚠', 'yellow')} {warn}")
    print(f"\n{'All checks passed.' if not failures else f'{failures} check(s) failed.'}")
    return 1 if failures else 0


def _serve_handler_class(directory: str):
    """The request handler `receipts serve` uses, bound to a directory.

    CORS is open and caching is off for every response. Anything under
    history/ or archive/ is 404'd: run snapshots and archived prior chains are
    CLI-local memory, not published receipts (they leak run cadence, per-day
    totals, and the reset/migration trail).
    """
    import http.server

    from .history import HISTORY_DIRNAME

    blocked_dirs = [
        (Path(directory) / HISTORY_DIRNAME).resolve(),
        (Path(directory) / ARCHIVE_DIRNAME).resolve(),
    ]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *handler_args, **handler_kwargs) -> None:
            super().__init__(*handler_args, directory=directory, **handler_kwargs)

        def end_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def send_head(self):  # covers GET and HEAD
            # Resolve the translated filesystem path so neither /history/... nor
            # /archive/... (nor a traversal spelling of them) can reach the files.
            try:
                target = Path(self.translate_path(self.path)).resolve()
            except (OSError, ValueError):
                self.send_error(404, "Not found")
                return None
            if any(target == d or d in target.parents for d in blocked_dirs):
                self.send_error(404, "Not found")
                return None
            return super().send_head()

    return Handler


def cmd_serve(args: argparse.Namespace) -> int:
    """Serve the receipts directory on localhost with CORS for local dev."""
    import socketserver

    directory = str(Path(args.dir).resolve())
    handler = _serve_handler_class(directory)
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
        if args.json:
            _print_json({"ok": False, "error": f"Cannot load chain: {exc}"})
        else:
            print(f"Cannot load chain: {exc}", file=sys.stderr)
        return 1
    if not receipts:
        if args.json:
            _print_json({"ok": False, "error": "Chain is empty; nothing to export against."})
        else:
            print("Chain is empty; nothing to export against.", file=sys.stderr)
        return 1

    records = _load(args.data, sheet=args.sheet)
    document = canonical_document(records)
    data_hash = semantic_hash(records)
    expected = output_hash_of(receipts[-1])
    if data_hash != expected:
        if args.json:
            _print_json(
                {
                    "ok": False,
                    "error": "the data does not match the final receipt",
                    "expected_output_hash": expected,
                    "data_hash": data_hash,
                }
            )
        else:
            print("✗ Refusing to export: the data does not match the final receipt.", file=sys.stderr)
            print(f"  expected output hash {expected}", file=sys.stderr)
            print(f"  found    data hash   {data_hash}", file=sys.stderr)
            print("  The Data tab only shows attested data. Re-run the pipeline or fix --data.", file=sys.stderr)
        return 1

    if getattr(args, "bundle", False):
        return _write_verified_bundle(args, chain, chain_dir, data_hash)

    out_path = Path(args.out) if args.out else chain_dir / "table.json"
    out_path.write_text(_json.dumps(document, indent=2) + "\n", encoding="utf-8")
    if args.json:
        _print_json(
            {
                "output": str(out_path),
                "row_count": len(document["rows"]),
                "column_count": len(document["headers"]),
                "data_hash": data_hash,
                "bundle": False,
            }
        )
        return 0
    print(f"Exported verified table: {out_path}")
    print(f"  rows {len(document['rows'])}, columns {len(document['headers'])}")
    print(f"  semantic_hash {color.dim(data_hash)} (matches final receipt)")
    return 0


def _write_verified_bundle(
    args: argparse.Namespace, chain: dict[str, Any], chain_dir: Path, data_hash: str
) -> int:
    """Write a verified bundle: the original data file plus chain.json and its
    receipt files, packaged so a recipient can `receipts verify chain.json`
    offline.

    Stores entries uncompressed and byte-for-byte (LF preserved), because
    chain.json's receipt_hashes commit to the raw bytes of each receipt file —
    any re-serialization would verify as a broken chain on the recipient's side.
    The data file is included verbatim, so the bundle carries the original file,
    not the canonicalized table.
    """
    import zipfile

    data_path = Path(args.data)
    chain_path = Path(args.chain)
    receipt_names = list(chain.get("receipts", []))

    out_path = Path(args.out) if args.out else chain_dir / f"{data_path.stem}-verified.zip"

    # Mirror the on-disk chain_dir layout flat at the bundle root so an unzip +
    # `receipts verify chain.json` resolves receipts the same way it does locally.
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.writestr("README.md", BUNDLE_README)  # verify instructions for the recipient
        bundle.writestr(data_path.name, data_path.read_bytes())
        bundle.writestr(CHAIN_FILENAME, chain_path.read_bytes())
        for name in receipt_names:
            bundle.writestr(name, (chain_dir / name).read_bytes())

    if getattr(args, "json", False):
        _print_json(
            {
                "output": str(out_path),
                "data": data_path.name,
                "receipts": len(receipt_names),
                "data_hash": data_hash,
                "bundle": True,
            }
        )
        return 0
    print(f"Exported verified bundle: {out_path}")
    print(f"  data {data_path.name}, {len(receipt_names)} receipts + {CHAIN_FILENAME}")
    print(f"  semantic_hash {color.dim(data_hash)} (matches final receipt)")
    print(f"  recipient: unzip, then `receipts verify {CHAIN_FILENAME}`")
    return 0


def _chain_dir_of(ref: str) -> str:
    """Normalize a --chain value: accept a chain dir or a chain.json path."""
    path = Path(ref)
    if path.name == CHAIN_FILENAME:
        return str(path.parent)
    return ref


def _diff_side_from_chain_dir(chain_dir: str, ref: str) -> dict:
    """Adapter: a live chain directory in the snapshot's diff shape.

    Raises ValueError with a clean message on any load failure (missing
    chain.json, unreadable receipts); `receipts diff` treats those as usage
    errors (exit 1).
    """
    from .history import chain_tail_hash, run_source, run_stages

    chain_path = Path(chain_dir) / CHAIN_FILENAME
    if not chain_path.is_file():
        raise ValueError(f"no {CHAIN_FILENAME} in {chain_dir or '.'}")
    try:
        chain = read_chain(str(chain_path))
    except (OSError, ValueError) as exc:
        raise ValueError(f"cannot read {chain_path}: {exc}") from exc
    if not isinstance(chain, dict):
        raise ValueError(f"{chain_path} is not a chain file")
    receipts = [read_receipt(chain_dir, name) for name in chain.get("receipts", [])]
    try:
        tail = chain_tail_hash(chain_dir, chain)
    except (OSError, ValueError):
        # A chain with no receipts still diffs (it just cannot anchor the
        # default-mode "differs from current tail" selection).
        tail = None
    return {
        "ref": ref,
        "created_at": None,
        "source": run_source(receipts),
        "stages": run_stages(receipts),
        "tail": tail,
        "unsigned": False,
        "public_key": chain.get("public_key") if isinstance(chain.get("public_key"), str) else None,
    }


def _diff_side_from_snapshot(snapshot: dict, ref: str, *, signed: bool | None = None) -> dict:
    """Adapter: an archived run snapshot in the diff shape."""
    stages = snapshot.get("stages")
    source = snapshot.get("source")
    created = snapshot.get("created_at")
    if signed is None:
        signed = isinstance(snapshot.get("signature"), dict)
    return {
        "ref": ref,
        "created_at": created if isinstance(created, str) else None,
        "source": source if isinstance(source, dict) else {},
        "stages": stages if isinstance(stages, list) else [],
        "tail": snapshot.get("chain_tail_hash"),
        "unsigned": not signed,
        "public_key": None,
    }


def _load_diff_side(ref: str) -> dict:
    """Load one explicit diff argument: a chain directory, a chain.json path,
    or a run-snapshot file. Raises ValueError on anything unloadable."""
    import json as _json

    path = Path(ref)
    if path.is_dir():
        return _diff_side_from_chain_dir(str(path), ref)
    if not path.is_file():
        raise ValueError(f"no such file or directory: {ref}")
    try:
        payload = _json.loads(path.read_text(encoding="utf-8"))
    except (OSError, _json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {ref}: {exc}") from exc
    if isinstance(payload, dict) and payload.get("kind") == "run_snapshot":
        return _diff_side_from_snapshot(payload, ref)
    if isinstance(payload, dict) and isinstance(payload.get("receipts"), list):
        return _diff_side_from_chain_dir(str(path.parent), ref)
    raise ValueError(f"{ref} is neither a chain directory, a chain.json, nor a run snapshot")


def _render_stage_delta(delta: dict) -> list[str]:
    """Human lines (ASCII only) for one stage's structured totals delta."""
    lines: list[str] = []
    for key in ("row_count", "column_count"):
        entry = delta.get(key)
        if entry:
            suffix = f" ({color.signed(format(entry['delta'], '+d'))})" if "delta" in entry else ""
            lines.append(f"{key} {entry['before']} -> {entry['after']}{suffix}")
    for column, entry in (delta.get("numeric_sums") or {}).items():
        before = entry["before"] if entry["before"] is not None else "(added)"
        after = entry["after"] if entry["after"] is not None else "(removed)"
        suffix = f" ({color.signed(entry['delta'])})" if "delta" in entry else ""
        lines.append(f"{column} {before} -> {after}{suffix}")
    for column, entry in (delta.get("null_counts") or {}).items():
        suffix = f" ({color.signed(format(entry['delta'], '+d'))})" if "delta" in entry else ""
        lines.append(f"null_counts[{column}] {entry['before']} -> {entry['after']}{suffix}")

    def _range(value) -> str:
        if isinstance(value, dict):
            return f"{value.get('min')}..{value.get('max')}"
        return "(none)"

    for column, entry in (delta.get("date_ranges") or {}).items():
        lines.append(f"date_ranges[{column}] {_range(entry['before'])} -> {_range(entry['after'])}")
    moved = delta.get("period_buckets_changed")
    if moved:
        lines.append(f"period_buckets changed: {', '.join(moved)}")
    return lines


def cmd_diff(args: argparse.Namespace) -> int:
    """Compare two runs: per-stage code-hash changes plus a structured totals
    delta (including date ranges). Read-only: never writes anything. Exit 0
    whether or not differences are found; 1 on usage/load errors."""
    import json as _json

    from .totals import structured_totals_delta

    runs = args.runs or []
    if len(runs) > 2:
        print("diff takes at most two runs (chain directories or snapshot files)", file=sys.stderr)
        return 1

    chain_dir = _chain_dir_of(args.chain)
    try:
        if len(runs) == 2:
            side_a = _load_diff_side(runs[0])
            side_b = _load_diff_side(runs[1])
        elif len(runs) == 1:
            # One arg: that run (the "before") vs the current chain.
            side_a = _load_diff_side(runs[0])
            side_b = _diff_side_from_chain_dir(chain_dir, chain_dir)
        else:
            # Zero args (hardened default): current chain vs the most recent
            # valid snapshot whose tail DIFFERS from the current chain's, so
            # a freshly archived snapshot of this very run never self-compares.
            from .history import load_snapshots

            side_b = _diff_side_from_chain_dir(chain_dir, chain_dir)
            trusted = [k for k in [side_b["public_key"]] if k]
            items = load_snapshots(
                chain_dir,
                trusted_keys=trusted,
                on_notice=lambda message: print(message, file=sys.stderr),
            )
            prior = next(
                (
                    item
                    for item in items
                    if item["snapshot"].get("chain_tail_hash") != side_b["tail"]
                ),
                None,
            )
            if prior is None:
                print("no prior run archived to compare against")
                return 0
            side_a = _diff_side_from_snapshot(
                prior["snapshot"], prior["path"], signed=prior["signed"]
            )
    except ValueError as exc:
        print(f"diff: {exc}", file=sys.stderr)
        return 1

    source_a = side_a["source"]
    source_b = side_b["source"]
    identity_mismatch = source_a.get("filename") != source_b.get("filename") or source_a.get(
        "columns"
    ) != source_b.get("columns")

    # Stage alignment is BY NAME, order-independent; first receipt wins a
    # duplicated name. Output order: A's stages, then B-only stages appended.
    stages_a = {
        s.get("name"): s for s in reversed(side_a["stages"]) if isinstance(s, dict)
    }
    stages_b = {
        s.get("name"): s for s in reversed(side_b["stages"]) if isinstance(s, dict)
    }
    order: list = []
    seen: set = set()
    for stage in list(side_a["stages"]) + list(side_b["stages"]):
        if isinstance(stage, dict) and stage.get("name") not in seen:
            seen.add(stage.get("name"))
            order.append(stage.get("name"))

    stage_rows: list[dict] = []
    for name in order:
        stage_a = stages_a.get(name)
        stage_b = stages_b.get(name)
        if stage_a is not None and stage_b is not None:
            code_before = stage_a.get("code_hash") if isinstance(stage_a.get("code_hash"), str) else ""
            code_after = stage_b.get("code_hash") if isinstance(stage_b.get("code_hash"), str) else ""
            code_changed = code_before != code_after
            totals_a = stage_a.get("totals") if isinstance(stage_a.get("totals"), dict) else {}
            totals_b = stage_b.get("totals") if isinstance(stage_b.get("totals"), dict) else {}
            row: dict = {
                "name": name,
                "status": "matched",
                "code_changed": code_changed,
                "totals": structured_totals_delta(totals_a, totals_b),
            }
            if code_changed:
                row["code_hash"] = {"before8": code_before[:8], "after8": code_after[:8]}
                code_file = stage_b.get("code_file") or stage_a.get("code_file")
                if isinstance(code_file, str) and code_file:
                    row["code_file"] = code_file
            stage_rows.append(row)
        else:
            stage_rows.append(
                {
                    "name": name,
                    "status": "removed" if stage_a is not None else "added",
                    "code_changed": False,
                    "totals": None,
                }
            )

    if args.json:
        payload = {
            "a": {
                "ref": side_a["ref"],
                "created_at": side_a["created_at"],
                "unsigned": side_a["unsigned"],
            },
            "b": {
                "ref": side_b["ref"],
                "created_at": side_b["created_at"],
                "unsigned": side_b["unsigned"],
            },
            "stages": stage_rows,
            "identity_mismatch": identity_mismatch,
        }
        print(_json.dumps(payload, indent=2))
        return 0

    for side in (side_a, side_b):
        if side["unsigned"]:
            print(f"note: snapshot {Path(side['ref']).name} is unsigned; weaker evidence")
    if identity_mismatch:
        name_a = source_a.get("filename") or "(unknown)"
        name_b = source_b.get("filename") or "(unknown)"
        print(f"note: sources differ ({name_a} vs {name_b}); comparing anyway")
    created_a = f" (created {side_a['created_at']})" if side_a["created_at"] else ""
    created_b = f" (created {side_b['created_at']})" if side_b["created_at"] else ""
    print(f"a: {side_a['ref']}{created_a}")
    print(f"b: {side_b['ref']}{created_b}")

    any_difference = False
    for row in stage_rows:
        if row["status"] != "matched":
            any_difference = True
            print(f"stage {row['name']}: {row['status']}")
            continue
        lines: list[str] = []
        if row["code_changed"]:
            hashes = row["code_hash"]
            where = f" ({row['code_file']})" if "code_file" in row else ""
            before8 = hashes["before8"] or "(none)"
            after8 = hashes["after8"] or "(none)"
            lines.append(f"code_hash {before8} -> {after8}{where}")
        lines.extend(_render_stage_delta(row["totals"]))
        if lines:
            any_difference = True
            print(f"stage {row['name']}")
            for line in lines:
                print(f"  {line}")
    if not any_difference:
        print("no differences")
    return 0


def _final_stage_totals(snapshot: dict) -> dict:
    """The last stage's totals in a snapshot (the FINAL stage `log` trends)."""
    stages = snapshot.get("stages")
    if isinstance(stages, list):
        for stage in reversed(stages):
            if isinstance(stage, dict):
                totals = stage.get("totals")
                return totals if isinstance(totals, dict) else {}
    return {}


def _log_metric_value(totals: dict, metric: str) -> str | None:
    """A metric's display string from final-stage totals, or None when absent.

    Metric ids: "row_count" or a numeric_sums column name. row_count renders
    as its integer string; numeric sums are already plain decimal strings.
    """
    if metric == "row_count":
        value = totals.get("row_count")
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
        return None
    sums = totals.get("numeric_sums")
    value = sums.get(metric) if isinstance(sums, dict) else None
    return value if isinstance(value, str) else None


def _default_log_metrics(snapshots: list[dict]) -> list[str]:
    """Default selection: row_count plus the union of every snapshot's
    final-stage numeric_sums column names (sorted), so a metric that appears
    in only some runs is still trended ("-" where it is missing)."""
    sums: set[str] = set()
    for snapshot in snapshots:
        totals = _final_stage_totals(snapshot)
        s = totals.get("numeric_sums")
        if isinstance(s, dict):
            sums.update(str(k) for k in s)
    return ["row_count"] + sorted(sums)


def _log_breached_metrics(snapshot: dict) -> set[str]:
    """The metric ids this snapshot's judgment flagged anywhere (any bucket).

    The breached map is keyed by bucket; `log` trends final-stage whole-table
    metrics, so a metric is marked breached for the run if it breached in ANY
    bucket. row_count and numeric-sum names match the log metric ids directly;
    null_counts[...] ids never appear as log metrics and are ignored.
    """
    breached = snapshot.get("breached")
    names: set[str] = set()
    if isinstance(breached, dict):
        for metrics in breached.values():
            if isinstance(metrics, list):
                names.update(m for m in metrics if isinstance(m, str))
    return names


def _build_log_periods(items: list[dict], granularity: str, metrics: list[str]) -> tuple[list[dict], int]:
    """Collapse validated snapshot items into per-period rows (oldest first).

    Multiple runs in the same period collapse LAST-WINS by created_at (ties
    break on body_hash for determinism, matching load_snapshots' ordering).
    Returns (rows, collapsed) where collapsed counts the runs hidden by the
    collapse (total runs minus rendered rows). Each row carries the period key,
    the run count, the chosen snapshot's tail/created_at/unsigned, and per-metric
    value strings plus the breached-metric set.
    """
    from .history import period_key

    # Group by period key. Within a period, keep the winner (the latest run by
    # the same ordering load_snapshots uses) and count the runs collapsed.
    groups: dict[str, dict] = {}
    for item in items:
        snapshot = item["snapshot"]
        key = period_key(item["created_at"], granularity)
        sort_key = (item["created_at"], item["body_hash"])
        group = groups.get(key)
        if group is None:
            groups[key] = {"item": item, "sort_key": sort_key, "count": 1}
        else:
            group["count"] += 1
            if sort_key > group["sort_key"]:
                group["item"] = item
                group["sort_key"] = sort_key

    rows: list[dict] = []
    collapsed = 0
    for key in sorted(groups):  # period keys sort chronologically as strings
        group = groups[key]
        collapsed += group["count"] - 1
        item = group["item"]
        snapshot = item["snapshot"]
        totals = _final_stage_totals(snapshot)
        breached = _log_breached_metrics(snapshot)
        values = {metric: _log_metric_value(totals, metric) for metric in metrics}
        rows.append(
            {
                "period": key,
                "runs": group["count"],
                "created_at": item["created_at"],
                "tail": snapshot.get("chain_tail_hash") or "",
                "unsigned": not item["signed"],
                "values": values,
                "breached": breached,
            }
        )
    return rows, collapsed


def _render_log_table(rows: list[dict], metrics: list[str]) -> list[str]:
    """ASCII, aligned, chronological table. Each metric column shows the value,
    a "!" suffix when the run breached that metric, and a delta vs the previous
    rendered row in parentheses (first row has no delta). A missing metric
    renders "-". An "unsigned" column shows "u" for unsigned snapshots."""
    headers = ["period", "runs", "tail", "unsigned"] + metrics
    table: list[list[str]] = []
    for index, row in enumerate(rows):
        cells = [
            row["period"],
            str(row["runs"]),
            (row["tail"][:8] if row["tail"] else "-"),
            ("u" if row["unsigned"] else ""),
        ]
        for metric in metrics:
            value = row["values"].get(metric)
            if value is None:
                cells.append("-")
                continue
            text = value + ("!" if metric in row["breached"] else "")
            prior = _previous_log_value(rows, index, metric)
            if prior is not None:
                delta = _log_delta(prior, value)
                if delta is not None:
                    text += f" ({delta})"
            cells.append(text)
        table.append(cells)

    widths = [len(h) for h in headers]
    for cells in table:
        for i, cell in enumerate(cells):
            widths[i] = max(widths[i], len(cell))

    def fmt(cells: list[str]) -> str:
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells)).rstrip()

    lines = [fmt(headers)]
    lines.extend(fmt(cells) for cells in table)
    return lines


def _previous_log_value(rows: list[dict], index: int, metric: str) -> str | None:
    """The most recent earlier row's value for this metric, skipping rows where
    the metric was missing, or None when no earlier row has it. The delta a row
    shows is against this value, so a one-off gap does not erase the trend."""
    for back in range(index - 1, -1, -1):
        candidate = rows[back]["values"].get(metric)
        if candidate is not None:
            return candidate
    return None


def _log_delta(before: str, after: str) -> str | None:
    """Signed delta string between two metric values, or None when either is
    not a finite decimal. Integers render without a decimal point ("+22");
    fractional deltas keep their plain decimal form ("+1.5")."""
    from decimal import Decimal, InvalidOperation

    try:
        diff = Decimal(after) - Decimal(before)
    except InvalidOperation:
        return None
    if not diff.is_finite():
        return None
    sign = "-" if diff < 0 else "+"
    return sign + decimal_to_plain_string(abs(diff))


def cmd_log(args: argparse.Namespace) -> int:
    """Render archived run history as a per-metric trend across runs.

    Read-only scan of <chain dir>/history/ via load_snapshots. Empty history
    prints a notice and exits 0; a single run renders one row with no deltas.
    The default metric selection is row_count plus every final-stage numeric
    sum; --metric filters it. --granularity collapses multiple runs in the
    same period last-wins. ASCII only; --json emits the structured trend
    (oldest first)."""
    import json as _json

    from .history import LOG_GRANULARITIES, load_snapshots

    granularity = args.granularity
    if granularity not in LOG_GRANULARITIES:
        print(
            f"log: unknown --granularity '{granularity}' "
            f"(choose from {', '.join(LOG_GRANULARITIES)})",
            file=sys.stderr,
        )
        return 1

    chain_dir = _chain_dir_of(args.chain)
    chain_path = Path(chain_dir) / CHAIN_FILENAME
    trusted: list[str] = []
    if args.pub:
        trusted = [load_public_key_hex(path) for path in args.pub]
    elif chain_path.is_file():
        # Default to the chain's embedded key so signed snapshots verify.
        try:
            chain = read_chain(str(chain_path))
            key = chain.get("public_key")
            if isinstance(key, str) and key:
                trusted = [key]
        except (OSError, ValueError):
            trusted = []

    items = load_snapshots(
        chain_dir,
        trusted_keys=trusted,
        on_notice=lambda message: print(message, file=sys.stderr),
    )
    if not items:
        print("no run history yet")
        return 0

    # load_snapshots returns newest-first; `log` renders oldest-first.
    items = list(reversed(items))
    snapshots = [item["snapshot"] for item in items]
    if args.metric:
        metrics = list(dict.fromkeys(args.metric))  # de-dupe, keep order
    else:
        metrics = _default_log_metrics(snapshots)

    rows, collapsed = _build_log_periods(items, granularity, metrics)

    if args.json:
        # The signed tolerance declaration is a per-snapshot, display-only field;
        # surface it per run entry (omitted when that run declared none) so a
        # mixed-history log stays valid and both stacks agree.
        tol_by_tail = {
            snapshot.get("chain_tail_hash"): snapshot["tolerance"]
            for snapshot in snapshots
            if isinstance(snapshot.get("tolerance"), dict)
        }

        def _run_entry(index: int, row: dict) -> dict:
            entry = {
                "period": row["period"],
                "created_at": row["created_at"],
                "tail": (row["tail"][:8] if row["tail"] else None),
                "unsigned": row["unsigned"],
                "metrics": _log_json_metrics(rows, index, metrics),
                "breached": sorted(m for m in metrics if m in row["breached"]),
            }
            tolerance = tol_by_tail.get(row["tail"])
            if isinstance(tolerance, dict):
                if tolerance.get("band") is not None:
                    entry["band"] = tolerance["band"]
                if tolerance.get("settle_hours") is not None:
                    entry["settle_hours"] = tolerance["settle_hours"]
            return entry

        payload = {
            "granularity": granularity,
            # Total runs collapsed away by the granularity (rendered rows hide
            # this many same-period runs). Ordered chronological (oldest first).
            "collapsed": collapsed,
            "runs": [_run_entry(index, row) for index, row in enumerate(rows)],
        }
        print(_json.dumps(payload, indent=2))
        return 0

    for line in _render_log_table(rows, metrics):
        print(line)
    print("u = unsigned snapshot (weaker evidence); ! = breached in that run")
    return 0


def _log_json_metrics(rows: list[dict], index: int, metrics: list[str]) -> dict:
    """Per-metric {value, delta?} for one JSON row. value is the display string
    (or "-" when absent); delta is the signed delta vs the previous rendered
    row that had a value (omitted on the first such row)."""
    out: dict[str, dict] = {}
    for metric in metrics:
        value = rows[index]["values"].get(metric)
        if value is None:
            out[metric] = {"value": "-"}
            continue
        entry = {"value": value}
        prior = _previous_log_value(rows, index, metric)
        if prior is not None:
            delta = _log_delta(prior, value)
            if delta is not None:
                entry["delta"] = delta
        out[metric] = entry
    return out


def cmd_anchor(args: argparse.Namespace) -> int:
    """Anchor chain.json in the Sigstore transparency log."""
    import json as _json

    from .anchor import AnchorUnavailable, anchor_chain, anchor_path_for

    try:
        record = anchor_chain(args.chain, staging=args.staging)
    except AnchorUnavailable as exc:
        if args.json:
            print(_json.dumps({"ok": False, "error": str(exc)}, indent=2))
        else:
            print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - OIDC/network failures get a clean line, not a traceback
        if args.json:
            print(_json.dumps({"ok": False, "error": f"Anchor failed: {exc}"}, indent=2))
        else:
            print(f"Anchor failed: {exc}", file=sys.stderr)
        return 1
    if args.json:
        payload = {
            "ok": True,
            **{k: record[k] for k in ("anchored", "instance", "identity", "issuer", "integrated_time")},
            "anchor_path": str(anchor_path_for(args.chain)),
        }
        print(_json.dumps(payload, indent=2))
        return 0
    print(f"⚓ Anchored {record['anchored']} in the Sigstore {record['instance']} log")
    print(f"  identity {record['identity']} (issuer {record['issuer']})")
    print(f"  integrated at {record['integrated_time'] or '(time not recorded by this log)'}")
    print(f"  anchor record -> {anchor_path_for(args.chain)}")
    print("Re-run after every pipeline run that changes the chain; verify with: receipts verify --anchor")
    return 0


def _check_anchor(
    chain_path: str,
    code: int,
    emit: Callable[[str], None],
    *,
    identity: str | None = None,
    issuer: str | None = None,
    allow_staging: bool = False,
    covers_receipts: bool = True,
) -> int:
    """Fold anchor verification into the verify verdict and exit code.

    covers_receipts says whether chain.json records receipt hashes; when it
    does not (older chains), a passing anchor still gets a yellow caveat
    because it witnesses only the filename manifest, not receipt contents.
    """
    from .anchor import AnchorUnavailable, anchor_path_for, verify_anchor

    anchor_file = anchor_path_for(chain_path)
    if not anchor_file.exists():
        emit("⚠ no anchor found; run `receipts anchor` to prove existence at a point in time")
        return max(code, 2) if code != 1 else code
    try:
        info = verify_anchor(
            chain_path, identity=identity, issuer=issuer, allow_staging=allow_staging
        )
    except AnchorUnavailable as exc:
        emit(f"⚠ anchor present but not checkable: {exc}")
        return max(code, 2) if code != 1 else code
    except Exception as exc:  # noqa: BLE001
        # Transport/TUF failures mean "could not check", not "tampered":
        # an offline machine or a Sigstore outage must never read as red.
        emit(f"⚠ anchor present but not checkable: {exc}")
        return max(code, 2) if code != 1 else code
    if info["ok"]:
        log_name = "Sigstore staging log" if info.get("instance") == "staging" else "Sigstore log"
        pin = "pinned" if identity else "recorded in anchor; pin with --anchor-identity"
        when = info["integrated_time"] or "the logged time"
        emit(
            f"⚓ anchored: this exact chain existed at {when} "
            f"({log_name}, identity {info['identity']}, {pin})"
        )
        if not covers_receipts:
            emit(
                "⚠ anchor covers chain.json only: this chain records no receipt "
                "hashes (written by an older version); re-run the pipeline and "
                "re-anchor so the anchor witnesses receipt contents"
            )
            return max(code, 2) if code != 1 else code
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
    p_ingest.add_argument(
        "--band",
        default=None,
        help='Declared tolerance band for cross-run drift, e.g. "5%%" or "0.05" '
        "(signed into the manifest; --settle defaults to 72h)",
    )
    p_ingest.add_argument(
        "--settle",
        default=None,
        help='Declared settling window, e.g. "72h" or "3d" '
        '(signed into the manifest; --band defaults to "0.05")',
    )
    p_ingest.add_argument(
        "--bucket-column",
        default=None,
        help="Column to key period buckets off (signed into the tolerance "
        "declaration; must be a date-shaped column)",
    )
    p_ingest.add_argument(
        "--as",
        dest="mode",
        choices=["replace", "period"],
        default="replace",
        help="replace (default): re-sign a fresh chain (the prior chain is archived). "
        "period: continue the chain's run history as the next period (trusted signer only)",
    )
    p_ingest.add_argument(
        "--pub",
        action="append",
        default=[],
        help="Public key to trust for --as period (repeatable); needed when the "
        "importer's key differs from the chain's signing key",
    )
    p_ingest.add_argument(
        "--json",
        action="store_true",
        help="Emit a structured JSON result instead of the text summary",
    )
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
    p_verify.add_argument(
        "--anchor-staging",
        action="store_true",
        help="Accept an anchor made against the Sigstore staging instance "
        "(rejected by default so anchor.json cannot pick a weaker trust root)",
    )
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
    p_doctor.add_argument(
        "--json",
        action="store_true",
        help="Emit the check results as JSON instead of the text report",
    )
    p_doctor.set_defaults(func=cmd_doctor)

    p_export = sub.add_parser(
        "export",
        help="Write the canonical table document (table.json) for the verified Data tab",
    )
    p_export.add_argument("--chain", default="receipts/chain.json", help="Path to chain.json")
    p_export.add_argument("--data", required=True, help="Data file that must match the final receipt")
    p_export.add_argument(
        "--out",
        default=None,
        help="Output path (default: <chain dir>/table.json, or <data stem>-verified.zip with --bundle)",
    )
    p_export.add_argument("--sheet", default=None, help="Worksheet name (xlsx only, optional)")
    p_export.add_argument(
        "--bundle",
        action="store_true",
        help="Write a verified bundle (zip of the data file + chain.json + receipts) for offline re-verification",
    )
    p_export.add_argument(
        "--json",
        action="store_true",
        help="Emit a structured JSON result instead of the text summary",
    )
    p_export.set_defaults(func=cmd_export)

    p_diff = sub.add_parser(
        "diff",
        help="Compare two runs: per-stage code-hash changes and totals deltas "
        "(read-only; exit 0 with or without differences)",
    )
    p_diff.add_argument(
        "runs",
        nargs="*",
        help="Up to two runs: chain directories or run-snapshot files. "
        "Zero args: current chain vs the latest differing archived snapshot. "
        "One arg: that run vs the current chain.",
    )
    p_diff.add_argument(
        "--chain",
        default="receipts/",
        help="Current chain directory (or chain.json path) used when fewer "
        "than two runs are given",
    )
    p_diff.add_argument(
        "--json",
        action="store_true",
        help="Emit the structured diff as JSON instead of the text report",
    )
    p_diff.set_defaults(func=cmd_diff)

    p_log = sub.add_parser(
        "log",
        help="Render archived run history as a per-metric trend across runs "
        "(read-only; exit 0)",
    )
    p_log.add_argument(
        "--chain",
        default="receipts/",
        help="Chain directory (or chain.json path) whose history/ to read",
    )
    p_log.add_argument(
        "--granularity",
        default="day",
        help="Collapse runs per period: day, week, month, or quarter (default day)",
    )
    p_log.add_argument(
        "--metric",
        action="append",
        default=None,
        help="Metric to trend (row_count or a numeric_sums column); repeat to "
        "add more. Default: row_count plus every final-stage numeric sum",
    )
    p_log.add_argument(
        "--pub",
        action="append",
        default=None,
        help="Trusted public key (.pub) path for snapshot signatures; repeat "
        "for key rotation",
    )
    p_log.add_argument(
        "--json",
        action="store_true",
        help="Emit the structured trend as JSON instead of the text table",
    )
    p_log.set_defaults(func=cmd_log)

    p_anchor = sub.add_parser(
        "anchor",
        help="Anchor chain.json in the Sigstore transparency log (needs tamper-signal[anchor])",
    )
    p_anchor.add_argument("--chain", default="receipts/chain.json", help="Path to chain.json")
    p_anchor.add_argument("--staging", action="store_true", help="Use the Sigstore staging instance")
    p_anchor.add_argument(
        "--json",
        action="store_true",
        help="Emit the anchor record as JSON (without the bundle) instead of text",
    )
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

    # Give every subcommand a --no-color flag (opt out at any position after the
    # subcommand). NO_COLOR / FORCE_COLOR env vars are honored independently.
    for subparser in sub.choices.values():
        subparser.add_argument(
            "--no-color",
            action="store_true",
            help="Disable colored output (overrides FORCE_COLOR and TTY detection)",
        )

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # --no-color always wins over the environment and isatty; record it before
    # any command renders.
    color.set_no_color(getattr(args, "no_color", False))
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
