"""The @receipt_step transform decorator.

A wrapped function takes a list-of-dicts or a pandas DataFrame and returns
the same kind of structure. On each
call the decorator: verifies the existing chain tail, asserts the input's
semantic hash matches the tail's output hash (hard error if not), runs the
function, hashes the source of the *undecorated* function, computes the output
hash + control totals, signs, appends the receipt, and updates chain.json.
"""

from __future__ import annotations

import contextlib
import functools
import inspect
import os
from pathlib import Path
from typing import Any, Callable

try:  # POSIX advisory locking for the watcher's judge->commit transaction
    import fcntl as _fcntl
except ImportError:  # pragma: no cover - Windows; the watcher targets POSIX
    _fcntl = None

from .adapters import to_records
from .canonical import (
    canonical_document,
    decimal_to_plain_string,
    evidence_hash,
    load_records,
    normalize_header,
    semantic_hash,
)
from .keys import load_private_key, public_hex_from_private
from .receipts import (
    CHAIN_FILENAME,
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    build_transform_receipt,
    code_hash_of,
    commit_source_reset,
    load_receipts,
    next_receipt_filename,
    output_hash_of,
    read_chain,
    read_chain_files,
    read_receipt,
    recover_torn_commit,
    verify_chain,
    write_chain,
    write_receipt,
)


# Tolerance declaration defaults: a producer who states only a band gets the
# default settling window, and vice versa (R5). Mirrors node/wrapper.js.
DEFAULT_BAND = "0.05"
DEFAULT_SETTLE_HOURS = 72


def parse_band(text: str) -> str:
    """Normalize a band declaration to its canonical plain decimal string.

    Accepts percent forms ("5%", "5 %", "5.5%") and plain fractions ("0.05").
    The canonical form is the plain decimal string the totals serializer
    produces, so "5%", "0.05" and "0.050" all normalize to "0.05". Bands must
    be greater than zero and at most 100%. The result is a STRING because
    floats never enter signed bodies.
    """
    from decimal import Decimal, InvalidOperation

    raw = text.strip()
    is_percent = raw.endswith("%")
    if is_percent:
        raw = raw[:-1].strip()
    try:
        value = Decimal(raw)
    except (InvalidOperation, ValueError):
        raise ValueError(f"invalid --band '{text}': not a number (try 5% or 0.05)") from None
    if not value.is_finite():
        raise ValueError(f"invalid --band '{text}': not a number (try 5% or 0.05)")
    if is_percent:
        value = value / Decimal(100)
    if value <= 0:
        raise ValueError(f"invalid --band '{text}': must be greater than zero")
    if value > 1:
        raise ValueError(f"invalid --band '{text}': must not exceed 100%")
    band = decimal_to_plain_string(value)
    if band == "0":
        # Positive but below the six-place quantum: quantizes to zero.
        raise ValueError(f"invalid --band '{text}': must be greater than zero")
    return band


def parse_settle(text: str) -> int:
    """Parse a settling window to whole hours: "72", "72h", or "3d"."""
    raw = text.strip().lower()
    multiplier = 1
    if raw.endswith("h"):
        raw = raw[:-1].strip()
    elif raw.endswith("d"):
        raw = raw[:-1].strip()
        multiplier = 24
    if not (raw.isascii() and raw.isdigit()):
        raise ValueError(
            f"invalid --settle '{text}': expected a whole number of hours like 72, 72h, or 3d"
        )
    hours = int(raw) * multiplier
    if hours <= 0:
        raise ValueError(f"invalid --settle '{text}': must be a positive number of hours")
    return hours


def _build_tolerance(
    band: str | None, settle: str | None, bucket_column: str | None
) -> tuple[dict[str, Any] | None, str | None]:
    """Build the signed tolerance declaration from ingest options.

    Any option creates a declaration (missing parts take the defaults); none
    means no tolerance field at all, so a chain without a declaration verifies
    byte-identically to one minted before declarations existed. Invalid values
    raise ValueError before anything is written. Mirrors node/wrapper.js
    buildTolerance.
    """
    if band is None and settle is None and bucket_column is None:
        return None, None
    tolerance: dict[str, Any] = {
        "band": parse_band(band) if band else DEFAULT_BAND,
        "settle_hours": parse_settle(settle) if settle else DEFAULT_SETTLE_HOURS,
    }
    bucket_name = None
    if bucket_column:
        bucket_name = normalize_header(bucket_column)
        tolerance["bucket_column"] = bucket_name
    return tolerance, bucket_name


