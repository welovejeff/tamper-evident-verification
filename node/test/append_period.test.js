// Append-period import (U5): JS parity for continuing an existing chain's run
// history under a trusted signer, judging against prior snapshots; refusing an
// untrusted signer. Mirrors tests/test_append_period.py.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { archiveRunSnapshot } from "../history.js";
import { generateKeys, loadPrivateKey, publicHexFromPrivate } from "../keys.js";
import { loadReceipts, readChain } from "../receipts.js";
import { UntrustedSignerError, appendPeriod, ingestFile } from "../wrapper.js";

const P1 = "day,amount\n2026-05-01,10\n2026-05-02,20\n";
const P2_INBAND = "day,amount\n2026-05-01,10\n2026-05-02,20\n2026-05-03,30\n";
const P2_BREACH = "day,amount\n2026-05-01,1000\n2026-05-02,20\n";

// Keys + an ingested chain with a band and bucket column, plus a first-period
// snapshot archived to history/ for the next period to compare against.
function seedPeriodOne(csv = P1) {
  const dir = mkdtempSync(join(tmpdir(), "append-"));
  generateKeys(dir);
  const keyPath = join(dir, "signing.key");
  const chainDir = join(dir, "receipts/");
  const dataPath = join(dir, "data.csv");
  writeFileSync(dataPath, csv);
  ingestFile({ file: dataPath, declaredOrigin: "t", chainDir, keyPath, band: "5%", bucketColumn: "day" });
  const chain = readChain(join(chainDir, "chain.json"));
  const receipts = loadReceipts(chainDir);
  const privateKey = loadPrivateKey(keyPath);
  archiveRunSnapshot(chainDir, chain, receipts, {
    privateKey,
    trustedKeys: [publicHexFromPrivate(privateKey)],
  });
  return { dir, keyPath, chainDir, dataPath };
}

test("appendPeriod under the chain key compares and inherits the band", () => {
  const { keyPath, chainDir, dataPath } = seedPeriodOne();
  writeFileSync(dataPath, P2_INBAND);
  const res = appendPeriod({ file: dataPath, declaredOrigin: "t", chainDir, keyPath });

  assert.equal(res.compared, true);
  assert.equal(res.records.length, 3);
  assert.equal(res.manifest.tolerance.band, "0.05");
  assert.equal(res.manifest.tolerance.bucket_column, "day");
  assert.deepEqual(res.caveats, []);
});

test("appendPeriod surfaces a moved settled bucket as a caveat", () => {
  const { keyPath, chainDir, dataPath } = seedPeriodOne();
  writeFileSync(dataPath, P2_BREACH);
  const res = appendPeriod({ file: dataPath, declaredOrigin: "t", chainDir, keyPath });

  assert.equal(res.compared, true);
  assert.ok(res.caveats.length > 0, "expected a drift caveat for the changed settled bucket");
});

test("appendPeriod refuses an untrusted signer and leaves the chain intact", () => {
  const { dir, chainDir, dataPath } = seedPeriodOne();
  const originalKey = readChain(join(chainDir, "chain.json")).public_key;
  const otherDir = mkdtempSync(join(tmpdir(), "other-"));
  generateKeys(otherDir);
  writeFileSync(dataPath, P2_INBAND);

  assert.throws(
    () => appendPeriod({ file: dataPath, declaredOrigin: "t", chainDir, keyPath: join(otherDir, "signing.key") }),
    UntrustedSignerError,
  );
  assert.equal(readChain(join(chainDir, "chain.json")).public_key, originalKey);
});

test("appendPeriod trusts a signer passed via trustedPubHexes", () => {
  const { chainDir, dataPath } = seedPeriodOne();
  const otherDir = mkdtempSync(join(tmpdir(), "other-"));
  generateKeys(otherDir);
  const otherKeyPath = join(otherDir, "signing.key");
  const otherHex = publicHexFromPrivate(loadPrivateKey(otherKeyPath));
  writeFileSync(dataPath, P2_INBAND);

  const res = appendPeriod({
    file: dataPath,
    declaredOrigin: "t",
    chainDir,
    keyPath: otherKeyPath,
    trustedPubHexes: [otherHex],
  });
  assert.equal(res.compared, true);
  assert.equal(readChain(join(chainDir, "chain.json")).public_key, otherHex);
});

test("the period CLI archives the prior chain and reports evidence_hash", () => {
  const { keyPath, chainDir, dataPath } = seedPeriodOne();
  writeFileSync(dataPath, P2_INBAND);
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const out = execFileSync(
    "node",
    [cli, "ingest", dataPath, "--origin", "t", "--as", "period", "--key", keyPath, "--out", chainDir],
    { encoding: "utf8" },
  );
  assert.match(out, /evidence_hash/); // parity with replace output
  const archiveDir = join(chainDir, "archive");
  assert.ok(existsSync(archiveDir) && readdirSync(archiveDir).length > 0, "prior chain archived");
});

test("the export --bundle CLI ships a README with verify instructions", () => {
  const { chainDir, dataPath } = seedPeriodOne();
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  execFileSync(
    "node",
    [cli, "export", join(chainDir, "chain.json"), "--data", dataPath, "--bundle"],
    { encoding: "utf8" },
  );
  // data.csv -> data-verified.zip beside the chain; entries are stored
  // uncompressed, so the README text appears verbatim in the archive bytes.
  const zip = readFileSync(join(chainDir, "data-verified.zip")).toString("latin1");
  assert.ok(zip.includes("README.md"), "bundle lists README.md");
  assert.ok(zip.includes("receipts verify chain.json"), "README carries verify instructions");
});

test("appendPeriod refuses when no chain exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "append-empty-"));
  generateKeys(dir);
  const dataPath = join(dir, "data.csv");
  writeFileSync(dataPath, P1);
  assert.throws(
    () => appendPeriod({ file: dataPath, declaredOrigin: "t", chainDir: join(dir, "receipts/"), keyPath: join(dir, "signing.key") }),
    UntrustedSignerError,
  );
});
