// The JS-track pipeline helpers: canonicalDocument (table.json contents),
// ingestFile (programmatic, resetting ingest), and rebuildChain (idempotent
// "rebuild on data change"). See issues #20 and #22.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { canonicalDocument, canonicalJsonBytes, canonicalize, semanticHash } from "../canonical.js";
import { createHash } from "node:crypto";
import { generateKeys, loadPrivateKey, publicHexFromPrivate } from "../keys.js";
import {
  SOURCE_RECEIPT_NAME,
  loadReceipts,
  outputHashOf,
  readChainFiles,
  verifyChain,
  writeReceipt,
} from "../receipts.js";
import {
  ChainTailMismatch,
  ingestFile,
  parseBand,
  parseSettle,
  rebuildChain,
  receiptStep,
} from "../wrapper.js";

const CSV = "date,campaign_name,spend_usd\n2026-05-01,a,10.50\n2026-05-02,b,20.00\n2026-05-03,,5\n";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-"));
  const keys = join(dir, "keys");
  const chainDir = join(dir, "receipts");
  generateKeys(keys);
  const csvPath = join(dir, "export.csv");
  writeFileSync(csvPath, CSV);
  return { dir, keyPath: join(keys, "signing.key"), chainDir, csvPath };
}

test("canonicalDocument is the table.json the Data tab verifies against", () => {
  const records = [
    { date: "2026-05-01", campaign_name: "a", spend_usd: "10.50" },
    { date: "2026-05-02", campaign_name: "b", spend_usd: "20.00" },
  ];
  const doc = canonicalDocument(records);
  assert.ok(Array.isArray(doc.headers) && Array.isArray(doc.rows));
  // canonicalize is exactly canonicalJsonBytes(canonicalDocument(records)).
  assert.deepEqual(canonicalize(records), canonicalJsonBytes(doc));
  // And those bytes re-hash to the record set's semantic hash -- the value a
  // receipt records, so writing this doc to table.json reads as VERIFIED.
  const h = createHash("sha256").update(canonicalJsonBytes(doc)).digest("hex");
  assert.equal(h, semanticHash(records));
});

test("ingestFile writes a source manifest and resets the chain to it", () => {
  const { keyPath, chainDir, csvPath } = setup();
  const { manifest, sourceHash } = ingestFile({ file: csvPath, chainDir, keyPath, declaredOrigin: "t" });
  assert.equal(manifest.kind, "source_manifest");
  assert.equal(sourceHash, manifest.semantic_hash);
  assert.deepEqual(readChainFiles(chainDir), [SOURCE_RECEIPT_NAME]);

  // Idempotent: re-ingesting resets the chain to just the source again.
  ingestFile({ file: csvPath, chainDir, keyPath });
  assert.deepEqual(readChainFiles(chainDir), [SOURCE_RECEIPT_NAME]);
});

test("rebuildChain runs source + stages and is idempotent across re-runs", async () => {
  const { keyPath, chainDir, csvPath } = setup();
  const dropBlankCampaign = (rows) => rows.filter((r) => r.campaign_name !== null && r.campaign_name !== "");

  const out1 = await rebuildChain({ file: csvPath, stages: [dropBlankCampaign], chainDir, keyPath });
  assert.equal(out1.length, 2); // the blank-campaign row dropped
  assert.deepEqual(readChainFiles(chainDir), [SOURCE_RECEIPT_NAME, "001_dropBlankCampaign.json"]);

  // Re-running must not throw ChainTailMismatch and must yield the same chain.
  const out2 = await rebuildChain({ file: csvPath, stages: [dropBlankCampaign], chainDir, keyPath });
  assert.deepEqual(out2, out1);
  assert.deepEqual(readChainFiles(chainDir), [SOURCE_RECEIPT_NAME, "001_dropBlankCampaign.json"]);
});