def ingest_file(
    file: str,
    *,
    origin: str = "",
    chain_dir: str = "receipts/",
    key_path: str = "keys/signing.key",
    band: str | None = None,
    settle: str | None = None,
    bucket_column: str | None = None,
    sheet: str | None = None,
) -> dict[str, Any]:
    """Ingest a source file: build a signed source manifest and (re)write
    chain.json so it lists only that source.

    The programmatic equivalent of `receipts ingest`. It RESETS the chain to
    its source, which is the idempotent foundation for "rebuild on data
    change": call it again and the chain starts fresh from the source.

    Tolerance: passing any of `band` ("5%", "0.05"), `settle` ("72h", "3d"),
    or `bucket_column` records a signed tolerance declaration in the manifest
    (missing parts take the defaults); a Python pipeline can thus declare its
    own continuity tolerance without shelling out to the CLI. Invalid values
    (and a non-qualifying `bucket_column`) raise ValueError before anything is
    written, leaving the existing chain untouched. No options means no
    tolerance field. Mirrors node/wrapper.js ingestFile.

    Returns {"manifest", "records", "source_hash", "chain_dir"}.
    """
    manifest, records, public_hex = _build_source_candidate(
        file,
        origin=origin,
        key_path=key_path,
        band=band,
        settle=settle,
        bucket_column=bucket_column,
        sheet=sheet,
    )
    write_receipt(chain_dir, SOURCE_RECEIPT_NAME, manifest)
    write_chain(chain_dir, [SOURCE_RECEIPT_NAME], public_hex)
    return {
        "manifest": manifest,
        "records": records,
        "source_hash": manifest["semantic_hash"],
        "chain_dir": chain_dir,
    }


