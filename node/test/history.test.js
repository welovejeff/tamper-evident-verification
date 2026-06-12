// Run snapshots and the history directory (U4): content-addressed writes on
// non-red CLI verifies, defensive reads, the rebuildChain hook, and
// cross-stack parity against the Python-generated fixture under
// tests/fixtures/snapshot-parity/.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes } from "../canonical.js";
import {
  HISTORY_DIRNAME,
  buildRunSnapshot,
  latestSnapshot,
  loadSnapshots,
  snapshotBodyHash,
  writeRunSnapshot,
} from "../history.js";
import { generateKeys, loadPrivateKey, publicHexFromPrivate } from "../keys.js";
import { loadReceipts, readChain, readReceipt, verifySignature } from "../receipts.js";
import { rebuildChain } from "../wrapper.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "node", "cli.js");
const parityDir = join(repoRoot, "tests", "fixtures", "snapshot-parity");

const CSV = "day,amount\n2026-05-01,10.5\n2026-05-02,20\n";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-history-"));
  generateKeys(join(dir, "keys"));
  writeFileSync(join(dir, "export.csv"), CSV);
  return dir;
}

// Run the CLI with cwd = dir so the default keys/signing.key resolves the
// way it does for a real user (snapshot signing key resolution).
function runCli(dir, args, { expectFail = false } = {}) {
  // Clear TAMPER_SIGNAL_KEY so a developer's environment cannot leak into
  // the snapshot key resolution under test (empty string reads as unset).
  const env = { ...process.env, TAMPER_SIGNAL_KEY: "" };
  try {
    return {
      stdout: execFileSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: "utf-8" }),
      status: 0,
    };
  } catch (err) {
    if (!expectFail) throw err;
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", status: err.status };
  }
}

const historyFiles = (dir) => {
  try {
    return readdirSync(join(dir, "receipts", HISTORY_DIRNAME)).sort();
  } catch {
    return [];
  }
};

test("green CLI verify writes one content-addressed signed snapshot", () => {
  const dir = setup();
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  runCli(dir, ["verify", "receipts/chain.json"]);

  const files = historyFiles(dir);
  assert.equal(files.length, 1);
  const snapshot = JSON.parse(readFileSync(join(dir, "receipts", HISTORY_DIRNAME, files[0]), "utf-8"));
  assert.equal(files[0], `${snapshotBodyHash(snapshot)}.json`);

  const chain = readChain(join(dir, "receipts", "chain.json"));
  assert.ok(verifySignature(snapshot, chain.public_key));
  const last = chain.receipts[chain.receipts.length - 1];
  assert.equal(snapshot.chain_tail_hash, chain.receipt_hashes[last]);
  assert.deepEqual(snapshot.source.columns, ["amount", "day"]);
  assert.ok(snapshot.stages[0].totals.period_buckets);

  // Re-verifying the unchanged chain writes nothing new.
  runCli(dir, ["verify", "receipts/chain.json"]);
  assert.equal(historyFiles(dir).length, 1);
});

test("red CLI verify writes nothing", () => {
  const dir = setup();
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  const receiptPath = join(dir, "receipts", "000_source.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf-8"));
  receipt.control_totals.row_count = 99;
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

  const { status } = runCli(dir, ["verify", "receipts/chain.json"], { expectFail: true });
  assert.equal(status, 1);
  assert.deepEqual(historyFiles(dir), []);
});

test("without a key the snapshot is unsigned but still written", () => {
  // Sign the chain with a key OUTSIDE the default keys/ path, so verify
  // finds no private key to sign the snapshot with (no keys/signing.key).
  const clean = mkdtempSync(join(tmpdir(), "tamper-signal-history-"));
  writeFileSync(join(clean, "export.csv"), CSV);
  generateKeys(join(clean, "elsewhere"));
  runCli(clean, ["ingest", "export.csv", "--origin", "t", "--key", "elsewhere/signing.key"]);
  runCli(clean, ["verify", "receipts/chain.json"]);

  const files = historyFiles(clean);
  assert.equal(files.length, 1);
  const snapshot = JSON.parse(readFileSync(join(clean, "receipts", HISTORY_DIRNAME, files[0]), "utf-8"));
  assert.ok(!("signature" in snapshot));

  const items = loadSnapshots(join(clean, "receipts"));
  assert.equal(items.length, 1);
  assert.equal(items[0].signed, false);
  assert.equal(items[0].verified, false);
});