test("the rebuilt chain's final output hashes to its table document", async () => {
  const { keyPath, chainDir, csvPath } = setup();
  const normalize = (rows) => rows.map((r) => ({ ...r, campaign_name: r.campaign_name ?? "(none)" }));
  const final = await rebuildChain({ file: csvPath, stages: [normalize], chainDir, keyPath });

  // The export invariant: canonicalDocument(final) re-hashes to the final
  // receipt's output hash (so the browser Data tab reads VERIFIED).
  const receipts = loadReceipts(chainDir);
  const finalReceipt = receipts[receipts.length - 1];
  const h = createHash("sha256").update(canonicalize(final)).digest("hex");
  assert.equal(h, outputHashOf(finalReceipt));

  // canonicalDocument shape is what we'd write to table.json.
  const doc = canonicalDocument(final);
  assert.ok(doc.headers.includes("campaign_name"));
});

test("rebuildChain rejects non-function stages", async () => {
  const { keyPath, chainDir, csvPath } = setup();
  await assert.rejects(
    () => rebuildChain({ file: csvPath, stages: [42], chainDir, keyPath }),
    /records -> records functions/,
  );
});

// Sanity: the raw receiptStep re-run problem rebuildChain solves still exists,
// so the helper is earning its place (not masking a regression).
test("plain re-ingest then stale tail still throws ChainTailMismatch", async () => {
  const { keyPath, chainDir, csvPath } = setup();
  const { records } = ingestFile({ file: csvPath, chainDir, keyPath });
  // A real transform whose output differs from its input (drops a row), so the
  // new chain tail no longer equals the source.
  const step = receiptStep((rows) => rows.slice(1), { chainDir, keyPath });
  await step(records); // appends 001
  // Feeding the original source again now mismatches the new tail.
  await assert.rejects(() => step(records), ChainTailMismatch);
});

// --- Tolerance declarations at ingest (U3) ----------------------------------

// Two qualifying date columns: bucketing needs an explicit declaration.
const TWO_DATE_CSV =
  "created,settled,amount\n2026-05-01,2026-05-03,1\n2026-05-02,2026-05-03,2\n";

const publicHexFor = (keyPath) => publicHexFromPrivate(loadPrivateKey(keyPath));

test("ingest with band records a signed tolerance with the default settle", () => {
  const { keyPath, chainDir, csvPath } = setup();
  const { manifest } = ingestFile({ file: csvPath, chainDir, keyPath, band: "5%" });
  assert.deepEqual(manifest.tolerance, { band: "0.05", settle_hours: 72 });

  // The declaration is covered by the signature: the chain verifies as-is.
  const result = verifyChain(loadReceipts(chainDir), publicHexFor(keyPath));
  assert.equal(result.verdict, "green");
  assert.deepEqual(result.caveats, []);
});

test("hand-editing the signed band turns verification red", () => {
  const { keyPath, chainDir, csvPath } = setup();
  const { manifest } = ingestFile({ file: csvPath, chainDir, keyPath, band: "5%" });
  manifest.tolerance.band = "0.10";
  writeReceipt(chainDir, SOURCE_RECEIPT_NAME, manifest);

  const result = verifyChain(loadReceipts(chainDir), publicHexFor(keyPath));
  assert.equal(result.verdict, "red");
  assert.ok(result.lines[0].includes("SIGNATURE INVALID"));
});

test("ingest without tolerance options writes no tolerance field", () => {
  const { keyPath, chainDir, csvPath } = setup();
  const { manifest } = ingestFile({ file: csvPath, chainDir, keyPath });
  assert.ok(!("tolerance" in manifest));
  // Frozen pre-declaration body shape: undeclared chains stay byte-compatible.
  assert.deepEqual(Object.keys(manifest), [
    "kind", "spec_version", "created_at", "source",
    "semantic_hash", "control_totals", "signature",
  ]);
  const result = verifyChain(loadReceipts(chainDir), publicHexFor(keyPath));
  assert.equal(result.verdict, "green");
  assert.deepEqual(result.caveats, []);
});

