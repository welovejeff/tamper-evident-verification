// Mirrors tests/test_color.py: the gating matrix plus verdict/delta conventions.
// Also asserts the SGR palette matches the Python helper byte for byte (pins R15).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setNoColor, shouldColor, light, delta, dim, bold, GREEN, YELLOW, RED, DIM, BOLD, RESET } from "../color.js";

const TTY = { isTTY: true };
const PIPE = { isTTY: false };

beforeEach(() => {
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  setNoColor(false);
});

test("shouldColor: true on a TTY with no overrides", () => {
  assert.equal(shouldColor(TTY), true);
});

test("shouldColor: false when not a TTY", () => {
  assert.equal(shouldColor(PIPE), false);
});

test("shouldColor: NO_COLOR wins even on a TTY (any value)", () => {
  process.env.NO_COLOR = "1";
  assert.equal(shouldColor(TTY), false);
  process.env.NO_COLOR = "";
  assert.equal(shouldColor(TTY), false);
});

test("shouldColor: --no-color flag wins even on a TTY", () => {
  setNoColor(true);
  assert.equal(shouldColor(TTY), false);
});

test("shouldColor: FORCE_COLOR turns on even when piped", () => {
  process.env.FORCE_COLOR = "1";
  assert.equal(shouldColor(PIPE), true);
});

test("shouldColor: NO_COLOR beats FORCE_COLOR", () => {
  process.env.NO_COLOR = "1";
  process.env.FORCE_COLOR = "1";
  assert.equal(shouldColor(TTY), false);
});

test("light: colors each verdict when on", () => {
  process.env.FORCE_COLOR = "1";
  assert.equal(light("green", PIPE), `${GREEN}●${RESET}`);
  assert.equal(light("yellow", PIPE), `${YELLOW}●${RESET}`);
  assert.equal(light("red", PIPE), `${RED}●${RESET}`);
});

test("light: plain glyph when off", () => {
  assert.equal(light("green", PIPE), "●");
  assert.ok(!light("red", PIPE).includes("\x1b"));
});

test("delta: signs and colors direction when on", () => {
  process.env.FORCE_COLOR = "1";
  assert.equal(delta(12, PIPE), `${GREEN}+12${RESET}`);
  assert.equal(delta(-5, PIPE), `${RED}-5${RESET}`);
  assert.equal(delta(0, PIPE), "0");
});

test("delta: keeps sign when color off", () => {
  assert.equal(delta(12, PIPE), "+12");
  assert.equal(delta(-5, PIPE), "-5");
  assert.ok(!delta(12, PIPE).includes("\x1b"));
});

test("dim/bold wrap only when on", () => {
  assert.equal(dim("abc", PIPE), "abc");
  assert.equal(bold("abc", PIPE), "abc");
  process.env.FORCE_COLOR = "1";
  assert.equal(dim("abc", PIPE), `${DIM}abc${RESET}`);
  assert.equal(bold("abc", PIPE), `${BOLD}abc${RESET}`);
});

// Cross-stack palette parity: these MUST equal tamper_signal/color.py's codes.
test("palette parity: SGR codes match the Python helper", () => {
  assert.equal(GREEN, "\x1b[32m");
  assert.equal(YELLOW, "\x1b[33m");
  assert.equal(RED, "\x1b[31m");
  assert.equal(DIM, "\x1b[2m");
  assert.equal(BOLD, "\x1b[1m");
  assert.equal(RESET, "\x1b[0m");
});