test("loadSnapshots skips garbage, future timestamps, and bad signatures", () => {
  const dir = setup();
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  runCli(dir, ["verify", "receipts/chain.json"]);
  const chainDir = join(dir, "receipts");
  const history = join(chainDir, HISTORY_DIRNAME);
  const chain = readChain(join(chainDir, "chain.json"));
  const receipts = loadReceipts(chainDir);

  writeFileSync(join(history, "garbage.json"), "not json {");
  writeFileSync(join(history, "list.json"), "[1, 2, 3]");
  const future = new Date(Date.now() + 2 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  writeRunSnapshot(chainDir, buildRunSnapshot(receipts, chain, { chainDir, createdAt: future }));
  // A signed snapshot whose body was edited after signing: skipped.
  const signed = buildRunSnapshot(receipts, chain, {
    privateKey: loadPrivateKey(join(dir, "keys", "signing.key")),
    chainDir,
    createdAt: "2026-06-01T00:00:00Z",
  });
  signed.chain_tail_hash = "ee".repeat(32);
  writeRunSnapshot(chainDir, signed);

  const notices = [];
  const items = loadSnapshots(chainDir, {
    trustedKeys: [chain.public_key],
    onNotice: (m) => notices.push(m),
  });
  assert.equal(items.length, 1); // only the CLI-written snapshot survives
  assert.equal(items[0].verified, true);
  assert.ok(notices.some((n) => n.includes("garbage.json")));
  assert.ok(notices.some((n) => n.includes("not a run snapshot")));
  assert.ok(notices.some((n) => n.includes("in the future")));
  assert.ok(notices.some((n) => n.includes("signature does not verify")));
});

test("latest prefers the newest created_at; ties break on body hash", () => {
  const dir = setup();
  runCli(dir, ["ingest", "export.csv", "--origin", "t"]);
  const chainDir = join(dir, "receipts");
  const chain = readChain(join(chainDir, "chain.json"));
  const receipts = loadReceipts(chainDir);
  writeRunSnapshot(chainDir, buildRunSnapshot(receipts, chain, { chainDir, createdAt: "2026-06-01T00:00:00Z" }));
  writeRunSnapshot(chainDir, buildRunSnapshot(receipts, chain, { chainDir, createdAt: "2026-06-02T00:00:00Z" }));
  const latest = latestSnapshot(chainDir);
  assert.equal(latest.snapshot.created_at, "2026-06-02T00:00:00Z");

  const items = loadSnapshots(chainDir);
  const resorted = [...items].sort((a, b) =>
    a.created_at === b.created_at
      ? (a.body_hash < b.body_hash ? 1 : -1)
      : (a.created_at < b.created_at ? 1 : -1)
  );
  assert.deepEqual(items, resorted);
});

test("the history scanner rejects symlinks out of the history dir", (t) => {
  const dir = setup();
  const chainDir = join(dir, "receipts");
  const history = join(chainDir, HISTORY_DIRNAME);
  mkdirSync(history, { recursive: true });
  const secret = join(dir, "secret.json");
  writeFileSync(secret, JSON.stringify({ kind: "run_snapshot", created_at: "2026-06-01T00:00:00Z" }));
  try {
    symlinkSync(secret, join(history, "escape.json"));
  } catch {
    t.skip("platform does not support symlinks here");
    return;
  }
  const notices = [];
  assert.deepEqual(loadSnapshots(chainDir, { onNotice: (m) => notices.push(m) }), []);
  assert.ok(notices.some((n) => n.includes("outside the history directory")));
});

test("readReceipt rejects history paths smuggled into chain.json", () => {
  const dir = setup();
  const chainDir = join(dir, "receipts");
  mkdirSync(join(chainDir, HISTORY_DIRNAME), { recursive: true });
  writeFileSync(join(chainDir, HISTORY_DIRNAME, "x.json"), "{}");
  assert.throws(
    () => readReceipt(chainDir, `${HISTORY_DIRNAME}/x.json`),
    /Unsafe receipt path/
  );
});

test("rebuildChain archives a signed snapshot after its stages", async () => {
  const dir = setup();
  const chainDir = join(dir, "receipts");
  const keyPath = join(dir, "keys", "signing.key");
  const dropFirst = (rows) => rows.slice(1);
  await rebuildChain({ file: join(dir, "export.csv"), stages: [dropFirst], chainDir, keyPath });

  const chain = readChain(join(chainDir, "chain.json"));
  const items = loadSnapshots(chainDir, { trustedKeys: [chain.public_key] });
  assert.equal(items.length, 1);
  assert.equal(items[0].signed, true);
  assert.equal(items[0].verified, true);
  const last = chain.receipts[chain.receipts.length - 1];
  assert.equal(items[0].snapshot.chain_tail_hash, chain.receipt_hashes[last]);
  assert.deepEqual(
    items[0].snapshot.stages.map((s) => s.name),
    ["source", "dropFirst"]
  );
  assert.ok(items[0].snapshot.stages[1].code_hash);
});

// --- Cross-stack parity (fixture shared with tests/test_run_history.py) -----

test("the Python-generated snapshot fixture loads, verifies, and rebuilds byte-identically", () => {
  const chain = readChain(join(parityDir, "chain.json"));
  const items = loadSnapshots(parityDir, { trustedKeys: [chain.public_key] });
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.signed, true);
  assert.equal(item.verified, true); // Python-signed, Node-verified
  assert.equal(item.filename, `${item.body_hash}.json`);
  assert.equal(item.snapshot.chain_tail_hash, chain.receipt_hashes["001_clean.json"]);
  assert.deepEqual(item.snapshot.tolerance, { band: "0.05", settle_hours: 72, bucket_column: "day" });

  // Rebuilding the snapshot from the same chain with the same created_at
  // produces byte-identical canonical bytes, hence the same content address.
  const receipts = chain.receipts.map((name) => readReceipt(parityDir, name));
  const rebuilt = buildRunSnapshot(receipts, chain, {
    chainDir: parityDir,
    createdAt: item.snapshot.created_at,
  });
  const stored = {};
  for (const k of Object.keys(item.snapshot)) if (k !== "signature") stored[k] = item.snapshot[k];
  assert.deepEqual(canonicalJsonBytes(rebuilt), canonicalJsonBytes(stored));
  assert.equal(snapshotBodyHash(rebuilt), item.body_hash);
});

