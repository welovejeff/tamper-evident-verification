// `tamper-signal diff` (U5): compare two runs and report per-stage code-hash
// changes plus a structured totals delta including date ranges. Mirrors the
// core cases in tests/test_diff.py, including the structuredTotalsDelta
// parity pin (the same (a, b) pair serializes to the same JSON in both
// stacks). Exit codes: 0 with or without differences, 1 on usage/load errors.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HISTORY_DIRNAME } from "../history.js";
import { generateKeys } from "../keys.js";
import { structuredTotalsDelta } from "../totals.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "node", "cli.js");
const intactDir = join(repoRoot, "examples", "chains", "intact");
const tamperedDir = join(repoRoot, "examples", "chains", "tampered");

const CSV_A = "day,amount\n2026-05-01,10.5\n2026-05-02,20\n";
const CSV_B = "day,amount\n2026-05-01,10.5\n2026-05-02,20\n2026-05-03,5\n";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  generateKeys(join(dir, "keys"));
  writeFileSync(join(dir, "export.csv"), CSV_A);
  return dir;
}

function runCli(dir, args, { expectFail = false } = {}) {
  const env = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  try {
    return {
      stdout: execFileSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: "utf-8" }),
      stderr: "",
      status: 0,
    };
  } catch (err) {
    if (!expectFail) throw err;
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", status: err.status };
  }
}

// Two verified runs: CSV_A archived to history, CSV_B as the live chain.
function twoRuns() {
  const dir = setup();
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  runCli(dir, ["verify", "receipts/chain.json"]);
  writeFileSync(join(dir, "export.csv"), CSV_B);
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  runCli(dir, ["verify", "receipts/chain.json"]);
  return dir;
}

const TOTALS = {
  row_count: 2,
  column_count: 2,
  numeric_sums: { amount: "30.5" },
  date_ranges: {},
  null_counts: {},
};

function snapshotBody(stages, { createdAt = "2026-06-01T00:00:00Z", filename = "export.csv", tail = "aa".repeat(32) } = {}) {
  return {
    kind: "run_snapshot",
    spec_version: "1.2",
    created_at: createdAt,
    chain_tail_hash: tail,
    source: { filename, declared_origin: "t", columns: ["amount", "day"] },
    stages,
  };
}

const stage = (name, totals, extra = {}) => ({
  name,
  kind: name === "source" ? "source_manifest" : "transform_receipt",
  totals,
  ...extra,
});

function writeSnapshot(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n");
  return path;
}

test("code change at one stage names the stage and hashes", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  const a = writeSnapshot(dir, "a.json", snapshotBody([
    stage("source", TOTALS),
    stage("clean", TOTALS, { code_hash: "aa".repeat(32), code_file: "pipeline.py" }),
  ]));
  const b = writeSnapshot(dir, "b.json", snapshotBody([
    stage("source", TOTALS),
    stage("clean", TOTALS, { code_hash: "bb".repeat(32), code_file: "pipeline.py" }),
  ], { tail: "bb".repeat(32) }));
  const { stdout, status } = runCli(dir, ["diff", a, b]);
  assert.equal(status, 0);
  assert.match(stdout, /stage clean/);
  assert.match(stdout, /code_hash aaaaaaaa -> bbbbbbbb \(pipeline\.py\)/);
  assert.ok(!stdout.includes("stage source")); // unchanged stage prints nothing
});

test("totals movement renders date-range extension and bucket keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  const before = {
    ...TOTALS,
    date_ranges: { day: { min: "2026-05-01", max: "2026-05-02" } },
    bucket_column: "day",
    period_buckets: {
      "2026-05-01": { row_count: 1, numeric_sums: { amount: "10.5" }, null_counts: {} },
      "2026-05-02": { row_count: 1, numeric_sums: { amount: "20" }, null_counts: {} },
    },
  };
  const after = {
    ...before,
    row_count: 3,
    numeric_sums: { amount: "35.5" },
    date_ranges: { day: { min: "2026-05-01", max: "2026-05-03" } },
    period_buckets: {
      ...before.period_buckets,
      "2026-05-03": { row_count: 1, numeric_sums: { amount: "5" }, null_counts: {} },
    },
  };
  const a = writeSnapshot(dir, "a.json", snapshotBody([stage("source", before)]));
  const b = writeSnapshot(dir, "b.json", snapshotBody([stage("source", after)], { tail: "bb".repeat(32) }));
  const { stdout, status } = runCli(dir, ["diff", a, b]);
  assert.equal(status, 0);
  assert.match(stdout, /row_count 2 -> 3 \(\+1\)/);
  assert.match(stdout, /amount 30\.5 -> 35\.5 \(5\)/);
  assert.match(stdout, /date_ranges\[day\] 2026-05-01\.\.2026-05-02 -> 2026-05-01\.\.2026-05-03/);
  assert.match(stdout, /period_buckets changed: 2026-05-03/);
});

