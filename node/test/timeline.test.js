// Narrow published provenance timeline (plan U3), Node side. The cross-stack
// byte-identical body is exercised by the interop smoke; this pins the
// structure and the signed/bound integrity.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildAnnotation, writeAnnotation } from "../annotations.js";
import { semanticHash } from "../canonical.js";
import { generateKeys, loadPrivateKey, publicHexFromPrivate } from "../keys.js";
import {
  buildSourceManifest,
  readChain,
  readReceipt,
  receiptFileHashes,
  verifySignature,
  writeChain,
  writeReceipt,
} from "../receipts.js";
import { buildTimeline } from "../timeline.js";

function seedChain() {
  const dir = mkdtempSync(join(tmpdir(), "tstl-"));
  generateKeys(join(dir, "keys"));
  const priv = loadPrivateKey(join(dir, "keys", "signing.key"));
  const pub = publicHexFromPrivate(priv);
  const records = [
    { day: "2026-05-01", amount: "10" },
    { day: "2026-05-02", amount: "20" },
  ];
  const manifest = buildSourceManifest({
    filename: "s.csv", evidenceHash: "00", byteSize: 1, declaredOrigin: "smoke",
    semanticHash: semanticHash(records), records, privateKey: priv,
  });
  const cdir = join(dir, "receipts");
  writeReceipt(cdir, "000_source.json", manifest);
  writeChain(cdir, ["000_source.json"], pub);
  const target = receiptFileHashes(cdir, ["000_source.json"])["000_source.json"];
  return { cdir, priv, pub, target };
}

test("timeline lists the import with its signed annotation; signed and chain-bound", () => {
  const { cdir, priv, pub, target } = seedChain();
  writeAnnotation(cdir, buildAnnotation({ target, reason: "source looks right", author: "Jeff", privateKey: priv }));
  const chain = readChain(join(cdir, "chain.json"));
  const receipts = chain.receipts.map((n) => readReceipt(cdir, n));
  const doc = buildTimeline(receipts, chain, cdir, { key: priv });

  assert.equal(doc.kind, "timeline");
  assert.equal(doc.chain_tail, chain.receipt_hashes[chain.receipts[chain.receipts.length - 1]]);
  assert.equal(doc.entries[0].kind, "import");
  assert.equal(doc.entries[0].annotations[0].reason, "source looks right");
  assert.equal(doc.entries[0].annotations[0].self_declared, true);
  assert.ok(verifySignature(doc, pub));
});

test("timeline omits per-day buckets and date ranges", () => {
  const { cdir } = seedChain();
  const chain = readChain(join(cdir, "chain.json"));
  const receipts = chain.receipts.map((n) => readReceipt(cdir, n));
  const doc = buildTimeline(receipts, chain, cdir, {});
  for (const entry of doc.entries) {
    assert.ok(!("period_buckets" in entry.totals));
    assert.ok(!("date_ranges" in entry.totals));
  }
});
