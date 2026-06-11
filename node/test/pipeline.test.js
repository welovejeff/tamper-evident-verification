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
import { generateKeys } from "../keys.js";
import {
  SOURCE_RECEIPT_NAME,
  loadReceipts,
  outputHashOf,
  readChainFiles,
} from "../receipts.js";
import { ChainTailMismatch, ingestFile, rebuildChain, receiptStep } from "../wrapper.js";

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