test("default invocation compares the latest differing snapshot", () => {
  const dir = twoRuns();
  const { stdout, status } = runCli(dir, ["diff"]);
  assert.equal(status, 0);
  assert.match(stdout, /row_count 2 -> 3 \(\+1\)/);
  assert.match(stdout, /amount 30\.5 -> 35\.5 \(5\)/);
  assert.match(stdout, /period_buckets changed: 2026-05-03/);
});

test("default invocation never self-compares; single run says no prior", () => {
  const dir = setup();
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  runCli(dir, ["verify", "receipts/chain.json"]);
  assert.equal(readdirSync(join(dir, "receipts", HISTORY_DIRNAME)).length, 1);
  const { stdout, status } = runCli(dir, ["diff"]);
  assert.equal(status, 0);
  assert.match(stdout, /no prior run archived to compare against/);
});

test("empty history prints the no-prior message and exits 0", () => {
  const dir = setup();
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]); // never verified
  const { stdout, status } = runCli(dir, ["diff"]);
  assert.equal(status, 0);
  assert.match(stdout, /no prior run archived to compare against/);
});

test("a missing chain or a bad explicit path is a load error (exit 1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  const missing = runCli(dir, ["diff"], { expectFail: true });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no chain\.json/);

  const nowhere = runCli(dir, ["diff", "does-not-exist"], { expectFail: true });
  assert.equal(nowhere.status, 1);
  assert.match(nowhere.stderr, /no such file or directory/);

  writeFileSync(join(dir, "garbage.json"), '{"neither": true}');
  const garbage = runCli(dir, ["diff", join(dir, "garbage.json"), dir], { expectFail: true });
  assert.equal(garbage.status, 1);
  assert.match(garbage.stderr, /neither a chain directory/);
});

test("one arg compares that run against the current chain", () => {
  const dir = twoRuns();
  const history = join(dir, "receipts", HISTORY_DIRNAME);
  const prior = readdirSync(history)
    .map((name) => join(history, name))
    .find((path) => JSON.parse(readFileSync(path, "utf-8")).stages[0].totals.row_count === 2);
  const { stdout, status } = runCli(dir, ["diff", prior]);
  assert.equal(status, 0);
  assert.match(stdout, /row_count 2 -> 3 \(\+1\)/);
  assert.match(stdout, /b: receipts/);
});

test("differing stage lists render added and removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  const a = writeSnapshot(dir, "a.json", snapshotBody([
    stage("source", TOTALS),
    stage("clean", TOTALS, { code_hash: "aa".repeat(32) }),
  ]));
  const b = writeSnapshot(dir, "b.json", snapshotBody([
    stage("source", TOTALS),
    stage("aggregate", TOTALS, { code_hash: "bb".repeat(32) }),
  ], { tail: "bb".repeat(32) }));
  const { stdout, status } = runCli(dir, ["diff", a, b]);
  assert.equal(status, 0);
  assert.match(stdout, /stage clean: removed/);
  assert.match(stdout, /stage aggregate: added/);
});

test("identity mismatch prints a notice but still diffs", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  const a = writeSnapshot(dir, "a.json", snapshotBody([stage("source", TOTALS)], { filename: "a.csv" }));
  const b = writeSnapshot(
    dir,
    "b.json",
    snapshotBody([stage("source", { ...TOTALS, row_count: 3 })], { filename: "b.csv", tail: "bb".repeat(32) })
  );
  const { stdout, status } = runCli(dir, ["diff", a, b]);
  assert.equal(status, 0);
  assert.match(stdout, /note: sources differ \(a\.csv vs b\.csv\); comparing anyway/);
  assert.match(stdout, /row_count 2 -> 3 \(\+1\)/);
});

test("unsigned snapshot inputs get the weaker-evidence marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  const a = writeSnapshot(dir, "a.json", snapshotBody([stage("source", TOTALS)]));
  const b = writeSnapshot(dir, "b.json", snapshotBody([stage("source", TOTALS)], {
    createdAt: "2026-06-02T00:00:00Z",
    tail: "bb".repeat(32),
  }));
  const { stdout } = runCli(dir, ["diff", a, b]);
  assert.match(stdout, /note: snapshot a\.json is unsigned; weaker evidence/);
  assert.match(stdout, /note: snapshot b\.json is unsigned; weaker evidence/);

  const { stdout: jsonOut } = runCli(dir, ["diff", a, b, "--json"]);
  const payload = JSON.parse(jsonOut);
  assert.equal(payload.a.unsigned, true);
  assert.equal(payload.b.unsigned, true);
});

