// End-to-end in Node: keygen -> ingest CSV -> receiptStep transform ->
// verify green; tamper -> red; foreign input -> ChainTailMismatch.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { evidenceHash, semanticHash } from "../canonical.js";
import { generateKeys, loadPrivateKey, publicHexFromPrivate } from "../keys.js";
import { loadCsv } from "../load.js";
import {
  SOURCE_RECEIPT_NAME,
  buildSourceManifest,
  loadReceipts,
  readReceipt,
  verifyChain,
  writeChain,
  writeReceipt,
} from "../receipts.js";
import { ChainTailMismatch, receiptStep } from "../wrapper.js";

const CSV = "date,campaign_name,spend_usd\n2026-05-01,a,10.50\n2026-05-02,b,20.00\n2026-05-03,,5\n";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-"));
  const keys = join(dir, "keys");
  const chainDir = join(dir, "receipts");
  generateKeys(keys);
  const privateKey = loadPrivateKey(join(keys, "signing.key"));
  const publicHex = publicHexFromPrivate(privateKey);

  const csvPath = join(dir, "export.csv");
  writeFileSync(csvPath, CSV);
  const records = loadCsv(csvPath);
  const manifest = buildSourceManifest({
    filename: "export.csv",
    evidenceHash: evidenceHash(Buffer.from(CSV)),
    byteSize: CSV.length,
    declaredOrigin: "test export",
    semanticHash: semanticHash(records),
    records,
    privateKey,
  });
  writeReceipt(chainDir, SOURCE_RECEIPT_NAME, manifest);
  writeChain(chainDir, [SOURCE_RECEIPT_NAME], publicHex);
  return { dir, keys, chainDir, records, publicHex };
}

test("ingest -> wrapped transform -> verify green", async () => {
  const { keys, chainDir, records, publicHex } = setup();

  const clean = receiptStep((rows) => rows.filter((r) => r.campaign_name !== null), {
    chainDir,
    keyPath: join(keys, "signing.key"),
    codeFile: "test/chain.test.js",
  });
  const output = await clean(records);
  assert.equal(output.length, 2);

  const receipts = loadReceipts(chainDir);
  assert.equal(receipts.length, 2);
  const result = verifyChain(receipts, publicHex);
  assert.equal(result.verdict, "green");
  // The receipt caught the silent row drop in its totals.
  assert.equal(receipts[1].output_control_totals.row_count, 2);
});

test("tampered receipt turns the chain red", async () => {
  const { keys, chainDir, records, publicHex } = setup();
  const step = receiptStep((rows) => rows, { chainDir, keyPath: join(keys, "signing.key") });
  await step(records);

  const name = "001_transform.json";
  const receipt = readReceipt(chainDir, name);
  receipt.output_semantic_hash = "0".repeat(64); // tamper without re-signing
  writeReceipt(chainDir, name, receipt);

  const result = verifyChain(loadReceipts(chainDir), publicHex);
  assert.equal(result.verdict, "red");
  assert.match(result.lines[0], /SIGNATURE INVALID/);
});

test("foreign input is refused before the transform runs", async () => {
  const { keys, chainDir } = setup();
  let ran = false;
  const step = receiptStep(
    (rows) => {
      ran = true;
      return rows;
    },
    { chainDir, keyPath: join(keys, "signing.key") }
  );
  await assert.rejects(step([{ not: "the chain tail" }]), ChainTailMismatch);
  assert.equal(ran, false);
});

test("rotated trusted-key sets verify chains signed under the old key", async () => {
  const { chainDir, publicHex } = setup();
  const otherDir = mkdtempSync(join(tmpdir(), "tamper-signal-rot-"));
  generateKeys(otherDir);
  const newHex = publicHexFromPrivate(loadPrivateKey(join(otherDir, "signing.key")));

  const receipts = loadReceipts(chainDir);
  // New + old trusted: green. New only (no fallback): red.
  assert.equal(verifyChain(receipts, [newHex, publicHex]).verdict, "green");
  assert.equal(verifyChain(receipts, [newHex]).verdict, "red");
});

test("unrecognized signing key with a trusted set is yellow and names the keyset", () => {
  const { chainDir, publicHex } = setup();
  const otherDir = mkdtempSync(join(tmpdir(), "tamper-signal-rot-"));
  generateKeys(otherDir);
  const newHex = publicHexFromPrivate(loadPrivateKey(join(otherDir, "signing.key")));

  const receipts = loadReceipts(chainDir);
  // Verifies under the chain-embedded key but not the trusted set: yellow.
  const result = verifyChain(receipts, [newHex], null, null, { chainPublicHex: publicHex });
  assert.equal(result.verdict, "yellow");
  assert.match(result.caveats[0], /1 trusted key/);
});

test("TAMPER_SIGNAL_KEY env supplies the signing key", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-env-"));
  generateKeys(dir);
  const pem = readFileSync(join(dir, "signing.key"), "utf-8");
  // Expected value comes from the FILE before the env override exists, so the
  // assertion really compares env-loading against file-loading.
  const expected = publicHexFromPrivate(loadPrivateKey(join(dir, "signing.key")));
  process.env.TAMPER_SIGNAL_KEY = pem;
  try {
    const key = loadPrivateKey(join(dir, "missing.key"));
    assert.equal(publicHexFromPrivate(key), expected);
  } finally {
    delete process.env.TAMPER_SIGNAL_KEY;
  }
});