def _build_source_candidate(
    file: str,
    *,
    origin: str = "",
    key_path: str = "keys/signing.key",
    band: str | None = None,
    settle: str | None = None,
    bucket_column: str | None = None,
    sheet: str | None = None,
    identity: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    """Build a signed source manifest + records in memory, writing nothing.

    The pure half of `ingest_file`, shared with `judge_candidate_period` so the
    watcher can judge a candidate before committing it. Invalid tolerance or a
    non-qualifying bucket column raises ValueError here, before any caller
    writes -- preserving `ingest_file`'s "nothing written on bad input" contract.

    `identity` overrides the manifest's `source.filename`. The watcher passes a
    STABLE synthetic id so `judge_cross_run` (which matches history by filename)
    engages across ticks even though each tick reads a throwaway temp file
    (KTD11); the default (None) keeps the real file's basename as before.
    Returns (manifest, records, public_hex).
    """
    tolerance, bucket_name = _build_tolerance(band, settle, bucket_column)
    source_path = Path(file)
    raw = source_path.read_bytes()
    records = load_records(str(source_path), sheet=sheet)
    private_key = load_private_key(key_path)
    public_hex = public_hex_from_private(private_key)
    manifest = build_source_manifest(
        filename=identity or source_path.name,
        evidence_hash=evidence_hash(raw),
        byte_size=len(raw),
        declared_origin=origin,
        semantic_hash=semantic_hash(records),
        records=records,
        private_key=private_key,
        tolerance=tolerance,
        bucket_column=bucket_name,
    )
    return manifest, records, public_hex


class UntrustedSignerError(RuntimeError):
    """Append-period import attempted under a signer the chain does not trust."""


class StaleCandidateError(RuntimeError):
    """A judged period candidate could not be committed: the chain advanced
    since it was judged, so committing it would overwrite newer data."""


@contextlib.contextmanager
def _chain_lock(chain_dir: str):
    """Advisory single-writer lock for a judge->commit transaction.

    POSIX `flock` on a lock file in the chain dir; a no-op where `fcntl` is
    unavailable (Windows). The watcher's tail-assert is the real correctness
    guard; the lock just serializes concurrent writers (a daemon and a manual
    accept) so they take turns rather than interleave.
    """
    if _fcntl is None:
        yield
        return
    Path(chain_dir).mkdir(parents=True, exist_ok=True)
    fd = os.open(str(Path(chain_dir) / ".chain.lock"), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        _fcntl.flock(fd, _fcntl.LOCK_EX)
        yield
    finally:
        _fcntl.flock(fd, _fcntl.LOCK_UN)
        os.close(fd)


def _chain_tail_hash(chain_dir: str) -> str | None:
    """The current chain's tail receipt content hash, or None if no chain."""
    chain_path = Path(chain_dir) / CHAIN_FILENAME
    if not chain_path.is_file():
        return None
    chain = read_chain(str(chain_path))
    names = chain.get("receipts") or []
    hashes = chain.get("receipt_hashes") or {}
    return hashes.get(names[-1]) if names else None


def append_period(
    file: str,
    *,
    origin: str = "",
    chain_dir: str = "receipts/",
    key_path: str = "keys/signing.key",
    trusted_pub_hexes: tuple[str, ...] | list[str] = (),
    band: str | None = None,
    settle: str | None = None,
    bucket_column: str | None = None,
    sheet: str | None = None,
) -> dict[str, Any]:
    """Import a file as the next period of an existing chain's run history.

    Continues history only under a trusted signer. The importer's key must be
    the existing chain's key or supplied as trusted via `trusted_pub_hexes`
    (the CLI's --pub): a run snapshot signed under an untrusted key would be
    silently dropped by verification, so "judged and yellow under an unknown
    key" cannot exist. An untrusted signer is refused (UntrustedSignerError)
    with guidance to use replace instead.

    Inherits the prior run's signed tolerance when the caller overrides none of
    band/settle/bucket, so omitting a band cannot silently drop judgment. Then
    re-ingests the file (as a daily run would), judges the new run against prior
    trusted snapshots, and archives the new snapshot with the `breached`
    baseline guard computed BEFORE the write (a breached value must not become
    the next clean baseline). Mirrors node/wrapper.js appendPeriod.

    Returns ingest_file's result plus {"caveats", "details", "breached",
    "compared"}.
    """
    candidate, judgment = judge_candidate_period(
        file,
        origin=origin,
        chain_dir=chain_dir,
        key_path=key_path,
        trusted_pub_hexes=trusted_pub_hexes,
        band=band,
        settle=settle,
        bucket_column=bucket_column,
        sheet=sheet,
    )
    return commit_period(candidate, judgment, chain_dir=chain_dir, key_path=key_path)


def _inherit_period_tolerance(
    prior_chain: dict[str, Any],
    chain_dir: str,
    band: str | None,
    settle: str | None,
    bucket_column: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Inherit the prior run's signed tolerance unless the caller overrides it,
    so the prior declared band keeps governing and omitting a band cannot drop
    it. Read-only. Returns the resolved (band, settle, bucket_column)."""
    if not (band is None and settle is None and bucket_column is None):
        return band, settle, bucket_column
    names = prior_chain.get("receipts") or []
    prior_tol = None
    if names:
        try:
            prior_tol = read_receipt(chain_dir, names[0]).get("tolerance")
        except (ValueError, OSError):
            prior_tol = None
    if isinstance(prior_tol, dict):
        if isinstance(prior_tol.get("band"), str):
            band = prior_tol["band"]
        if isinstance(prior_tol.get("settle_hours"), int) and not isinstance(
            prior_tol.get("settle_hours"), bool
        ):
            settle = f"{prior_tol['settle_hours']}h"
        if isinstance(prior_tol.get("bucket_column"), str):
            bucket_column = prior_tol["bucket_column"]
    return band, settle, bucket_column


def judge_candidate_period(
    file: str,
    *,
    origin: str = "",
    chain_dir: str = "receipts/",
    key_path: str = "keys/signing.key",
    trusted_pub_hexes: tuple[str, ...] | list[str] = (),
    band: str | None = None,
    settle: str | None = None,
    bucket_column: str | None = None,
    sheet: str | None = None,
    identity: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build the next period's candidate in memory and judge it, WITHOUT writing.

    The judge half of `append_period`. `judge_cross_run` is pure and disk-free,
    so the candidate (a signed source manifest plus the chain dict listing only
    it) can be judged against the existing run snapshots with no mutation. The
    watcher inspects the returned judgment to decide commit (clean) vs withhold
    (any caveat). Returns (candidate, judgment); `candidate` carries everything
    `commit_period` needs, including the chain tail it was judged against.
    """
    from .history import judge_cross_run, load_snapshots

    chain_path = Path(chain_dir) / CHAIN_FILENAME
    if not chain_path.is_file():
        raise UntrustedSignerError(
            f"no existing chain at {chain_path} to continue; use replace to start a chain"
        )
    # Heal a torn commit from a prior crashed tick before judging, so the no-op
    # gate and base_tail see a consistent chain (the watcher self-heals here even
    # if the feed is stable and would otherwise never trigger a rewrite).
    recover_torn_commit(chain_dir)
    prior_chain = read_chain(str(chain_path))
    prior_key = prior_chain.get("public_key")

    # Capture the tail the judgment is about to be computed against BEFORE
    # loading snapshots — not after. `commit_period` refuses to write unless the
    # on-disk tail still equals this value, so sampling it up front makes the
    # assert cover the whole judge window: a concurrent writer that commits
    # between here and the snapshot read forces a StaleCandidateError (re-judge)
    # rather than slipping a clean verdict computed against pre-commit snapshots.
    prior_names = prior_chain.get("receipts") or []
    prior_hashes = prior_chain.get("receipt_hashes") or {}
    base_tail = prior_hashes.get(prior_names[-1]) if prior_names else None

    importer_hex = public_hex_from_private(load_private_key(key_path))
    trusted = {k for k in [prior_key, *trusted_pub_hexes] if k}
    if importer_hex not in trusted:
        raise UntrustedSignerError(
            "append-period continues history only under a trusted signer; the importer "
            "key is neither the chain's key nor passed as trusted. Use replace to "
            "re-attest under a new identity, or pass the prior signer's public key."
        )

    band, settle, bucket_column = _inherit_period_tolerance(
        prior_chain, chain_dir, band, settle, bucket_column
    )
    manifest, records, public_hex = _build_source_candidate(
        file, origin=origin, key_path=key_path, band=band, settle=settle,
        bucket_column=bucket_column, sheet=sheet, identity=identity,
    )

    # Judge the in-memory candidate. The candidate chain lists only the new
    # source; receipt_hashes are unneeded for judgment (the run's own snapshot
    # is not on disk yet, so self-exclusion no-ops either way).
    candidate_chain = {
        "spec_version": manifest.get("spec_version"),
        "public_key": public_hex,
        "receipts": [SOURCE_RECEIPT_NAME],
    }
    trusted_keys = sorted(trusted | {importer_hex})
    items = load_snapshots(chain_dir, trusted_keys=trusted_keys)
    judgment = judge_cross_run(
        [manifest], candidate_chain, [item["snapshot"] for item in items]
    )

    # Does prior history exist under THIS candidate's own identity? The watcher
    # uses it to tell an establishing first append (only foreign snapshots — e.g.
    # a seed ingested under its filename, or a verify's snapshot — so nothing to
    # judge against yet) from a real anomaly (its own history exists but could
    # not be judged). Only the latter is a refuse-to-append condition (KTD11).
    candidate_identity = manifest["source"]["filename"]
    own_history = any(
        isinstance(item.get("snapshot"), dict)
        and (item["snapshot"].get("source") or {}).get("filename") == candidate_identity
        for item in items
    )

    candidate = {
        "manifest": manifest,
        "records": records,
        "public_hex": public_hex,
        "base_tail": base_tail,
        "chain_dir": chain_dir,
        "key_path": key_path,
        "trusted_keys": trusted_keys,
        "compared": bool(items),
        "own_history": own_history,
    }
    return candidate, judgment


def commit_period(
    candidate: dict[str, Any],
    judgment: dict[str, Any],
    *,
    chain_dir: str | None = None,
    key_path: str | None = None,
) -> dict[str, Any]:
    """Write a judged candidate: source manifest, chain reset, and run snapshot
    (with the `breached` baseline guard). The commit half of `append_period`.

    Refuses with `StaleCandidateError` if the chain tail moved since the
    candidate was judged (a concurrent tick, a daemon overlap, or a delayed
    accept), rather than committing a guard computed against a stale view.
    Returns the same shape `append_period` always returned.
    """
    from .history import archive_run_snapshot

    chain_dir = chain_dir or candidate["chain_dir"]
    key_path = key_path or candidate["key_path"]
    with _chain_lock(chain_dir):
        # Heal any commit a prior crash left half-applied before reading the tail.
        recover_torn_commit(chain_dir)
        if _chain_tail_hash(chain_dir) != candidate["base_tail"]:
            raise StaleCandidateError(
                "the chain advanced since this candidate was judged; re-judge before committing"
            )
        # Journaled reset: 000_source.json + chain.json land as one crash-safe
        # transaction (byte-identical to the prior write_receipt+write_chain).
        commit_source_reset(chain_dir, candidate["manifest"], candidate["public_hex"])
        chain = read_chain(str(Path(chain_dir) / CHAIN_FILENAME))
        receipts = [read_receipt(chain_dir, name) for name in chain.get("receipts", [])]
        archive_run_snapshot(
            chain_dir,
            chain,
            receipts,
            key=load_private_key(key_path),
            trusted_keys=candidate["trusted_keys"],
            breached=judgment.get("breached") or None,
        )

    return {
        "manifest": candidate["manifest"],
        "records": candidate["records"],
        "source_hash": candidate["manifest"]["semantic_hash"],
        "chain_dir": chain_dir,
        "caveats": judgment.get("caveats", []),
        "details": judgment.get("details", []),
        "breached": judgment.get("breached", {}),
        "compared": candidate["compared"],
    }


class ChainTailMismatch(RuntimeError):
    """Raised when input data does not descend from the chain tail."""


def _resolve_code_file(func: Callable[..., Any]) -> str:
    """Repo-relative path to the function's source file, best effort."""
    try:
        absolute = inspect.getsourcefile(func) or inspect.getfile(func)
    except TypeError:
        return "<unknown>"
    if not absolute:
        return "<unknown>"
    try:
        return os.path.relpath(absolute)
    except ValueError:
        return absolute


def receipt_step(
    chain_dir: str = "receipts/",
    key_path: str = "keys/signing.key",
    code_file: str | None = None,
    write_table: bool = False,
):
    """Decorate a transform with signed receipts.

    The transform takes and returns either a list-of-dicts or a pandas
    DataFrame; frames are converted to records for hashing only and pass
    through the function untouched.

    Args:
        chain_dir: directory holding chain.json and receipt files.
        key_path: PKCS8 PEM Ed25519 private key used to sign the receipt.
        code_file: override for the recorded source path (defaults to the
            function's own file, resolved relative to the cwd).
        write_table: also write ``<chain_dir>/table.json`` (the canonical
            table document of this stage's output) after the receipt, so the
            Signal Room's landing plane always matches the chain tail. Pass
            it on your FINAL stage — it is the ``receipts export`` step,
            minus the manual step to forget.
    """

    def decorator(func: Callable[..., list[dict[str, Any]]]):
        @functools.wraps(func)
        def wrapper(records: list[dict[str, Any]], *args: Any, **kwargs: Any):
            existing = read_chain_files(chain_dir)
            if not existing:
                raise ChainTailMismatch(
                    f"No chain found in {chain_dir!r}; run `receipts ingest` first."
                )

            # Load the key up front so we can verify the existing chain with the
            # same key we will sign the new receipt with.
            private_key = load_private_key(key_path)
            public_hex = public_hex_from_private(private_key)

            # Verify the existing chain (signatures + links) BEFORE extending it,
            # so we never append onto a chain that is already broken or carries
            # invalid signatures.
            receipts = load_receipts(chain_dir)
            chain_result = verify_chain(receipts, public_hex)
            if not chain_result.ok:
                raise ChainTailMismatch(
                    "Existing chain failed verification; refusing to extend it:\n"
                    + "\n".join(chain_result.lines)
                )

            # Assert the input descends from the chain tail BEFORE running.
            # DataFrames convert to records for hashing only; the user's
            # function receives whatever the caller passed, untouched.
            tail = receipts[-1]
            tail_output = output_hash_of(tail)
            input_hash = semantic_hash(to_records(records, context="input"))
            if input_hash != tail_output:
                raise ChainTailMismatch(
                    "Input data does not match the chain tail output hash.\n"
                    f"  chain tail output: {tail_output}\n"
                    f"  provided input:    {input_hash}\n"
                    "Refusing to append a receipt for data that did not come "
                    "from the previous stage."
                )

            output = func(records, *args, **kwargs)
            output_records = to_records(output, context="output")
            output_hash = semantic_hash(output_records)

            # functools.wraps sets __wrapped__ to the undecorated function, so we
            # hash the original source even when other decorators stack on top.
            undecorated = getattr(func, "__wrapped__", func)
            receipt = build_transform_receipt(
                name=func.__name__,
                code_hash=code_hash_of(undecorated),
                code_file=code_file or _resolve_code_file(undecorated),
                input_semantic_hash=input_hash,
                output_semantic_hash=output_hash,
                output_records=output_records,
                private_key=private_key,
            )

            filename = next_receipt_filename(chain_dir, func.__name__)
            write_receipt(chain_dir, filename, receipt)
            write_chain(chain_dir, existing + [filename], public_hex)
            if write_table:
                import json as _json

                document = canonical_document(output_records)
                (Path(chain_dir) / "table.json").write_text(
                    _json.dumps(document, indent=2) + "\n", encoding="utf-8"
                )
            return output

        return wrapper

    return decorator
