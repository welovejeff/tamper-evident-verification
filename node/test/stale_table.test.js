// The verify-time stale-table reminder: a published table.json that no longer
// hashes to the chain tail makes the room read NOT THE ATTESTED DATA, so
// `tamper-signal verify` names the fix on stderr. Absence stays silent
// (CLI-only projects never publish a table), --json stdout stays untouched,
// and an attested table earns no reminder.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "node", "cli.js");

function run(cwd, args) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, TAMPER_SIGNAL_KEY: "" },
  });
  return { out: res.stdout, err: res.stderr, code: res.status };
}

function seedChain() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-stale-"));
  run(dir, ["keygen", "--out", "keys"]);
  writeFileSync(join(dir, "d.csv"), "day,amount\n2026-05-01,10\n2026-05-02,20\n");
  run(dir, ["ingest", "d.csv"]);
  return dir;
}

test("verify stays silent when no table.json is published", () => {
  const dir = seedChain();
  const { err, code } = run(dir, ["verify", "receipts/chain.json"]);
  assert.equal(code, 0);
  assert.ok(!err.includes("NOT THE ATTESTED DATA"), err);
});

test("verify stays silent when the published table is attested", () => {
  const dir = seedChain();
  run(dir, ["export", "receipts/chain.json", "--data", "d.csv"]);
  const { err, code } = run(dir, ["verify", "receipts/chain.json"]);
  assert.equal(code, 0);
  assert.ok(!err.includes("NOT THE ATTESTED DATA"), err);
});

test("verify warns on stderr when the published table went stale", () => {
  const dir = seedChain();
  run(dir, ["export", "receipts/chain.json", "--data", "d.csv"]);
  const tablePath = join(dir, "receipts", "table.json");
  const doc = JSON.parse(readFileSync(tablePath, "utf-8"));
  doc.rows[0][doc.headers.indexOf("amount")] = "999"; // edited after signing
  writeFileSync(tablePath, JSON.stringify(doc, null, 2) + "\n");

  const { out, err, code } = run(dir, ["verify", "receipts/chain.json"]);
  assert.equal(code, 0); // the CHAIN verdict is untouched: green
  assert.match(err, /NOT THE ATTESTED DATA/);
  assert.match(err, /tamper-signal export/);
  assert.ok(!out.includes("NOT THE ATTESTED DATA")); // stderr only

  // --json stdout stays byte-parseable with no reminder folded in.
  const json = run(dir, ["verify", "receipts/chain.json", "--json"]);
  const payload = JSON.parse(json.out);
  assert.equal(payload.verdict, "green");
  assert.ok(!json.out.includes("NOT THE ATTESTED DATA"));
});
