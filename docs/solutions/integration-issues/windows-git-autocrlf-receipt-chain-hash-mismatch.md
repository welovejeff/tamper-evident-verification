---
title: Committed receipt chains verify red on Windows from git autocrlf line-ending rewrites
date: 2026-06-12
category: docs/solutions/integration-issues/
module: tamper_signal/receipts.py
problem_type: integration_issue
component: tooling
symptoms:
  - "receipts verify returns exit 1 (red) on Windows for committed signed-chain fixtures that pass on macOS and Ubuntu"
  - "CLI prints: ✗ RECEIPT FILE MISMATCH: <receipt>.json does not match the hash recorded in chain.json"
  - "cross-stack parity tests fail with assert 1 == 2 on windows-latest only"
  - "examples/chains/intact verifies green on Windows while new CLI-path fixtures go red"
root_cause: config_error
resolution_type: config_change
severity: high
related_components:
  - testing_framework
  - development_workflow
tags:
  - windows
  - git-autocrlf
  - eol-normalization
  - receipt-hashing
  - cross-platform
  - gitattributes
  - ci
  - parity-tests
---

# Committed receipt chains verify red on Windows from git autocrlf line-ending rewrites

## Problem

Committed, valid signed receipt chains verify RED on Windows clones and Windows CI. The chain commits to the sha256 of each receipt file's raw bytes (`receipt_hashes`), and git's default `core.autocrlf=true` on Windows rewrites JSON line endings from LF to CRLF on checkout. The bytes change, the recomputed file hash no longer matches the recorded one, and a chain that is genuinely intact reports as broken.

## Symptoms

- Windows CI fails with `assert 1 == 2`: `receipts verify` exits 1 (red) instead of 2 (yellow) or 0 (green) on committed signed-chain fixtures.
- The CLI prints `✗ RECEIPT FILE MISMATCH: <name>.json does not match the hash recorded in chain.json` (`tamper_signal/receipts.py:426`).
- macOS and Linux CI pass unchanged; only `windows-latest` jobs fail.
- The receipts are valid: the JSON content is semantically identical, only the on-disk bytes differ.

## What Didn't Work

The first hypothesis was uniform line-ending conversion, which would have failed all fixture-based tests together. That was contradicted by `examples/chains/intact` verifying GREEN on Windows while the new parity fixtures went red, and significant time went into reconciling that asymmetry before the real explanation surfaced.

The asymmetry was a false signal from the test layer, not from the data. The example tests use a `_verify_fixture` helper (`tests/test_period_buckets.py:176`) that calls `verify_chain` without the `recorded_hashes` / `actual_hashes` arguments:

```python
# tests/test_period_buckets.py
return verify_chain(
    load_receipts(str(chain_dir)),
    chain["public_key"],
    chain_public_hex=chain["public_key"],
    receipt_names=chain["receipts"],
)
```

With both hash arguments `None`, `verify_chain` skips the raw-byte file check entirely (the gate at `tamper_signal/receipts.py:416` is `if recorded_hashes is not None and actual_hashes is not None:`) and verifies only signatures and links. Signatures are computed over canonical JSON and are whitespace-insensitive, so they pass on a CRLF checkout. The real CLI verify path reads `chain["receipt_hashes"]`, computes `actual_hashes = receipt_file_hashes(...)`, and passes both, so it exercises the byte check the helper skipped. "Examples pass on Windows" was therefore a false negative that nearly ruled out the correct line-ending hypothesis.

## Solution

Add a `.gitattributes` at the repo root forcing LF normalization on all text, and explicitly on the byte-sensitive `*.json` artifacts:

```gitattributes
# Normalize all text to LF in the repository and on checkout, so a Windows
# checkout (where git defaults to core.autocrlf=true) does not rewrite line
# endings. This is load-bearing, not cosmetic: a receipt chain commits to the
# sha256 of each receipt file's RAW bytes (receipt_hashes), so a CRLF checkout
# would change those bytes and make a committed, valid chain verify as broken.
* text=auto eol=lf

# Byte-sensitive committed artifacts: signed receipt chains, run snapshots, and
# the cross-language golden vectors. Read as raw bytes during verification and
# compared across the Python and JS stacks, so they must be byte-identical on
# every platform.
*.json text eol=lf

# Binary assets git should never touch.
*.gif binary
*.png binary
*.jpg binary
*.jpeg binary
*.webp binary
*.mp4 binary
*.woff binary
*.woff2 binary
```

After committing it, run `git add --renormalize .` to apply the rules to tracked files. In this repo that produced no byte churn (all committed JSON was already LF), confirming the bug was a checkout-time rewrite, not a stored-file problem. Windows CI then went fully green.

## Why This Works

`receipt_file_hashes` hashes each receipt file as raw bytes, with no encoding or line-ending normalization (`tamper_signal/receipts.py:230`):

```python
def receipt_file_hashes(chain_dir: str, receipt_files: list[str]) -> dict[str, str]:
    """sha256 of each receipt file's raw bytes, keyed by filename."""
    return {
        name: hashlib.sha256((Path(chain_dir) / name).read_bytes()).hexdigest()
        for name in receipt_files
    }
```

`read_bytes()` reads exactly what is on disk. The hash is computed at chain-write time (on an author machine, always LF) and recorded in `chain.json`. On a Windows checkout without `.gitattributes`, git rewrites every `\n` to `\r\n`, changing the bytes and therefore the digest, even though the JSON is semantically identical.

This is why the two verification layers disagree. The receipt-file hash is a byte-level witness ("this exact file was present when the chain was sealed"). The receipt signature is a canonical-content witness ("this data was produced by this key"), computed over whitespace-insensitive canonical JSON. CRLF conversion breaks the byte witness but not the canonical one, which is exactly the valid-but-broken signature seen here. Forcing `eol=lf` keeps the on-disk bytes at checkout identical to the bytes that were hashed at commit time, on every platform.

## Prevention

- **Commit a `.gitattributes` forcing LF before the first receipt chain lands** in any repo that stores chains, run snapshots, or cross-language golden vectors. The minimum is `* text=auto eol=lf` plus `*.json text eol=lf`. This protects real users too: anyone who clones such a repo and runs `receipts verify` on Windows would otherwise see valid chains verify as broken, not just CI.
- **Test committed signed fixtures through the real CLI verify path, not a helper that omits `recorded_hashes` / `actual_hashes`.** A helper that calls `verify_chain(receipts, key)` without those arguments does not exercise file-byte integrity and stays green on a CRLF checkout, masking exactly this class of fragility. Drive the CLI (or pass both hash maps) so the byte check runs.
- **Keep a `windows-latest` entry in the CI matrix for any job that verifies committed chains.** It catches the byte rewrite on the first PR that adds a fixture chain, before a partial test helper produces a misleading green.

## Related Issues

- `docs/solutions/logic-errors/numeric-text-canonicalization-cross-format-hash-mismatch.md` — the sibling byte-stability failure. That one is "same semantic data, different bytes because a loader represents a value differently across formats," fixed in the canonicalization rules; this one is "same file, different bytes because git rewrote line endings on checkout," fixed with `.gitattributes`. Both are receipt-hash instability from an invisible byte transformation outside the hash function, and both were surfaced by a cross-stack parity test that a narrower test had masked. Its prevention section (cross-platform CI for golden vectors) could note the line-ending dimension and `.gitattributes`.
