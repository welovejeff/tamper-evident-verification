// Node CLI color application and gating (U6): the colored verdict headline and
// the NO_COLOR / FORCE_COLOR / --no-color gate, mirroring tests/test_cli_color.py.
// Color is gated to a TTY, so these force it on with FORCE_COLOR (the pipe from
// execFileSync is not a TTY) and assert plain output when it is off.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GREEN, RESET } from "../color.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "node", "cli.js");

function run(cwd, args, env = {}) {
  // Start from a clean slate: NO_COLOR / FORCE_COLOR only present when a test
  // sets them (a key set to undefined would stringify to "undefined").
  const base = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  delete base.NO_COLOR;
  delete base.FORCE_COLOR;
  return execFileSync(process.execPath, [cli, ...args], { cwd, env: { ...base, ...env }, encoding: "utf-8" });
}

function seedChain() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-color-"));
  run(dir, ["keygen", "--out", "keys"]);
  writeFileSync(join(dir, "d.csv"), "day,amount\n2026-05-01,10\n");
  run(dir, ["ingest", "d.csv"]);
  return dir;
}

test("verify headline is a colored light under FORCE_COLOR", () => {
  const dir = seedChain();
  const out = run(dir, ["verify", "receipts/chain.json"], { FORCE_COLOR: "1" });
  assert.ok(out.includes(`${GREEN}●${RESET}`));
  assert.ok(out.includes(`${GREEN}GREEN${RESET}`));
  assert.ok(out.includes("CHAIN INTACT"));
});

test("verify piped is plain text with no ANSI", () => {
  const dir = seedChain();
  const out = run(dir, ["verify", "receipts/chain.json"]);
  assert.ok(!out.includes("\x1b"));
  assert.ok(out.includes("CHAIN INTACT"));
});

test("--no-color beats FORCE_COLOR", () => {
  const dir = seedChain();
  const out = run(dir, ["verify", "receipts/chain.json", "--no-color"], { FORCE_COLOR: "1" });
  assert.ok(!out.includes("\x1b"));
});

test("NO_COLOR beats FORCE_COLOR", () => {
  const dir = seedChain();
  const out = run(dir, ["verify", "receipts/chain.json"], { FORCE_COLOR: "1", NO_COLOR: "1" });
  assert.ok(!out.includes("\x1b"));
});
