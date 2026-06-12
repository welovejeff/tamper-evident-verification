// Two-zone cross-run judgment in verify (U6): the shared band vectors
// (tests/fixtures/band_vectors.json, also consumed by tests/test_judgment.py)
// drive judgeCrossRun directly; CLI tests cover the verify integration and
// the cross-stack judgment-parity fixture (Python-written history judged by
// the node CLI must produce IDENTICAL caveat_details JSON).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HISTORY_DIRNAME, judgeCrossRun } from "../history.js";
import { generateKeys } from "../keys.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "node", "cli.js");
const vectors = JSON.parse(
  readFileSync(join(repoRoot, "tests", "fixtures", "band_vectors.json"), "utf-8")
);
const parityDir = join(repoRoot, "tests", "fixtures", "judgment-parity");
const parityReverseDir = join(repoRoot, "tests", "fixtures", "judgment-parity-reverse");

// --- shared band vectors -> judgeCrossRun (mirrors the Python harness) ------

function totalsFrom(buckets) {
  let rows = 0;
  for (const entry of Object.values(buckets)) rows += entry.row_count ?? 0;
  return {
    row_count: rows,
    column_count: 2,
    numeric_sums: {},
    date_ranges: {},
    null_counts: {},
    bucket_column: "day",
    period_buckets: buckets,
  };
}

function snapshotFrom(entry) {
  const snapshot = {
    kind: "run_snapshot",
    spec_version: "1.2",
    created_at: entry.created_at,
    chain_tail_hash: createHash("sha256").update(entry.created_at).digest("hex"),
    source: { filename: "export.csv", declared_origin: "", columns: ["day"] },
    stages: [{ name: "source", kind: "source_manifest", totals: totalsFrom(entry.buckets) }],
  };
  if ("breached" in entry) snapshot.breached = entry.breached;
  return snapshot;
}

function manifestFrom(testCase) {
  const current = testCase.current;
  return {
    kind: "source_manifest",
    spec_version: "1.2",
    created_at: current.created_at,
    source: { filename: "export.csv", evidence_hash: "00", byte_size: 1, declared_origin: "" },
    semantic_hash: "00",
    control_totals: totalsFrom(current.buckets),
    tolerance: { band: testCase.band, settle_hours: testCase.settle_hours, bucket_column: "day" },
  };
}

const CHAIN = {
  receipts: ["000_source.json"],
  receipt_hashes: { "000_source.json": "ff".repeat(32) },
};

test("shared band vectors: every case judges to the expected typed caveats", () => {
  for (const testCase of vectors.cases) {
    const receipts = [manifestFrom(testCase)];
    const snapshots = testCase.history.map(snapshotFrom);
    const judgment = judgeCrossRun(receipts, CHAIN, snapshots, {
      now: Date.parse(testCase.now),
    });

    const gotTypes = judgment.details.map((d) => d.type).sort();
    const wantTypes = [...testCase.expect.caveat_types].sort();
    assert.deepEqual(gotTypes, wantTypes, testCase.name);
    assert.equal(judgment.caveats.length === 0, testCase.expect.green, testCase.name);
    assert.equal(judgment.caveats.length, judgment.details.length, testCase.name);
    for (const caveat of judgment.caveats) {
      assert.ok(/^[\x20-\x7e]+$/.test(caveat), `${testCase.name}: ASCII only: ${caveat}`);
    }
  }
});

