"""The @receipt_step transform decorator.

A wrapped function takes a list-of-dicts or a pandas DataFrame and returns
the same kind of structure. On each
call the decorator: verifies the existing chain tail, asserts the input's
semantic hash matches the tail's output hash (hard error if not), runs the
function, hashes the source of the *undecorated* function, computes the output
hash + control totals, signs, appends the receipt, and updates chain.json.
"""

from __future__ import annotations

import functools
import inspect
import os
from pathlib import Path
from typing import Any, Callable

from .adapters import to_records
from .canonical import (
    decimal_to_plain_string,
    evidence_hash,
    load_records,
    normalize_header,
    semantic_hash,
)
from .keys import load_private_key, public_hex_from_private
from .receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    build_transform_receipt,
    code_hash_of,
    load_receipts,
    next_receipt_filename,
    output_hash_of,
    read_chain_files,
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
    # Parse the declaration before touching anything: an invalid value must
    # raise with nothing written and the existing chain untouched.
    tolerance, bucket_name = _build_tolerance(band, settle, bucket_column)

    source_path = Path(file)
    raw = source_path.read_bytes()
    records = load_records(str(source_path), sheet=sheet)
    private_key = load_private_key(key_path)
    public_hex = public_hex_from_private(private_key)
    # A declared bucket_column that fails detection raises ValueError here,
    # before any write -- same as an invalid band/settle above.
    manifest = build_source_manifest(
        filename=source_path.name,
        evidence_hash=evidence_hash(raw),
        byte_size=len(raw),
        declared_origin=origin,
        semantic_hash=semantic_hash(records),
        records=records,
        private_key=private_key,
        tolerance=tolerance,
        bucket_column=bucket_name,
    )
    write_receipt(chain_dir, SOURCE_RECEIPT_NAME, manifest)
    write_chain(chain_dir, [SOURCE_RECEIPT_NAME], public_hex)
    return {
        "manifest": manifest,
        "records": records,
        "source_hash": manifest["semantic_hash"],
        "chain_dir": chain_dir,
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
            return output

        return wrapper

    return decorator