test("invalid band and settle values throw with nothing written", () => {
  const { keyPath, chainDir, csvPath } = setup();
  const cases = [
    [{ band: "-3%" }, /invalid --band '-3%': must be greater than zero/],
    [{ band: "0" }, /invalid --band '0': must be greater than zero/],
    [{ band: "banana" }, /invalid --band 'banana': not a number/],
    [{ band: "150%" }, /invalid --band '150%': must not exceed 100%/],
    [{ band: "5" }, /invalid --band '5': must not exceed 100%/],
    [{ settle: "0" }, /invalid --settle '0': must be a positive number of hours/],
    [{ settle: "-5" }, /invalid --settle '-5': expected a whole number of hours/],
    [{ settle: "banana" }, /invalid --settle 'banana': expected a whole number of hours/],
    [{ settle: "1.5h" }, /invalid --settle '1.5h': expected a whole number of hours/],
  ];
  for (const [options, message] of cases) {
    assert.throws(() => ingestFile({ file: csvPath, chainDir, keyPath, ...options }), message);
  }
  assert.deepEqual(readChainFiles(chainDir), []); // nothing was written
});

test("settle 3d converts to 72 hours and implies the default band", () => {
  const { keyPath, chainDir, csvPath } = setup();
  const { manifest } = ingestFile({ file: csvPath, chainDir, keyPath, settle: "3d" });
  assert.deepEqual(manifest.tolerance, { band: "0.05", settle_hours: 72 });
});

test("bucketColumn declares and keys the period buckets", () => {
  const { dir, keyPath, chainDir } = setup();
  const csvPath = join(dir, "two-dates.csv");
  writeFileSync(csvPath, TWO_DATE_CSV);
  const { manifest } = ingestFile({ file: csvPath, chainDir, keyPath, bucketColumn: "created" });
  assert.deepEqual(manifest.tolerance, {
    band: "0.05",
    settle_hours: 72,
    bucket_column: "created",
  });
  assert.equal(manifest.control_totals.bucket_column, "created");
  assert.deepEqual(Object.keys(manifest.control_totals.period_buckets), [
    "2026-05-01",
    "2026-05-02",
  ]);
});

test("non-qualifying bucketColumn throws with nothing written", () => {
  const { dir, keyPath, chainDir } = setup();
  const csvPath = join(dir, "two-dates.csv");
  writeFileSync(csvPath, TWO_DATE_CSV);
  assert.throws(
    () => ingestFile({ file: csvPath, chainDir, keyPath, bucketColumn: "amount" }),
    /bucket column 'amount' does not qualify/
  );
  assert.deepEqual(readChainFiles(chainDir), []);
});

test("rebuildChain passes the tolerance declaration through to the source", async () => {
  const { keyPath, chainDir, csvPath } = setup();
  const identity = (rows) => rows;
  await rebuildChain({ file: csvPath, stages: [identity], chainDir, keyPath, band: "5%", settle: "3d" });
  const [source] = loadReceipts(chainDir);
  assert.deepEqual(source.tolerance, { band: "0.05", settle_hours: 72 });
});

test("parseBand and parseSettle pin the canonical forms", () => {
  // Same pins as tests/test_cli_agent_ergonomics.py.
  assert.equal(parseBand("5%"), "0.05");
  assert.equal(parseBand("5 %"), "0.05");
  assert.equal(parseBand("0.05"), "0.05");
  assert.equal(parseBand("0.050"), "0.05");
  assert.equal(parseBand("5.5%"), "0.055");
  assert.equal(parseBand("100%"), "1");
  assert.equal(parseSettle("3d"), 72);
  assert.equal(parseSettle("72h"), 72);
  assert.equal(parseSettle("72"), 72);
});

