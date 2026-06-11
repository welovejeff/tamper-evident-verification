// The pill-inversion decision (issue #23): `surface` describes the host page
// and is the primary API; `invert` is its boolean shortcut; `theme: "light"`
// is the deprecated alias kept working for back-compat. shouldInvertPill is
// pure (no DOM), so it unit-tests the precedence directly.

import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldInvertPill } from "../../badge/light.js";

test('surface "dark" inverts the pill (light pill on a dark host)', () => {
  assert.equal(shouldInvertPill({ surface: "dark" }), true);
});

test('surface "light" does not invert (default dark pill on a light host)', () => {
  assert.equal(shouldInvertPill({ surface: "light" }), false);
});

test("invert: true is a shortcut for surface dark", () => {
  assert.equal(shouldInvertPill({ invert: true }), true);
});

test('legacy theme "light" still inverts', () => {
  assert.equal(shouldInvertPill({ theme: "light" }), true);
});

test("no options means the default dark pill (no inversion)", () => {
  assert.equal(shouldInvertPill(), false);
  assert.equal(shouldInvertPill({}), false);
});

test("surface wins over the legacy theme prop when both are set", () => {
  // A user who sets the correct surface for their light host should get the
  // dark pill even if a stale theme="light" lingers.
  assert.equal(shouldInvertPill({ surface: "light", theme: "light" }), false);
  assert.equal(shouldInvertPill({ surface: "dark", theme: "dark" }), true);
});
