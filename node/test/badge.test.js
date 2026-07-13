// Executes the browser verification core (badge/badge.js) under Node's
// WebCrypto. The static drift test proves the shipped copies are byte-equal;
// this one actually runs the logic: multi-key rotation, the yellow fallback,
// and the receipt-hash enforcement that makes anchoring meaningful.

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
  readReceipt,
  writeChain,
  writeReceipt,
} from "../receipts.js";

// badge.js expects a browser; give it just enough of one before importing.
globalThis.window = { location: { href: "http://localhost/" }, crypto: globalThis.crypto };

const { verifyReceipts, invalidateVerification, ed25519Available } = await import(
  "../../badge/badge.js"
);

const CSV = "date,campaign_name,spend_usd\n2026-05-01,a,10.50\n2026-05-02,b,20.00\n";

function buildChainDir() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-badge-"));
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
    declaredOrigin: "badge test",
    semanticHash: semanticHash(records),
    records,
    privateKey,
  });
  writeReceipt(chainDir, SOURCE_RECEIPT_NAME, manifest);
  writeChain(chainDir, [SOURCE_RECEIPT_NAME], publicHex);
  return { chainDir, publicHex };
}

function serve(chainDir) {
  // Route badge.js's fetch() calls to the files on disk, by basename. Every
  // test reuses the URL "chain.json" for a different directory, so bust the
  // verification memo at the same moment the stub is swapped.
  invalidateVerification();
  globalThis.fetch = async (url) => {
    const name = decodeURIComponent(String(url).split("/").pop());
    const buf = readFileSync(join(chainDir, name));
    return {
      json: async () => JSON.parse(buf.toString("utf-8")),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
}

// Node ships WebCrypto Ed25519 from 18 on, but gate anyway: where it is
// missing these tests prove nothing and should skip loudly, not fail.
const available = await ed25519Available();

test("browser core: green under the chain key and a rotated keyset", { skip: !available }, async () => {
  const { chainDir, publicHex } = buildChainDir();
  serve(chainDir);
  assert.equal((await verifyReceipts("chain.json")).state, "green");
  assert.equal((await verifyReceipts("chain.json", publicHex)).state, "green");
  assert.equal((await verifyReceipts("chain.json", [publicHex])).state, "green");

  const otherDir = mkdtempSync(join(tmpdir(), "tamper-signal-badge-rot-"));
  generateKeys(otherDir);
  const otherHex = publicHexFromPrivate(loadPrivateKey(join(otherDir, "signing.key")));
  assert.equal((await verifyReceipts("chain.json", [otherHex, publicHex])).state, "green");

  const yellow = await verifyReceipts("chain.json", [otherHex]);
  assert.equal(yellow.state, "yellow");
  assert.match(yellow.caveats[0], /unrecognized signing key/);
});

test("browser core: receipt rewritten after the chain is red", { skip: !available }, async () => {
  const { chainDir } = buildChainDir();
  serve(chainDir);
  const receipt = readReceipt(chainDir, SOURCE_RECEIPT_NAME);
  receipt.semantic_hash = "0".repeat(64);
  writeReceipt(chainDir, SOURCE_RECEIPT_NAME, receipt);

  const result = await verifyReceipts("chain.json");
  assert.equal(result.state, "red");
  assert.match(result.reason, /receipt file mismatch/);
});

test("browser core: chains without receipt hashes still verify", { skip: !available }, async () => {
  const { chainDir } = buildChainDir();
  serve(chainDir);
  const chainPath = join(chainDir, "chain.json");
  const chain = JSON.parse(readFileSync(chainPath, "utf-8"));
  delete chain.receipt_hashes; // chains written before 1.5.0
  writeFileSync(chainPath, JSON.stringify(chain, null, 2) + "\n");
  assert.equal((await verifyReceipts("chain.json")).state, "green");
});