test("flood control: 30 restated buckets across 4 metrics emit 4 caveats", () => {
  const before = {};
  const after = {};
  for (let day = 1; day <= 30; day++) {
    const key = `2026-01-${String(day).padStart(2, "0")}`;
    before[key] = {
      row_count: 10,
      numeric_sums: { spend: "100", clicks: "200", impressions: "300" },
      null_counts: {},
    };
    after[key] = {
      row_count: 11,
      numeric_sums: { spend: "150", clicks: "260", impressions: "390" },
      null_counts: {},
    };
  }
  const testCase = {
    band: "0.05",
    settle_hours: 72,
    history: [{ created_at: "2026-05-01T00:00:00Z", buckets: before }],
    current: { created_at: "2026-05-02T00:00:00Z", buckets: after },
  };
  const judgment = judgeCrossRun([manifestFrom(testCase)], CHAIN, [
    snapshotFrom(testCase.history[0]),
  ]);
  assert.equal(judgment.caveats.length, 4);
  for (const detail of judgment.details) {
    assert.equal(detail.type, "settled_movement");
    assert.equal(detail.periods, 30);
    assert.equal(detail.buckets.length, 30);
  }
});

test("notices: first run, out-of-order history, and identity mismatch", () => {
  const base = {
    band: "0.05",
    settle_hours: 72,
    history: [
      {
        created_at: "2026-06-02T01:00:00Z",
        buckets: { "2026-06-01": { row_count: 10, numeric_sums: { spend: "100" }, null_counts: {} } },
      },
    ],
    current: {
      created_at: "2026-06-03T01:00:00Z",
      buckets: { "2026-06-01": { row_count: 10, numeric_sums: { spend: "109" }, null_counts: {} } },
    },
  };

  let judgment = judgeCrossRun([manifestFrom(base)], CHAIN, []);
  assert.deepEqual(judgment.notices, [
    "no run history yet; cross-run judgment begins on the next verify",
  ]);
  assert.deepEqual(judgment.caveats, []);

  const stale = structuredClone(base);
  stale.current.created_at = "2026-06-01T00:00:00Z";
  judgment = judgeCrossRun([manifestFrom(stale)], CHAIN, [snapshotFrom(stale.history[0])]);
  assert.deepEqual(judgment.notices, [
    "cross-run judgment skipped: archived runs are newer than this chain",
  ]);

  const other = snapshotFrom(base.history[0]);
  other.source.filename = "other.csv";
  judgment = judgeCrossRun([manifestFrom(base)], CHAIN, [other]);
  assert.deepEqual(judgment.notices, [
    "cross-run judgment skipped: source identity differs from history",
  ]);

  // The run's own snapshot (same chain tail) never judges itself.
  const self = snapshotFrom(base.history[0]);
  self.chain_tail_hash = CHAIN.receipt_hashes["000_source.json"];
  judgment = judgeCrossRun([manifestFrom(base)], CHAIN, [self]);
  assert.deepEqual(judgment.notices, [
    "no run history yet; cross-run judgment begins on the next verify",
  ]);
});

test("no declaration is a silent no-op", () => {
  const base = {
    band: "0.05",
    settle_hours: 72,
    history: [
      {
        created_at: "2026-06-02T01:00:00Z",
        buckets: { "2026-06-01": { row_count: 10, numeric_sums: { spend: "100" }, null_counts: {} } },
      },
    ],
    current: {
      created_at: "2026-06-03T01:00:00Z",
      buckets: { "2026-06-01": { row_count: 10, numeric_sums: { spend: "109" }, null_counts: {} } },
    },
  };
  const manifest = manifestFrom(base);
  delete manifest.tolerance;
  const judgment = judgeCrossRun([manifest], CHAIN, [snapshotFrom(base.history[0])]);
  assert.deepEqual(judgment, { caveats: [], details: [], notices: [], breached: {} });
});

// --- flat-band (whole-table, no buckets) hardening: mirrors test_judgment.py -

function flatTotals(spend, rowCount = 10) {
  return {
    row_count: rowCount,
    column_count: 2,
    numeric_sums: { spend },
    date_ranges: {},
    null_counts: {},
  };
}

