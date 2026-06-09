"""The @lineage_step transform decorator.

A wrapped function takes a list-of-dicts and returns a list-of-dicts. On each
call the decorator: verifies the existing chain tail, asserts the input's
semantic hash matches the tail's output hash (hard error if not), runs the
function, hashes the source of the *undecorated* function, computes the output
hash + control totals, signs, appends the receipt, and updates chain.json.
"""

from __future__ import annotations

import functools
import inspect
import os
from typing import Any, Callable

from .canonical import semantic_hash
from .keys import load_private_key, public_hex_from_private
from .receipts import (
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


def lineage_step(
    chain_dir: str = "receipts/",
    key_path: str = "keys/signing.key",
    code_file: str | None = None,
):
    """Decorate a list-of-dicts -> list-of-dicts transform with lineage receipts.

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
                    f"No chain found in {chain_dir!r}; run `lineage ingest` first."
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
            tail = receipts[-1]
            tail_output = output_hash_of(tail)
            input_hash = semantic_hash(records)
            if input_hash != tail_output:
                raise ChainTailMismatch(
                    "Input data does not match the chain tail output hash.\n"
                    f"  chain tail output: {tail_output}\n"
                    f"  provided input:    {input_hash}\n"
                    "Refusing to append a receipt for data that did not come "
                    "from the previous stage."
                )

            output = func(records, *args, **kwargs)
            output_hash = semantic_hash(output)

            # functools.wraps sets __wrapped__ to the undecorated function, so we
            # hash the original source even when other decorators stack on top.
            undecorated = getattr(func, "__wrapped__", func)
            receipt = build_transform_receipt(
                name=func.__name__,
                code_hash=code_hash_of(undecorated),
                code_file=code_file or _resolve_code_file(undecorated),
                input_semantic_hash=input_hash,
                output_semantic_hash=output_hash,
                output_records=output,
                private_key=private_key,
            )

            filename = next_receipt_filename(chain_dir, func.__name__)
            write_receipt(chain_dir, filename, receipt)
            write_chain(chain_dir, existing + [filename], public_hex)
            return output

        return wrapper

    return decorator
