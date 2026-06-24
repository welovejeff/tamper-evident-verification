// `tamper-signal log` (U7): render archived run history as a per-metric trend
// across runs at day/week/month/quarter granularity. Mirrors the core cases in
// tests/test_log.py, plus the periodKey parity pin (the SAME created_at list
// yields the SAME keys Python pins) and one execFileSync over a built history.
// Exit codes: 0 (1 only on a bad --granularity). ASCII output only.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HISTORY_DIRNAME, periodKey } from "../history.js";
import { generateKeys } from "../keys.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "node", "cli.js");

function snapshot({ createdAt, rowCount, numericSums = {}, tail, signed = false, breached = null }) {
  const totals = {
    row_count: rowCount,
    column_count: 2,
    numeric_sums: numericSums,
    date_ranges: {},
    null_counts: {},
  };
  const body = {
    kind: "run_snapshot",
    spec_version: "1.2",
    created_at: createdAt,
    chain_tail_hash: tail,
    source: { filename: "export.csv", declared_origin: "t", columns: ["amount", "day"] },
    stages: [{ name: "source", kind: "source_manifest", totals }],
  };
  if (breached !== null) body.breached = breached;
  if (signed) {
    body.signature = { algorithm: "ed25519", public_key: "00".repeat(32), signature: "00".repeat(64) };
  }
  return body;
}

function writeHistory(snapshots) {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-log-"));
  const receipts = join(dir, "receipts");
  const history = join(receipts, HISTORY_DIRNAME);
  mkdirSync(history, { recursive: true });
  snapshots.forEach((snap, i) => writeFileSync(join(history, `snap${i}.json`), JSON.stringify(snap, null, 2) + "\n"));
  return receipts;
}

function runLog(receipts, args, { expectFail = false } = {}) {
  const env = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  try {
    return { stdout: execFileSync(process.execPath, [cli, "log", "--chain", receipts, ...args], { env, encoding: "utf-8" }), stderr: "", status: 0 };
  } catch (err) {
    if (!expectFail) throw err;
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", status: err.status };
  }
}

// ---------------------------------------------------------------------------
// periodKey parity: identical to Python's pinned PERIOD_KEY_CASES.
// ---------------------------------------------------------------------------
const PERIOD_KEY_CASES = [
  ["2026-06-11T12:00:00Z", "day", "2026-06-11"],
  ["2026-06-11T12:00:00Z", "week", "2026-W24"],
  ["2026-06-11T12:00:00Z", "month", "2026-06"],
  ["2026-06-11T12:00:00Z", "quarter", "2026-Q2"],
  ["2026-01-15T00:00:00Z", "quarter", "2026-Q1"],
  ["2026-12-31T23:59:59Z", "quarter", "2026-Q4"],
  ["2024-12-30T00:00:00Z", "week", "2025-W01"],
  ["2025-01-01T00:00:00Z", "week", "2025-W01"],
  ["2023-01-01T00:00:00Z", "week", "2022-W52"],
  ["2026-03-31T23:30:00Z", "day", "2026-03-31"],
];

test("periodKey matches the pinned cross-stack expectations", () => {
  for (const [createdAt, granularity, expected] of PERIOD_KEY_CASES) {
    assert.equal(periodKey(createdAt, granularity), expected, `${createdAt} @ ${granularity}`);
  }
});

test("periodKey throws on an unknown granularity", () => {
  assert.throws(() => periodKey("2026-06-11T00:00:00Z", "fortnight"));
});

// ---------------------------------------------------------------------------
// Empty / single
// ---------------------------------------------------------------------------
test("empty history says so and exits 0", () => {
  const receipts = writeHistory([]);
  const { stdout, status } = runLog(receipts, []);
  assert.equal(status, 0);
  assert.match(stdout, /no run history yet/);
});