function flatSnapshot(createdAt, spend, breached = null) {
  const snapshot = {
    kind: "run_snapshot",
    spec_version: "1.2",
    created_at: createdAt,
    chain_tail_hash: createHash("sha256").update(createdAt).digest("hex"),
    source: { filename: "export.csv", declared_origin: "", columns: ["spend"] },
    stages: [{ name: "source", kind: "source_manifest", totals: flatTotals(spend) }],
  };
  if (breached !== null) snapshot.breached = breached;
  return snapshot;
}

function flatManifest(createdAt, spend) {
  return {
    kind: "source_manifest",
    spec_version: "1.2",
    created_at: createdAt,
    source: { filename: "export.csv", evidence_hash: "00", byte_size: 1, declared_origin: "" },
    semantic_hash: "00",
    control_totals: flatTotals(spend),
    tolerance: { band: "0.05", settle_hours: 72 },
  };
}

test("flat band: sub-band ratchet over N runs eventually trips the cumulative bound", () => {
  const history = [
    flatSnapshot("2026-06-01T12:00:00Z", "100"),
    flatSnapshot("2026-06-02T12:00:00Z", "104.9"),
    flatSnapshot("2026-06-03T12:00:00Z", "109.8"),
    flatSnapshot("2026-06-04T12:00:00Z", "114.7"),
  ];
  const manifest = flatManifest("2026-06-05T12:00:00Z", "119.6");
  const judgment = judgeCrossRun([manifest], CHAIN, history, {
    now: Date.parse("2026-06-05T12:00:00Z"),
  });
  assert.equal(judgment.details.length, 1);
  assert.equal(judgment.details[0].type, "band_breach");
  assert.equal(judgment.details[0].worst.period, "whole-table");
  assert.deepEqual(judgment.breached, { "whole-table": ["spend"] });
});

test("flat band: a tainted whole-table value never becomes the next baseline", () => {
  const history = [
    flatSnapshot("2026-06-02T12:00:00Z", "100"),
    flatSnapshot("2026-06-03T12:00:00Z", "140", { "whole-table": ["spend"] }),
  ];
  const manifest = flatManifest("2026-06-04T12:00:00Z", "140");
  const judgment = judgeCrossRun([manifest], CHAIN, history, {
    now: Date.parse("2026-06-04T12:00:00Z"),
  });
  assert.equal(judgment.details.length, 1);
  assert.equal(judgment.details[0].type, "band_breach");
  assert.equal(judgment.details[0].worst.before, "100");
});

test("flat band: a future-dated current chain cannot widen the cumulative bound", () => {
  const history = [
    flatSnapshot("2026-06-01T12:00:00Z", "100"),
    flatSnapshot("2026-06-02T12:00:00Z", "104.9"),
    flatSnapshot("2026-06-03T12:00:00Z", "109.8"),
    flatSnapshot("2026-06-04T12:00:00Z", "114.7"),
  ];
  const manifest = flatManifest("2030-01-01T00:00:00Z", "119.6");
  const judgment = judgeCrossRun([manifest], CHAIN, history, {
    now: Date.parse("2026-06-05T12:00:00Z"),
  });
  assert.equal(judgment.details.length, 1);
  assert.equal(judgment.details[0].type, "band_breach");
  assert.equal(judgment.details[0].worst.period, "whole-table");
});

test("columns changed: judges the shared metric and emits a typed caveat", () => {
  const base = {
    band: "0.05",
    settle_hours: 72,
    history: [
      {
        created_at: "2026-06-02T01:00:00Z",
        buckets: { "2026-06-01": { row_count: 10, numeric_sums: { spend: "100" }, null_counts: {} } },
      },
    ],
    current: {
      created_at: "2026-06-03T01:00:00Z",
      buckets: { "2026-06-01": { row_count: 10, numeric_sums: { spend: "109" }, null_counts: {} } },
    },
  };
  const snapshot = snapshotFrom(base.history[0]);
  snapshot.source.columns = ["day", "spend"]; // same file, an extra prior column
  const judgment = judgeCrossRun([manifestFrom(base)], CHAIN, [snapshot]);
  const types = judgment.details.map((d) => d.type).sort();
  assert.ok(types.includes("columns_changed"));
  assert.ok(types.includes("band_breach"));
  assert.ok(judgment.caveats.some((c) => c.includes("shared columns")));
});

