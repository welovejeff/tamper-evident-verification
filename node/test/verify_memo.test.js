// The verification memo in badge.js: one light and one room on the same page
// must share one fetch of the chain and one Ed25519 pass per refresh cycle —
// but two mounts with DIFFERENT trusted keysets must NEVER share a result
// (the table-green/console-yellow bug cannot be reintroduced at the cache
// layer), and invalidateVerification busts synchronously.

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
  writeChain,
  writeReceipt,
} from "../receipts.js";

globalThis.window = { location: { href: "http://localhost/" }, crypto: globalThis.crypto };

const { verifyReceipts, invalidateVerification, ed25519Available } = await import(
  "../../badge/badge.js"
);

const CSV = "date,campaign_name,spend_usd\n2026-05-01,a,10.50\n2026-05-02,b,20.00\n";

function buildChainDir() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-memo-"));
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
    declaredOrigin: "memo test",
    semanticHash: semanticHash(records),
    records,
    privateKey,
  });
  writeReceipt(chainDir, SOURCE_RECEIPT_NAME, manifest);
  writeChain(chainDir, [SOURCE_RECEIPT_NAME], publicHex);
  return { chainDir, publicHex };
}

let fetchCount = {};
function serve(chainDir) {
  invalidateVerification();
  fetchCount = {};
  globalThis.fetch = async (url) => {
    const name = decodeURIComponent(String(url).split("/").pop());
    fetchCount[name] = (fetchCount[name] || 0) + 1;
    const buf = readFileSync(join(chainDir, name));
    return {
      ok: true,
      json: async () => JSON.parse(buf.toString("utf-8")),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
}

const available = await ed25519Available();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("in-flight dedupe: two concurrent calls share one fetch cycle", { skip: !available }, async () => {
  const { chainDir } = buildChainDir();
  serve(chainDir);
  const [a, b] = await Promise.all([verifyReceipts("chain.json"), verifyReceipts("chain.json")]);
  assert.equal(a.state, "green");
  assert.equal(a, b); // literally the same result object
  assert.equal(fetchCount["chain.json"], 1);
  assert.equal(fetchCount[SOURCE_RECEIPT_NAME], 1);
});

test("completed results are reused inside the TTL, then expire", { skip: !available }, async () => {
  const { chainDir } = buildChainDir();
  serve(chainDir);
  const first = await verifyReceipts("chain.json");
  const second = await verifyReceipts("chain.json");
  assert.equal(first, second);
  assert.equal(fetchCount["chain.json"], 1);
  // The TTL (250ms) is hard below the 1000ms minimum watch interval, so every
  // watch tick re-verifies.
  await sleep(300);
  const third = await verifyReceipts("chain.json");
  assert.notEqual(first, third);
  assert.equal(third.state, "green");
  assert.equal(fetchCount["chain.json"], 2);
});

test("different trusted keysets never share a result", { skip: !available }, async () => {
  const { chainDir, publicHex } = buildChainDir();
  serve(chainDir);
  const otherDir = mkdtempSync(join(tmpdir(), "tamper-signal-memo-rot-"));
  generateKeys(otherDir);
  const otherHex = publicHexFromPrivate(loadPrivateKey(join(otherDir, "signing.key")));

  const [embedded, trusted, untrusted] = await Promise.all([
    verifyReceipts("chain.json"),
    verifyReceipts("chain.json", publicHex),
    verifyReceipts("chain.json", [otherHex]),
  ]);
  assert.equal(embedded.state, "green");
  assert.equal(trusted.state, "green");
  assert.equal(untrusted.state, "yellow"); // unrecognized key — its own verdict
  assert.notEqual(embedded, trusted);
  assert.notEqual(trusted, untrusted);
  assert.equal(fetchCount["chain.json"], 3); // three keysets, three real runs

  // Keyset order does not defeat the memo (sorted key).
  const rotated = await verifyReceipts("chain.json", [publicHex, otherHex]);
  const rotatedAgain = await verifyReceipts("chain.json", [otherHex, publicHex]);
  assert.equal(rotated, rotatedAgain);
});

test("invalidateVerification busts synchronously", { skip: !available }, async () => {
  const { chainDir } = buildChainDir();
  serve(chainDir);
  const first = await verifyReceipts("chain.json");
  invalidateVerification("chain.json");
  const second = await verifyReceipts("chain.json");
  assert.notEqual(first, second);
  assert.equal(fetchCount["chain.json"], 2);
});
