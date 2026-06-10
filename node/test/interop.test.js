// Cross-language interop: the chains committed under examples/chains/ were
// created and signed by the Python package. The Node verifier must agree
// with the Python verdicts exactly.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadReceipts, readChain, verifyChain } from "../receipts.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function verifyDir(dir, options = {}) {
  const chain = readChain(join(dir, "chain.json"));
  return verifyChain(loadReceipts(dir), chain.public_key, null, null, {
    chainPublicHex: chain.public_key,
    receiptNames: chain.receipts,
    ...options,
  });
}

test("python-signed intact chain verifies green", () => {
  const result = verifyDir(join(repoRoot, "examples", "chains", "intact"));
  assert.equal(result.verdict, "green");
  assert.ok(result.ok);
});

test("python-signed tampered chain breaks at link 1 -> 2", () => {
  const result = verifyDir(join(repoRoot, "examples", "chains", "tampered"));
  assert.equal(result.verdict, "red");
  assert.equal(result.brokenLink, 2);
  assert.match(result.lines.join("\n"), /CHAIN BROKEN at link 1 -> 2/);
  assert.match(result.lines.join("\n"), /spend_usd/);
});

test("untrusted key yields the yellow verdict", () => {
  const dir = join(repoRoot, "examples", "chains", "intact");
  const chain = readChain(join(dir, "chain.json"));
  const result = verifyChain(loadReceipts(dir), "ab".repeat(32), null, null, {
    chainPublicHex: chain.public_key,
    receiptNames: chain.receipts,
  });
  assert.equal(result.verdict, "yellow");
  assert.match(result.caveats[0], /unrecognized signing key/);
});