// --- CLI integration ---------------------------------------------------------

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-judgment-"));
  generateKeys(join(dir, "keys"));
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

const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const twoDaysAgo = () => new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

test("CLI: a band breach alone is yellow (exit 2) with typed caveat_details", () => {
  const dir = setup();
  const day = yesterday();
  const prev = twoDaysAgo();
  // A second, stable day so the bucket column spans a real period axis (the
  // auto-selection guard wants >= 2 distinct dates); only `day` drifts.
  writeFileSync(join(dir, "export.csv"), `day,spend\n${prev},50\n${day},100\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  runCli(dir, ["verify", "receipts/chain.json"]); // first run: history begins

  writeFileSync(join(dir, "export.csv"), `day,spend\n${prev},50\n${day},109\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  const { stdout, status } = runCli(dir, ["verify", "receipts/chain.json", "--json"], {
    expectFail: true,
  });
  assert.equal(status, 2);
  const payload = JSON.parse(stdout);
  assert.equal(payload.verdict, "yellow");
  assert.deepEqual(payload.caveats, [
    `totals drift beyond declared band: spend breached in 1 bucket, worst ${day} (+9%)`,
  ]);
  assert.equal(payload.caveat_details.length, 1);
  assert.equal(payload.caveat_details[0].type, "band_breach");
  assert.equal(payload.caveat_details[0].worst.delta_pct, "+9%");
  assert.ok(payload.report.join("\n").includes("A human should look."));
});

test("CLI: breached snapshot never advances the baseline (still yellow)", () => {
  const dir = setup();
  const day = yesterday();
  const prev = twoDaysAgo();
  writeFileSync(join(dir, "export.csv"), `day,spend\n${prev},50\n${day},100\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  runCli(dir, ["verify", "receipts/chain.json"]);

  writeFileSync(join(dir, "export.csv"), `day,spend\n${prev},50\n${day},109\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  assert.equal(runCli(dir, ["verify", "receipts/chain.json"], { expectFail: true }).status, 2);

  // The archived snapshot carries the baseline-advancement guard.
  const history = join(dir, "receipts", HISTORY_DIRNAME);
  const breachedMaps = readdirSync(history).map(
    (name) => JSON.parse(readFileSync(join(history, name), "utf-8")).breached ?? null
  );
  assert.ok(breachedMaps.some((m) => m !== null && JSON.stringify(m) === JSON.stringify({ [day]: ["spend"] })));

  // Run N+1 with the same (still tampered) value: still yellow, judged
  // against the pre-breach baseline.
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  const { stdout, status } = runCli(dir, ["verify", "receipts/chain.json", "--json"], {
    expectFail: true,
  });
  assert.equal(status, 2);
  const payload = JSON.parse(stdout);
  assert.equal(payload.caveat_details[0].type, "band_breach");
  assert.equal(payload.caveat_details[0].worst.before, "100");
});

test("CLI: no declaration keeps verify exact and silent, caveat_details []", () => {
  const dir = setup();
  const day = yesterday();
  writeFileSync(join(dir, "export.csv"), `day,spend\n${day},100\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  runCli(dir, ["verify", "receipts/chain.json"]); // history now exists
  writeFileSync(join(dir, "export.csv"), `day,spend\n${day},109\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);

  const { stdout, status } = runCli(dir, ["verify", "receipts/chain.json", "--json"]);
  assert.equal(status, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.verdict, "green");
  assert.deepEqual(payload.caveats, []);
  assert.deepEqual(payload.caveat_details, []); // additive key, always present
});

test("CLI: within-run red wins; judgment never runs; no snapshot", () => {
  const dir = setup();
  const day = yesterday();
  writeFileSync(join(dir, "export.csv"), `day,spend\n${day},100\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  runCli(dir, ["verify", "receipts/chain.json"]);
  const before = readdirSync(join(dir, "receipts", HISTORY_DIRNAME)).sort();

  writeFileSync(join(dir, "export.csv"), `day,spend\n${day},109\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  const receiptPath = join(dir, "receipts", "000_source.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf-8"));
  receipt.control_totals.row_count = 99;
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

  const { stdout, status } = runCli(dir, ["verify", "receipts/chain.json", "--json"], {
    expectFail: true,
  });
  assert.equal(status, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.verdict, "red");
  assert.deepEqual(payload.caveat_details, []);
  assert.deepEqual(readdirSync(join(dir, "receipts", HISTORY_DIRNAME)).sort(), before);
});

test("CLI: first verify with a declaration notices that history begins", () => {
  const dir = setup();
  const day = yesterday();
  writeFileSync(join(dir, "export.csv"), `day,spend\n${day},100\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);

  const env = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  const run = spawnSync(process.execPath, [cli, "verify", "receipts/chain.json"], {
    cwd: dir,
    env,
    encoding: "utf-8",
  });
  assert.equal(run.status, 0);
  assert.ok(run.stderr.includes("no run history yet; cross-run judgment begins on the next verify"));
  assert.equal(readdirSync(join(dir, "receipts", HISTORY_DIRNAME)).length, 1);
});

test("CLI: a garbage snapshot in history is skipped with a notice, never red (AE11)", () => {
  const dir = setup();
  const day = yesterday();
  writeFileSync(join(dir, "export.csv"), `day,spend\n${day},100\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  const history = join(dir, "receipts", HISTORY_DIRNAME);
  mkdirSync(history, { recursive: true });
  writeFileSync(join(history, "garbage.json"), "not json {");

  const env = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  const run = spawnSync(process.execPath, [cli, "verify", "receipts/chain.json"], {
    cwd: dir,
    env,
    encoding: "utf-8",
  });
  assert.equal(run.status, 0);
  assert.ok(run.stderr.includes("run history: skipping"));
  assert.ok(run.stderr.includes("no run history yet")); // nothing usable remained
});

test("CLI: a 1.1-era snapshot without buckets falls back to the flat band (AE14)", () => {
  const dir = setup();
  const day = yesterday();
  const prev = twoDaysAgo();
  // Two distinct days so the current run buckets; whole-table spend 50 + 59 =
  // 109 and row_count 2 match the pre-buckets snapshot, so only spend drifts.
  writeFileSync(join(dir, "export.csv"), `day,spend\n${prev},50\n${day},59\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  const oldSnapshot = {
    kind: "run_snapshot",
    spec_version: "1.1",
    created_at: "2026-01-01T00:00:00Z",
    chain_tail_hash: "ab".repeat(32),
    source: { filename: "export.csv", declared_origin: "t", columns: ["day", "spend"] },
    stages: [
      {
        name: "source",
        kind: "source_manifest",
        totals: {
          row_count: 2,
          column_count: 2,
          numeric_sums: { spend: "100" },
          date_ranges: {},
          null_counts: {},
        },
      },
    ],
  };
  const history = join(dir, "receipts", HISTORY_DIRNAME);
  mkdirSync(history, { recursive: true });
  // Content-addressed name does not matter for loading; loadSnapshots reads
  // every *.json and validates the body.
  writeFileSync(join(history, "old.json"), JSON.stringify(oldSnapshot, null, 2) + "\n");

  const { stdout, status, stderr } = runCli(dir, ["verify", "receipts/chain.json", "--json"], {
    expectFail: true,
  });
  assert.equal(status, 2);
  const payload = JSON.parse(stdout);
  assert.deepEqual(payload.caveats, [
    "totals drift beyond declared band: spend moved +9% against the previous run (whole-table comparison)",
  ]);
  assert.equal(payload.caveat_details[0].worst.period, "whole-table");
});

test("CLI: a bucket column that disappears emits the bucket_loss caveat", () => {
  const dir = setup();
  const day = yesterday();
  const prev = twoDaysAgo();
  // Run 1 has a bucket column (two distinct days) and archives a snapshot with
  // period_buckets. row_count 2, whole-table spend 109.
  writeFileSync(join(dir, "export.csv"), `day,spend\n${prev},50\n${day},59\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);
  runCli(dir, ["verify", "receipts/chain.json"]);

  // Run 2 drops the date column entirely: no bucket column now, so period
  // judgment is unavailable (bucket_loss) but the flat band still covers the
  // whole-table spend, which is unchanged here, so only bucket_loss fires.
  writeFileSync(join(dir, "export.csv"), `label,spend\na,50\nb,59\n`);
  runCli(dir, ["ingest", "export.csv", "--origin", "t", "--band", "5%"]);

  const { stdout, status } = runCli(dir, ["verify", "receipts/chain.json", "--json"], {
    expectFail: true,
  });
  assert.equal(status, 2);
  const payload = JSON.parse(stdout);
  assert.ok(
    payload.caveats.includes("bucket column no longer detected; period judgment unavailable")
  );
  assert.ok(payload.caveat_details.some((d) => d.type === "bucket_loss"));
});

// --- Cross-stack parity ------------------------------------------------------

test("Python-written history judged by the node CLI emits the pinned caveat_details", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-judgment-parity-"));
  cpSync(parityDir, join(dir, "receipts"), { recursive: true });
  const expected = JSON.parse(
    readFileSync(join(parityDir, "expected_caveat_details.json"), "utf-8")
  );

  const { stdout, status } = runCli(dir, ["verify", "receipts/chain.json", "--json"], {
    expectFail: true,
  });
  assert.equal(status, 2);
  const payload = JSON.parse(stdout);
  assert.deepEqual(payload.caveats, expected.caveats);
  // IDENTICAL caveat_details JSON across stacks: compare serialized bytes.
  assert.equal(
    JSON.stringify(payload.caveat_details, null, 2),
    JSON.stringify(expected.caveat_details, null, 2)
  );

  // The judgeCrossRun engine reproduces the same breached map directly.
  const chain = JSON.parse(readFileSync(join(dir, "receipts", "chain.json"), "utf-8"));
  const receipts = chain.receipts.map((name) =>
    JSON.parse(readFileSync(join(dir, "receipts", name), "utf-8"))
  );
  const history = join(parityDir, HISTORY_DIRNAME);
  const snapshots = readdirSync(history).map((name) =>
    JSON.parse(readFileSync(join(history, name), "utf-8"))
  );
  const judgment = judgeCrossRun(receipts, chain, snapshots);
  assert.deepEqual(judgment.breached, expected.breached);
  assert.deepEqual(judgment.caveats, expected.caveats);
});

test("node-written reverse-parity fixture reproduces its pinned caveat_details", () => {
  // Guards the committed reverse fixture (a NODE-written history snapshot,
  // judged here by Python's verify in tests/test_judgment.py) from drifting:
  // the node CLI must still reproduce the same pinned bytes on it.
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-judgment-parity-reverse-"));
  cpSync(parityReverseDir, join(dir, "receipts"), { recursive: true });
  const expected = JSON.parse(
    readFileSync(join(parityReverseDir, "expected_caveat_details.json"), "utf-8")
  );

  const { stdout, status } = runCli(dir, ["verify", "receipts/chain.json", "--json"], {
    expectFail: true,
  });
  assert.equal(status, 2);
  const payload = JSON.parse(stdout);
  assert.deepEqual(payload.caveats, expected.caveats);
  assert.equal(
    JSON.stringify(payload.caveat_details, null, 2),
    JSON.stringify(expected.caveat_details, null, 2)
  );
});
