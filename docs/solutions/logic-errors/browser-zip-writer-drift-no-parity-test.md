---
title: Inline browser ZIP writer drifted from node/zip.js with no parity test
date: 2026-06-15
category: docs/solutions/logic-errors/
module: browser export (verified Data tab)
problem_type: logic_error
component: tooling
symptoms:
  - "Browser-built verified bundles carry a malformed central-directory timestamp (date field 0000-00-00); CLI bundles from node/zip.js and Python zipfile do not."
  - "npm test stays green while the inline browser ZIP writer is wrong, because the inline copy has no test (the repo has no browser-DOM harness)."
  - "Byte-comparing the inline writer's output to node/zip.js differs only at the central-directory date bytes."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [zip, byte-identical, parity-test, cross-tree-duplication, browser-export, dual-implementation-drift]
---

# Inline browser ZIP writer drifted from node/zip.js with no parity test

## Problem

The store-only ZIP writer that builds a verified bundle exists in two hand-written
copies — the canonical, unit-tested `node/zip.js` and an inline copy in
`badge/table.js` (the browser "Take your data" export, mirrored byte-for-byte into
`tamper_signal/static/table.js`). The browser tree cannot `import` from `node/`, so
the copy is duplicated by hand. The inline copy drifted: it wrote the DOS date to
the wrong central-directory offset, so browser-produced bundles shipped a malformed
`0000-00-00` timestamp. `node/zip.js` and the Python `zipfile` path were unaffected.

## Symptoms

- Browser-built bundles carried a malformed central-directory date (`0000-00-00`);
  bundles from `node/zip.js` and the Python CLI did not.
- `npm test` stayed green the whole time — the inline copy had no test.
- Byte-comparing the inline writer's output to `node/zip.js` for the same input
  differed at exactly two bytes (the central-directory time/date fields).

## What Didn't Work

- **The existing suite couldn't see it.** `node --test` exercises `node/zip.js`
  (which was correct) but never the inline copy in `badge/table.js`, because that
  copy only runs in a browser DOM the test harness doesn't provide. A green
  `npm test` said nothing about the shipped browser writer.
- **The static-sync guard didn't cover this axis.** `tests/test_integrations.py`
  enforces that `badge/*.js` is byte-identical to `tamper_signal/static/*.js` — but
  that guards the *browser→wheel* copy, not the *`node/zip.js`→inline-`table.js`*
  copy. The drift lived in the one duplication axis no test watched.

## Solution

The ZIP central-directory header puts the **time** at offset 12 and the **date** at
offset 14 (the *local file* header, by contrast, has the date at offset 12 — which
is why the local header looked right and only the central directory was wrong). The
inline copy wrote the date to offset 12 and left offset 14 (date) zero. The
`DataView` is zero-initialized, so offset 14 stayed `0` → an invalid `0000-00-00`.

```js
// badge/table.js — central-directory header, before (wrong):
cd.setUint16(12, 0x21, true);   // wrote DOS date into the TIME field; date (14) left 0

// after (matches node/zip.js):
cd.setUint16(14, 0x21, true);   // DOS date at offset 14; offset 12 (time) intentionally 0
```

Then re-sync the bundled copy so `test_integrations.py` stays green:

```
cp badge/table.js tamper_signal/static/table.js
```

## Why This Works

The attested receipt bytes and the data are unaffected either way — the date is
cosmetic metadata — but a `0000-00-00` central-directory date is malformed and some
strict unzip tools reject or warn on it, so a bundle meant to be *sent to people*
must write it correctly. Offset 14 is the central-directory date slot per the ZIP
spec; writing `0x21` (1980-01-01) there and leaving the zero-initialized time at
offset 12 matches what `node/zip.js` (and Python's `zipfile`) already produce.

## Prevention

- **Byte-parity test for the hand-duplicated copy.** `node/test/zip.test.js` now
  extracts the inline writer from `badge/table.js` (reads the source, slices out the
  `makeStoredZip` block, imports it via a `data:` URL) and asserts its output is
  byte-identical to `node/zip.js` for the same input. This is the test that would
  have caught the bug; it runs in plain `node --test` with no DOM.
- **The rule, generalized:** any logic hand-duplicated across the `node/` and
  `badge/` (browser) trees — because the browser can't import from `node/` — needs a
  byte-parity test, the same discipline the cross-language golden vectors
  (`node/test/vectors.json`) apply to the Python↔Node canonicalization split, and the
  `test_integrations.py` static-sync check applies to the `badge/*.js`→wheel split.
  When you add a third copy of shared logic, add the guard that pins it to the
  reference; a green suite that never exercises the copy is not coverage.
- **Static-asset sync is still required** (memory: edit `badge/*.js` → `cp` to
  `tamper_signal/static/*.js` or `test_integrations.py` fails), but it is a
  *separate* axis from the `node/zip.js`↔inline parity — both must hold.

## Related Issues

- `docs/solutions/logic-errors/numeric-text-canonicalization-cross-format-hash-mismatch.md`
  — the closest sibling on prevention: the same "reference implementation + automated
  byte/golden parity test so the untested copy can't drift" rule, applied there to the
  Python↔Node canonicalization split. This doc extends that rule to the
  browser-can't-import-node duplication axis.
- `docs/solutions/integration-issues/windows-git-autocrlf-receipt-chain-hash-mismatch.md`
  — byte-stability sibling: an invisible byte transformation breaking a byte-sensitive
  artifact, masked by a narrower test path that stayed green.
- GitHub #39 — the verified export / "data portability" feature this writer ships in.