test("single run renders one row with no deltas", () => {
  const receipts = writeHistory([snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 100, numericSums: { amount: "50" }, tail: "aa".repeat(32) })]);
  const { stdout } = runLog(receipts, []);
  assert.match(stdout, /2026-06-01/);
  assert.match(stdout, /100/);
  assert.ok(!stdout.includes("(+") && !stdout.includes("(-"));
});

// ---------------------------------------------------------------------------
// Three runs, chronological rows with deltas (table + JSON)
// ---------------------------------------------------------------------------
test("three runs render three chronological rows with correct deltas", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 100, numericSums: { amount: "10" }, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2026-06-02T00:00:00Z", rowCount: 122, numericSums: { amount: "12.5" }, tail: "02".repeat(32) }),
    snapshot({ createdAt: "2026-06-03T00:00:00Z", rowCount: 120, numericSums: { amount: "9" }, tail: "03".repeat(32) }),
  ]);
  const { stdout } = runLog(receipts, []);
  const lines = stdout.split("\n");
  assert.ok(lines[1].startsWith("2026-06-01"));
  assert.match(stdout, /122 \(\+22\)/);
  assert.match(stdout, /120 \(-2\)/);
  assert.match(stdout, /12\.5 \(\+2\.5\)/);
  assert.match(stdout, /9 \(-3\.5\)/);
  assert.match(stdout, /u = unsigned snapshot/);
});

test("three-run JSON is oldest-first with correct deltas", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 100, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2026-06-02T00:00:00Z", rowCount: 122, tail: "02".repeat(32) }),
    snapshot({ createdAt: "2026-06-03T00:00:00Z", rowCount: 120, tail: "03".repeat(32) }),
  ]);
  const payload = JSON.parse(runLog(receipts, ["--json"]).stdout);
  assert.equal(payload.granularity, "day");
  assert.equal(payload.collapsed, 0);
  assert.deepEqual(payload.runs.map((r) => r.period), ["2026-06-01", "2026-06-02", "2026-06-03"]);
  assert.ok(!("delta" in payload.runs[0].metrics.row_count));
  assert.deepEqual(payload.runs[1].metrics.row_count, { value: "122", delta: "+22" });
  assert.deepEqual(payload.runs[2].metrics.row_count, { value: "120", delta: "-2" });
});

// ---------------------------------------------------------------------------
// Collapse: same-period runs, last-wins
// ---------------------------------------------------------------------------
test("two same-day runs collapse last-wins at day granularity", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2026-06-01T08:00:00Z", rowCount: 100, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2026-06-01T20:00:00Z", rowCount: 130, tail: "02".repeat(32) }),
  ]);
  const payload = JSON.parse(runLog(receipts, ["--json"]).stdout);
  assert.equal(payload.collapsed, 1);
  assert.equal(payload.runs.length, 1);
  assert.equal(payload.runs[0].metrics.row_count.value, "130");
});

test("week granularity collapses an ISO-week year boundary", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2024-12-30T00:00:00Z", rowCount: 10, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2025-01-01T00:00:00Z", rowCount: 20, tail: "02".repeat(32) }),
  ]);
  const payload = JSON.parse(runLog(receipts, ["--granularity", "week", "--json"]).stdout);
  assert.deepEqual(payload.runs.map((r) => r.period), ["2025-W01"]);
  assert.equal(payload.collapsed, 1);
});

// ---------------------------------------------------------------------------
// --metric filter, markers, missing metric, ASCII
// ---------------------------------------------------------------------------
test("--metric filters the trended columns", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 5, numericSums: { amount: "10", qty: "3" }, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2026-06-02T00:00:00Z", rowCount: 6, numericSums: { amount: "12", qty: "4" }, tail: "02".repeat(32) }),
  ]);
  const payload = JSON.parse(runLog(receipts, ["--metric", "amount", "--json"]).stdout);
  assert.deepEqual(Object.keys(payload.runs[0].metrics), ["amount"]);
});