test("a snapshot body canonicalizes to the pinned cross-stack hash", () => {
  // tests/test_run_history.py pins this exact body to this hash: identical
  // canonical bytes in both stacks, floats never enter the body.
  const body = {
    kind: "run_snapshot",
    spec_version: "1.2",
    created_at: "2026-06-12T00:05:00Z",
    chain_tail_hash: "cc".repeat(32),
    source: {
      filename: "export.csv",
      declared_origin: "parity pin",
      columns: ["amount", "day"],
    },
    tolerance: { band: "0.05", settle_hours: 72 },
    stages: [
      {
        name: "source",
        kind: "source_manifest",
        totals: {
          row_count: 2,
          column_count: 2,
          numeric_sums: { amount: "30.5" },
          date_ranges: {},
          null_counts: {},
          bucket_column: "day",
          period_buckets: {
            "2026-05-01": { row_count: 1, numeric_sums: { amount: "10.5" }, null_counts: {} },
          },
        },
      },
      {
        name: "clean",
        kind: "transform_receipt",
        code_hash: "dd".repeat(32),
        code_file: "pipeline.py",
        totals: {
          row_count: 1,
          column_count: 2,
          numeric_sums: { amount: "10.5" },
          date_ranges: {},
          null_counts: {},
        },
      },
    ],
  };
  const hash = createHash("sha256").update(canonicalJsonBytes(body)).digest("hex");
  assert.equal(hash, "ac291de942d4a592131389f8f50bcbde149e1c59cc87bffa9fd613de40f425a3");
});