test("intact vs tampered example chains name the tampered stage and delta", () => {
  const { stdout, status } = runCli(repoRoot, ["diff", intactDir, tamperedDir]);
  assert.equal(status, 0);
  assert.match(stdout, /stage clean/);
  assert.match(stdout, /spend_usd 2020283\.47 -> 2020185\.07 \(-98\.4\)/);
  assert.ok(!stdout.includes("stage source"));
});

test("--json shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-diff-"));
  const a = writeSnapshot(dir, "a.json", snapshotBody([
    stage("source", TOTALS),
    stage("clean", TOTALS, { code_hash: "aa".repeat(32), code_file: "pipeline.py" }),
  ]));
  const b = writeSnapshot(dir, "b.json", snapshotBody([
    stage("source", { ...TOTALS, row_count: 3 }),
    stage("clean", TOTALS, { code_hash: "bb".repeat(32), code_file: "pipeline.py" }),
    stage("aggregate", TOTALS),
  ], { createdAt: "2026-06-02T00:00:00Z", tail: "bb".repeat(32) }));
  const { stdout, status } = runCli(dir, ["diff", a, b, "--json"]);
  assert.equal(status, 0);
  const payload = JSON.parse(stdout);

  assert.deepEqual(payload.a, { ref: a, created_at: "2026-06-01T00:00:00Z", unsigned: true });
  assert.equal(payload.b.ref, b);
  assert.equal(payload.identity_mismatch, false);

  const byName = Object.fromEntries(payload.stages.map((row) => [row.name, row]));
  assert.equal(byName.source.status, "matched");
  assert.equal(byName.source.code_changed, false);
  assert.deepEqual(byName.source.totals, { row_count: { before: 2, after: 3, delta: 1 } });
  assert.equal(byName.clean.code_changed, true);
  assert.deepEqual(byName.clean.code_hash, { before8: "aaaaaaaa", after8: "bbbbbbbb" });
  assert.deepEqual(byName.clean.totals, {});
  assert.deepEqual(byName.aggregate, {
    name: "aggregate", status: "added", code_changed: false, totals: null,
  });
});

// --- structuredTotalsDelta parity pin (tests/test_diff.py asserts the same) --

const PARITY_A = {
  row_count: 4,
  column_count: 3,
  numeric_sums: { amount: "100.5", gone: "3" },
  date_ranges: { day: { min: "2026-05-01", max: "2026-05-02" } },
  null_counts: { note: 1 },
  bucket_column: "day",
  period_buckets: {
    "2026-05-01": { row_count: 2, numeric_sums: { amount: "50" }, null_counts: {} },
    "2026-05-02": { row_count: 2, numeric_sums: { amount: "50.5" }, null_counts: {} },
  },
};
const PARITY_B = {
  row_count: 6,
  column_count: 4,
  numeric_sums: { amount: "120.25", new: "7" },
  date_ranges: { day: { min: "2026-05-01", max: "2026-05-03" } },
  null_counts: { note: 3 },
  bucket_column: "day",
  period_buckets: {
    "2026-05-01": { row_count: 2, numeric_sums: { amount: "50" }, null_counts: {} },
    "2026-05-02": { row_count: 2, numeric_sums: { amount: "60.25" }, null_counts: {} },
    "2026-05-03": { row_count: 2, numeric_sums: { amount: "10" }, null_counts: {} },
  },
};
const PARITY_EXPECTED =
  '{"row_count":{"before":4,"after":6,"delta":2},' +
  '"column_count":{"before":3,"after":4,"delta":1},' +
  '"numeric_sums":{"amount":{"before":"100.5","after":"120.25","delta":"19.75"},' +
  '"gone":{"before":"3","after":null},"new":{"before":null,"after":"7"}},' +
  '"null_counts":{"note":{"before":1,"after":3,"delta":2}},' +
  '"date_ranges":{"day":{"before":{"min":"2026-05-01","max":"2026-05-02"},' +
  '"after":{"min":"2026-05-01","max":"2026-05-03"}}},' +
  '"period_buckets_changed":["2026-05-02","2026-05-03"]}';

test("structuredTotalsDelta serializes to the pinned cross-stack JSON", () => {
  assert.equal(JSON.stringify(structuredTotalsDelta(PARITY_A, PARITY_B)), PARITY_EXPECTED);
});

test("structuredTotalsDelta of identical totals is empty", () => {
  assert.deepEqual(structuredTotalsDelta(PARITY_A, PARITY_A), {});
  assert.deepEqual(structuredTotalsDelta({}, {}), {});
});