test("breached metric gets a ! marker and a breached list", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 5, numericSums: { amount: "10" }, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2026-06-02T00:00:00Z", rowCount: 5, numericSums: { amount: "30" }, tail: "02".repeat(32), breached: { "2026-06-02": ["amount"] } }),
  ]);
  const { stdout } = runLog(receipts, []);
  assert.match(stdout, /30!/);
  assert.match(stdout, /! = breached in that run/);
  const payload = JSON.parse(runLog(receipts, ["--json"]).stdout);
  assert.deepEqual(payload.runs[1].breached, ["amount"]);
});

test("a snapshot missing a selected metric renders -", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 5, numericSums: {}, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2026-06-02T00:00:00Z", rowCount: 6, numericSums: { amount: "12" }, tail: "02".repeat(32) }),
  ]);
  const payload = JSON.parse(runLog(receipts, ["--json"]).stdout);
  assert.deepEqual(payload.runs[0].metrics.amount, { value: "-" });
  assert.equal(payload.runs[1].metrics.amount.value, "12");
  assert.ok(!("delta" in payload.runs[1].metrics.amount));
});

test("output is ASCII only", () => {
  const receipts = writeHistory([
    snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 5, numericSums: { amount: "10" }, tail: "01".repeat(32) }),
    snapshot({ createdAt: "2026-06-02T00:00:00Z", rowCount: 6, numericSums: { amount: "12" }, tail: "02".repeat(32) }),
  ]);
  const { stdout } = runLog(receipts, []);
  // eslint-disable-next-line no-control-regex
  assert.ok(/^[\x00-\x7F]*$/.test(stdout), "output must be ASCII only");
});

test("unknown --granularity exits 1", () => {
  const receipts = writeHistory([snapshot({ createdAt: "2026-06-01T00:00:00Z", rowCount: 5, tail: "01".repeat(32) })]);
  const { status, stderr } = runLog(receipts, ["--granularity", "fortnight"], { expectFail: true });
  assert.equal(status, 1);
  assert.match(stderr, /unknown --granularity/);
});

// ---------------------------------------------------------------------------
// End-to-end over a real built history (signed snapshots verify under the key)
// ---------------------------------------------------------------------------
test("log renders a real built history end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-log-e2e-"));
  const env = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  generateKeys(join(dir, "keys"));
  writeFileSync(join(dir, "export.csv"), "day,amount\n2026-05-01,10\n2026-05-02,20\n");
  execFileSync(process.execPath, [cli, "ingest", "export.csv", "--origin", "t"], { cwd: dir, env });
  execFileSync(process.execPath, [cli, "verify", "receipts/chain.json"], { cwd: dir, env });
  writeFileSync(join(dir, "export.csv"), "day,amount\n2026-05-01,10\n2026-05-02,20\n2026-05-03,5\n");
  execFileSync(process.execPath, [cli, "ingest", "export.csv", "--origin", "t"], { cwd: dir, env });
  execFileSync(process.execPath, [cli, "verify", "receipts/chain.json"], { cwd: dir, env });

  const out = execFileSync(process.execPath, [cli, "log", "--chain", "receipts/", "--json"], { cwd: dir, env, encoding: "utf-8" });
  const payload = JSON.parse(out);
  assert.ok(payload.runs.length >= 1);
  assert.ok(payload.runs.every((r) => r.unsigned === false));
});

test("log --json surfaces band/settle per run, only where declared", () => {
  const s0 = snapshot({ createdAt: "2026-05-01T00:00:00Z", rowCount: 100, tail: "aa".repeat(32) });
  const s1 = snapshot({ createdAt: "2026-05-02T00:00:00Z", rowCount: 110, tail: "bb".repeat(32) });
  s1.tolerance = { band: "0.05", settle_hours: 72, bucket_column: "day" };
  const receipts = writeHistory([s0, s1]);

  const runs = JSON.parse(runLog(receipts, ["--json"]).stdout).runs; // oldest first
  assert.ok(!("band" in runs[0]) && !("settle_hours" in runs[0]));
  assert.equal(runs[1].band, "0.05");
  assert.equal(runs[1].settle_hours, 72);
});
