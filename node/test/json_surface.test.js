// `tamper-signal ingest --json` and `export --json` (U4): the machine surface
// added in 1.7.1. Mirrors the Python tests in tests/test_cli_agent_ergonomics.py;
// payload keys must match the Python CLI byte for byte (R5). Driven through the
// real CLI via execFileSync so the captured stdout is exactly what ships.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "node", "cli.js");

function runCli(cwd, args, { expectFail = false } = {}) {
  const env = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  try {
    return { stdout: execFileSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf-8" }), stderr: "", status: 0 };
  } catch (err) {
    if (!expectFail) throw err;
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", status: err.status ?? 1 };
  }
}

function seedChain() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-json-"));
  runCli(dir, ["keygen", "--out", "keys"]);
  writeFileSync(join(dir, "data.csv"), "day,amount\n2026-05-01,10\n2026-05-02,20\n");
  return dir;
}

test("ingest --json emits a structured result", () => {
  const dir = seedChain();
  const payload = JSON.parse(runCli(dir, ["ingest", "data.csv", "--json"]).stdout);
  assert.equal(payload.source, "data.csv");
  assert.equal(payload.row_count, 2);
  assert.equal(payload.column_count, 2);
  assert.equal(payload.tolerance, null);
  assert.ok(payload.semantic_hash);
  assert.ok(payload.source_manifest.endsWith("000_source.json"));
});

test("ingest --json includes a declared tolerance", () => {
  const dir = seedChain();
  const payload = JSON.parse(runCli(dir, ["ingest", "data.csv", "--band", "5%", "--settle", "72h", "--json"]).stdout);
  assert.equal(payload.tolerance.band, "0.05");
  assert.equal(payload.tolerance.settle_hours, 72);
});

test("export --json writes a table result", () => {
  const dir = seedChain();
  runCli(dir, ["ingest", "data.csv"]);
  const payload = JSON.parse(runCli(dir, ["export", "receipts/chain.json", "--data", "data.csv", "--json"]).stdout);
  assert.equal(payload.bundle, false);
  assert.ok(payload.output.endsWith("table.json"));
  assert.ok(payload.data_hash);
  assert.equal(payload.row_count, 2);
});

test("export --bundle --json reports the bundle", () => {
  const dir = seedChain();
  runCli(dir, ["ingest", "data.csv"]);
  const payload = JSON.parse(runCli(dir, ["export", "receipts/chain.json", "--data", "data.csv", "--bundle", "--json"]).stdout);
  assert.equal(payload.bundle, true);
  assert.ok(payload.receipts >= 1);
  assert.ok(payload.output.endsWith("-verified.zip"));
});

test("export --json gives a structured error on mismatch (clean stdout)", () => {
  const dir = seedChain();
  runCli(dir, ["ingest", "data.csv"]);
  writeFileSync(join(dir, "wrong.csv"), "x\n1\n");
  const res = runCli(dir, ["export", "receipts/chain.json", "--data", "wrong.csv", "--json"], { expectFail: true });
  assert.equal(res.status, 1);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /match/);
});
