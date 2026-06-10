---
title: "Numeric text skipped decimal coercion, so the same data hashed differently per file format"
date: 2026-06-10
category: logic-errors
module: tamper_signal.canonical
problem_type: logic_error
component: service_object
symptoms:
  - "New cross-format test failed for CSV only (AssertionError: .csv); xlsx, JSON, and NDJSON all matched"
  - "Float 30.0 canonicalized to leaf '30' while CSV-loaded text '30.0' canonicalized to '30.0'"
  - "An innocent xlsx-to-CSV conversion with trailing-zero decimals would flip the tamper verdict to a false red"
  - "Pre-existing numeric-equivalence test passed by luck; its only text fixture '1' equals its own canonical form"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - testing_framework
tags:
  - canonicalization
  - semantic-hash
  - cross-format-stability
  - csv-ingest
  - false-tamper-alarm
  - spec-version-bump
  - golden-vectors
  - decimal-quantization
---

# Numeric text skipped decimal coercion, so the same data hashed differently per file format

## Problem

`normalize_cell()` in `tamper_signal/canonical.py` left string cells as text, so numeric text like `"30.0"` (what a CSV export produces for the float `30.0`) canonicalized to the leaf `"30.0"` while the float canonicalized to `"30"`. That broke the module's core promise that the semantic hash is identical across file formats, and surfaced only when CSV/JSON loaders were added (fix: commit `6bdbd99`, spec 1.1).

## Symptoms

- New test failure, CSV only: `AssertionError: .csv` from `test_same_data_hashes_identically_across_formats`, which writes the same records as xlsx, CSV, JSON, and NDJSON and asserts one hash.
- Byte-level diff of `canonicalize()` output isolated it: same value, two canonical byte sequences, two hashes.

  ```
  mem : ... ["c","2026-05-03","300","30"]   (float 30.0)
  csv : ... ["c","2026-05-03","300","30.0"] (text "30.0")
  ```
- User-facing failure mode (pre-release, never shipped): convert an xlsx export to CSV (which stringifies numbers, often with trailing zeros like `"30.00"`) and the verifier flips to a false red tamper verdict. For a tamper-evidence tool, a false alarm on untampered data is the worst failure class.

## What Didn't Work

The bug was found while writing the cross-format test, not by a failed fix attempt. The durable lesson is why the gap survived until then:

- **A coincidentally-passing test.** The one pre-existing equivalence test used `"1"`, which is a fixed point of canonicalization (its text form equals its canonical form), so the un-coerced string branch produced the right bytes by luck. Any non-fixed-point value (`"1.0"`, `"30.00"`, `"030"`) would have caught it.
- **Docstrings asserted behavior the code didn't implement.** The module header promised stability "across format round-trips (xlsx re-save, xlsx -> CSV, xlsx -> JSON)" and `normalize_cell`'s docstring claimed `1, 1.0 and "1" must hash identically`, but the string branch was just NFC + trim.
- **Two subsystems disagreed about numeric text.** `control_totals()` already coerced numeric text into `numeric_sums`, so totals treated `"30.00"` as 30 while hashing treated it as the string `"30.00"`. The codebase had committed to numeric semantics for text everywhere except the one place that mattered for integrity.

## Solution

Coerce numeric-looking text through the same decimal quantizer as real numbers (`tamper_signal/canonical.py`):

Before:

```python
    if isinstance(value, str):
        return _normalize_string(value)
```

After:

```python
    if isinstance(value, str):
        # Numeric-looking text canonicalizes as the number it parses to, so a
        # format round-trip that stringifies numbers (xlsx -> CSV -> JSON)
        # cannot move the hash. Tradeoff: text differing from a number only by
        # leading zeros or trailing decimal zeros ("030", "30.00") collapses
        # to the canonical numeric form. Non-numeric text is untouched.
        d = _coerce_decimal(value)
        if d is not None:
            return decimal_to_plain_string(d)
        return _normalize_string(value)
```

