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

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { evidenceHash, semanticHash } from "./canonical.js";
import { loadPrivateKey, publicHexFromPrivate } from "./keys.js";
import { loadRecords } from "./load.js";
import {
  SOURCE_RECEIPT_NAME,
  buildSourceManifest,
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

// Ingest a source file: build a signed source manifest and (re)write chain.json
// so it lists only that source. This is the programmatic equivalent of
// `tamper-signal ingest`, and it RESETS the chain to its source -- which is the
// idempotent foundation for "rebuild on data change": call it again and the
// chain starts fresh from the source, so re-running your stages no longer
// throws ChainTailMismatch. Returns the manifest, the loaded records, and the
// source's semantic hash (the new chain tail).
export function ingestFile({
  file,
  declaredOrigin = "",
  chainDir = "receipts/",
  keyPath = "keys/signing.key",
} = {}) {
  if (!file) throw new TypeError("ingestFile requires a `file` path.");
  const raw = readFileSync(file);
  const records = loadRecords(file);
  const privateKey = loadPrivateKey(keyPath);
  const manifest = buildSourceManifest({
    filename: basename(file),
    evidenceHash: evidenceHash(raw),
    byteSize: raw.length,
    declaredOrigin,
    semanticHash: semanticHash(records),
    records,
    privateKey,
  });
  writeReceipt(chainDir, SOURCE_RECEIPT_NAME, manifest);
  writeChain(chainDir, [SOURCE_RECEIPT_NAME], publicHexFromPrivate(privateKey));
  return { manifest, records, sourceHash: manifest.semantic_hash, chainDir };
}

// Rebuild a chain from scratch on every call: re-ingest `file` as the source
// (resetting the chain), then run each stage transform in order, appending a
// signed receipt per stage. `stages` are plain records -> records transforms
// (sync or async), wrapped here with receiptStep. Returns the final output
// records. This is the clean, idempotent "rebuild on data change" pipeline the
// raw receiptStep chain can't express (re-running it throws ChainTailMismatch).
export async function rebuildChain({
  file,
  stages = [],
  declaredOrigin = "",
  chainDir = "receipts/",
  keyPath = "keys/signing.key",
} = {}) {
  const { records } = ingestFile({ file, declaredOrigin, chainDir, keyPath });
  let current = records;
  for (const stage of stages) {
    if (typeof stage !== "function") {
      throw new TypeError("rebuildChain `stages` must be records -> records functions.");
    }
    const step = receiptStep(stage, { chainDir, keyPath });
    current = await step(current);
  }
  return current;
}