test("CLI ingest records the declaration and rejects invalid bands with exit 1", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { keyPath, chainDir, csvPath } = setup();
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));

  const out = execFileSync(
    process.execPath,
    [cli, "ingest", csvPath, "--key", keyPath, "--out", chainDir, "--band", "5%", "--settle", "3d"],
    { encoding: "utf-8" }
  );
  assert.ok(out.includes("tolerance band 0.05, settle_hours 72"));
  const [source] = loadReceipts(chainDir);
  assert.deepEqual(source.tolerance, { band: "0.05", settle_hours: 72 });

  let failed = null;
  try {
    execFileSync(
      process.execPath,
      [cli, "ingest", csvPath, "--key", keyPath, "--out", join(chainDir, "fresh"), "--band", "banana"],
      { encoding: "utf-8" }
    );
  } catch (err) {
    failed = err;
  }
  assert.equal(failed?.status, 1);
  assert.ok(failed.stderr.includes("invalid --band 'banana': not a number"));
  assert.deepEqual(readChainFiles(join(chainDir, "fresh")), []);
});

// --- ingest reset warning parity (mirrors Python _warn_if_unsnapshotted_reset) ---

test("CLI ingest warns when it resets a chain whose run never reached history", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { keyPath, chainDir, csvPath, dir } = setup();
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const pub = join(dir, "keys", "signing.pub");
  // Run every CLI invocation with cwd = the tmpdir so verify's snapshot-signing
  // key (resolved from the relative keys/signing.key) is the SAME key that
  // signs the chain. Otherwise a stray keys/signing.key in the repo cwd would
  // sign the snapshot under a key historyHasTail does not trust.
  const ingest = () =>
    spawnSync(process.execPath, [cli, "ingest", csvPath, "--key", keyPath, "--out", chainDir], {
      encoding: "utf-8",
      cwd: dir,
    });

  // First ingest: no prior chain.json, so no warning.
  const first = ingest();
  assert.equal(first.status, 0);
  assert.ok(!first.stderr.includes("previous run was never verified"));

  // Second ingest WITHOUT a verify in between: the prior run never reached
  // history, so resetting it must warn (stderr only; ingest still exits 0).
  const reset = ingest();
  assert.equal(reset.status, 0);
  assert.ok(
    reset.stderr.includes("previous run was never verified; its totals will not enter history"),
    `expected reset warning, got stderr: ${reset.stderr}`
  );

  // Verify archives a run snapshot for the current chain tail; a following
  // re-ingest finds the outgoing run in history, so no warning fires.
  const verify = spawnSync(
    process.execPath,
    [cli, "verify", join(chainDir, "chain.json"), "--pub", pub],
    { encoding: "utf-8", cwd: dir }
  );
  assert.equal(verify.status, 0, `verify failed: ${verify.stderr}`);
  const afterVerify = ingest();
  assert.equal(afterVerify.status, 0);
  assert.ok(
    !afterVerify.stderr.includes("previous run was never verified"),
    `unexpected reset warning after verify, stderr: ${afterVerify.stderr}`
  );
});

test("a tolerance-bearing manifest body canonicalizes to the pinned cross-stack hash", () => {
  // tests/test_cli_agent_ergonomics.py pins this exact body to this hash:
  // identical canonical bytes in both stacks, floats never enter the body.
  const body = {
    kind: "source_manifest",
    spec_version: "1.2",
    created_at: "2026-06-12T00:00:00Z",
    source: {
      filename: "export.csv",
      evidence_hash: "aa".repeat(32),
      byte_size: 64,
      declared_origin: "tolerance pin",
    },
    semantic_hash: "bb".repeat(32),
    control_totals: {
      row_count: 2,
      column_count: 2,
      numeric_sums: { amount: "15" },
      date_ranges: {},
      null_counts: {},
      bucket_column: "day",
      period_buckets: {
        "2026-05-01": { row_count: 2, numeric_sums: { amount: "15" }, null_counts: {} },
      },
    },
    tolerance: { band: "0.05", settle_hours: 72, bucket_column: "day" },
  };
  const hash = createHash("sha256").update(canonicalJsonBytes(body)).digest("hex");
  assert.equal(hash, "1902cc6dd98a3150ffe5d6577753e5950a481386d1fb646d438d190282819732");
});