The pieces already existed: `_coerce_decimal` returns `None` for non-numeric and non-finite text (`"Infinity"`, `"NaN"` stay text), and `decimal_to_plain_string` quantizes to six places with `ROUND_HALF_EVEN` in plain decimal notation.

Because the semantic hash is the spec, the change shipped with `SPEC_VERSION` bumped `1.0 -> 1.1` (comment in `tamper_signal/__init__.py` documents which hashes move) and the committed demo fixtures regenerated via `examples/make_demo_chains.py` (the seeded sample contains ~1% numeric-as-text cells).

Regression test using non-fixed-point values:

```python
def test_numeric_text_collapses_to_canonical_form():
    assert (
        semantic_hash([{"x": "30.00"}])
        == semantic_hash([{"x": 30.0}])
        == semantic_hash([{"x": "30"}])
        == semantic_hash([{"x": 30}])
    )
    assert semantic_hash([{"x": "30x"}]) != semantic_hash([{"x": 30}])
    assert semantic_hash([{"x": "Infinity"}]) != semantic_hash([{"x": "NaN"}])
```

## Why This Works

- **Root cause:** the canonical leaf depended on the type the loader happened to produce, not on the value. xlsx yields typed floats; CSV is typeless and yields strings. A format-stable hash requires canonicalization to erase loader-level type distinctions for anything that parses as a number.
- **Coercion is the contract, not a workaround.** CSV has no number type, so `"30.0"` in a CSV is the number 30. After the fix, hashing and `control_totals()` finally agree about what a numeric-text cell means.
- **The spec bump is mandatory.** Any canonicalization change can move hashes for existing data, so it is versioned and fixtures are regenerated; receipts record `spec_version` so a pre/post difference is explainable.
- **The leading-zero tradeoff was accepted deliberately.** `"030"` and `"30.00"` collapse to `"30"`, so leading-zero identifiers collide with their numeric forms. For this product a false tamper alarm is worse than that collision, because false reds destroy trust in the trust tool itself.

## Prevention

- **Golden vectors generated from the reference implementation.** `node/test/vectors.json` maps input records to the exact canonical UTF-8 bytes and sha256 produced by Python (spec 1.1), covering the dangerous cases: numeric text, float artifacts (`0.1 + 0.2`), negative zero, exponent text, NFD unicode, header collisions, midnight-datetime-vs-date, and half-even ties at the sixth decimal. `node/test/canonical.test.js` asserts byte equality, so divergence between `node/canonical.js` and Python is a test failure instead of a production false red. Cross-language acceptance goes both directions: a Node-signed chain verifies under the Python CLI and vice versa.
- **Every new loader joins the cross-format identical-hash test.** The loop in `test_same_data_hashes_identically_across_formats` is exactly the test that caught this; adding a format without adding it to the loop is the regression vector.
- **Treat canonicalization changes as spec changes.** Bump `SPEC_VERSION`, document which hashes move, regenerate committed fixtures and golden vectors in the same commit.
- **Pick test fixtures that are not fixed points of the transform.** `"1"` proved nothing; `"30.00"`, `"030"`, `"1E+2"` distinguish "passed through" from "canonicalized." When a docstring claims an equivalence, test inputs where the equivalence could actually fail.

## Related Issues

- `docs/solutions/design-patterns/multi-format-remotion-scene-pattern.md`: sibling determinism pattern (same repo-wide principle, "identical data must read as identical everywhere," applied to rendered artifacts instead of canonical hashes).
- Issue #14 (cross-platform CI matrix): where the golden-vector cross-language tests should run on every platform.
- Issue #6 (CI recipe, verify on every push): the CI guard that would surface cross-format hash drift in user projects.
- Implementation files: `tamper_signal/canonical.py`, `tamper_signal/totals.py`, `node/canonical.js`, `node/test/vectors.json`, `tests/test_tamper_signal.py`, `examples/make_demo_chains.py`.
