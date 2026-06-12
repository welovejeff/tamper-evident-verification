// Regenerate the REVERSE judgment-parity fixture (run from the repo root):
//
//     node tests/fixtures/judgment-parity-reverse/make_fixture.mjs
//
// The mirror of judgment-parity/make_fixture.py: here the run snapshot under
// history/ is written by the NODE stack (buildRunSnapshot / writeRunSnapshot),
// and tests/test_judgment.py judges it with Python's judge_cross_run. Both
// stacks must produce byte-identical caveat_details for the same inputs (R14),
// so this proves the parity holds in the JS-writes / Python-reads direction
// too. All timestamps are pinned in the past, so the verdict never depends on
// the machine clock. The signing key derives from a fixed seed (same scenario
// as the forward fixture) so regeneration reproduces identical bytes.

import { createHash, createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evidenceHash, semanticHash } from "../../../node/canonical.js";
import { buildRunSnapshot, judgeCrossRun, writeRunSnapshot } from "../../../node/history.js";
import { publicHexFromPrivate } from "../../../node/keys.js";
import {
  SOURCE_RECEIPT_NAME,
  buildSourceManifest,
  writeChain,
  writeReceipt,
} from "../../../node/receipts.js";

const here = dirname(fileURLToPath(import.meta.url));

const TOLERANCE = { band: "0.05", settle_hours: 72, bucket_column: "day" };

const PRIOR_ROWS = [
  { day: "2026-05-01", spend: "10" },
  { day: "2026-05-01", spend: "20" },
  { day: "2026-06-11", spend: "100" },
];

const CURRENT_ROWS = [
  { day: "2026-05-01", spend: "10" },
  { day: "2026-05-01", spend: "21" },
  { day: "2026-06-11", spend: "109" },
];

// A deterministic Ed25519 private key from a 32-byte seed: wrap the seed in
// the fixed PKCS8 DER prefix for an Ed25519 private key.
function privateFromSeed(seed) {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({ key: Buffer.concat([prefix, seed]), format: "der", type: "pkcs8" });
}

function csvBytes(rows) {
  return Buffer.from(`day,spend\n${rows.map((r) => `${r.day},${r.spend}`).join("\n")}\n`, "utf-8");
}

function manifest(rows, privateKey, createdAt) {
  const raw = csvBytes(rows);
  return buildSourceManifest({
    filename: "export.csv",
    evidenceHash: evidenceHash(raw),
    byteSize: raw.length,
    declaredOrigin: "judgment parity fixture",
    semanticHash: semanticHash(rows),
    records: rows,
    privateKey,
    createdAt,
    tolerance: TOLERANCE,
    bucketColumn: "day",
  });
}

function main() {
  // Clean stale artifacts (keep this script and expected json regenerated).
  for (const name of ["000_source.json", "chain.json", "history"]) {
    rmSync(join(here, name), { recursive: true, force: true });
  }
  mkdirSync(here, { recursive: true });

  const seed = createHash("sha256").update("tamper-signal judgment-parity fixture v1").digest();
  const privateKey = privateFromSeed(seed);
  const publicHex = publicHexFromPrivate(privateKey);

  const prior = manifest(PRIOR_ROWS, privateKey, "2026-06-11T00:00:00Z");
  writeReceipt(here, SOURCE_RECEIPT_NAME, prior);
  writeChain(here, [SOURCE_RECEIPT_NAME], publicHex);
  const priorChain = JSON.parse(readFileSync(join(here, "chain.json"), "utf-8"));
  const snapshot = buildRunSnapshot([prior], priorChain, {
    privateKey,
    chainDir: here,
    createdAt: "2026-06-11T00:05:00Z",
  });
  writeRunSnapshot(here, snapshot);

  const current = manifest(CURRENT_ROWS, privateKey, "2026-06-12T00:00:00Z");
  writeReceipt(here, SOURCE_RECEIPT_NAME, current);
  writeChain(here, [SOURCE_RECEIPT_NAME], publicHex);
  const chain = JSON.parse(readFileSync(join(here, "chain.json"), "utf-8"));

  const judgment = judgeCrossRun([current], chain, [snapshot]);
  const expected = {
    caveats: judgment.caveats,
    caveat_details: judgment.details,
    breached: judgment.breached,
  };
  writeFileSync(join(here, "expected_caveat_details.json"), JSON.stringify(expected, null, 2) + "\n");
  console.log("caveats:");
  for (const caveat of judgment.caveats) console.log(`  - ${caveat}`);
  console.log(`public key: ${publicHex}`);
}

main();
