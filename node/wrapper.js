// receiptStep: the Node equivalent of the @receipt_step decorator. Wrap any
// records -> records transform (sync or async) and every call verifies the
// existing chain, refuses inputs that do not descend from the chain tail,
// then signs and appends a receipt.
//
//   const clean = receiptStep(
//     (records) => records.filter((r) => r.campaign_name),
//     { chainDir: "receipts/", keyPath: "keys/signing.key" }
//   );
//   const output = await clean(records);

import { semanticHash } from "./canonical.js";
import { loadPrivateKey, publicHexFromPrivate } from "./keys.js";
import {
  buildTransformReceipt,
  codeHashOf,
  loadReceipts,
  nextReceiptFilename,
  outputHashOf,
  readChainFiles,
  verifyChain,
  writeChain,
  writeReceipt,
} from "./receipts.js";

export class ChainTailMismatch extends Error {}

function toRecords(data, context) {
  if (Array.isArray(data)) return data;
  throw new TypeError(
    `receiptStep ${context} must be an array of plain objects, got ${typeof data}.`
  );
}

export function receiptStep(fn, { chainDir = "receipts/", keyPath = "keys/signing.key", codeFile = "<inline>", name } = {}) {
  const stageName = name ?? (fn.name || "transform"); // anonymous fns have name ""
  return async function wrapped(records, ...args) {
    const existing = readChainFiles(chainDir);
    if (!existing.length) {
      throw new ChainTailMismatch(`No chain found in ${chainDir}; run \`tamper-signal ingest\` first.`);
    }

    const privateKey = loadPrivateKey(keyPath);
    const publicHex = publicHexFromPrivate(privateKey);

    // Verify the existing chain BEFORE extending it.
    const receipts = loadReceipts(chainDir);
    const chainResult = verifyChain(receipts, publicHex);
    if (!chainResult.ok) {
      throw new ChainTailMismatch(
        "Existing chain failed verification; refusing to extend it:\n" + chainResult.lines.join("\n")
      );
    }

    // Assert the input descends from the chain tail BEFORE running.
    const tailOutput = outputHashOf(receipts[receipts.length - 1]);
    const inputHash = semanticHash(toRecords(records, "input"));
    if (inputHash !== tailOutput) {
      throw new ChainTailMismatch(
        "Input data does not match the chain tail output hash.\n" +
          `  chain tail output: ${tailOutput}\n` +
          `  provided input:    ${inputHash}\n` +
          "Refusing to append a receipt for data that did not come from the previous stage."
      );
    }

    const output = await fn(records, ...args);
    const outputRecords = toRecords(output, "output");

    const receipt = buildTransformReceipt({
      name: stageName,
      codeHash: codeHashOf(fn),
      codeFile,
      inputSemanticHash: inputHash,
      outputSemanticHash: semanticHash(outputRecords),
      outputRecords,
      privateKey,
    });
    const filename = nextReceiptFilename(chainDir, stageName);
    writeReceipt(chainDir, filename, receipt);
    writeChain(chainDir, [...existing, filename], publicHex);
    return output;
  };
}
