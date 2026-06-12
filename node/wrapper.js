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
import { basename, join } from "node:path";

import {
  decimalToPlainString,
  evidenceHash,
  normalizeHeader,
  parseDecimal,
  semanticHash,
} from "./canonical.js";
import { archiveRunSnapshot } from "./history.js";
import { loadPrivateKey, publicHexFromPrivate } from "./keys.js";
import { loadRecords } from "./load.js";
import {
  CHAIN_FILENAME,
  SOURCE_RECEIPT_NAME,
  buildSourceManifest,
  buildTransformReceipt,
  codeHashOf,
  loadReceipts,
  nextReceiptFilename,
  outputHashOf,
  readChain,
  readChainFiles,
  verifyChain,
  writeChain,
  writeReceipt,
} from "./receipts.js";

export class ChainTailMismatch extends Error {}

// Tolerance declaration defaults: a producer who states only a band gets the
// default settling window, and vice versa. Mirrors tamper_signal/cli.py.
export const DEFAULT_BAND = "0.05";
export const DEFAULT_SETTLE_HOURS = 72;

// Normalize a band declaration to its canonical plain decimal string.
// Accepts percent forms ("5%", "5 %", "5.5%") and plain fractions ("0.05").
// The canonical form is the plain decimal string the totals serializer
// produces, so "5%", "0.05" and "0.050" all normalize to "0.05". Bands must
// be greater than zero and at most 100%. The result is a STRING because
// floats never enter signed bodies. Mirrors parse_band in tamper_signal/cli.py
// including the error messages.
export function parseBand(text) {
  let raw = String(text).trim();
  const isPercent = raw.endsWith("%");
  if (isPercent) raw = raw.slice(0, -1).trim();
  const dec = parseDecimal(raw);
  if (dec === null) {
    throw new Error(`invalid --band '${text}': not a number (try 5% or 0.05)`);
  }
  if (isPercent) dec.exp -= 2;
  if (dec.v <= 0n) {
    throw new Error(`invalid --band '${text}': must be greater than zero`);
  }
  const exceedsOne =
    dec.exp >= 0 ? dec.v * 10n ** BigInt(dec.exp) > 1n : dec.v > 10n ** BigInt(-dec.exp);
  if (exceedsOne) {
    throw new Error(`invalid --band '${text}': must not exceed 100%`);
  }
  const band = decimalToPlainString(dec);
  if (band === "0") {
    // Positive but below the six-place quantum: quantizes to zero.
    throw new Error(`invalid --band '${text}': must be greater than zero`);
  }
  return band;
}

// Parse a settling window to whole hours: "72", "72h", or "3d". Mirrors
// parse_settle in tamper_signal/cli.py including the error messages.
export function parseSettle(text) {
  let raw = String(text).trim().toLowerCase();
  let multiplier = 1;
  if (raw.endsWith("h")) {
    raw = raw.slice(0, -1).trim();
  } else if (raw.endsWith("d")) {
    raw = raw.slice(0, -1).trim();
    multiplier = 24;
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(
      `invalid --settle '${text}': expected a whole number of hours like 72, 72h, or 3d`
    );
  }
  const hours = parseInt(raw, 10) * multiplier;
  if (hours <= 0) {
    throw new Error(`invalid --settle '${text}': must be a positive number of hours`);
  }
  return hours;
}

// Build the signed tolerance declaration from ingest options. Any option
// creates a declaration (missing parts take the defaults); none means no
// tolerance field at all, so a chain without a declaration verifies
// byte-identically to one minted before declarations existed.
function buildTolerance({ band, settle, bucketColumn }) {
  if (band == null && settle == null && bucketColumn == null) {
    return { tolerance: null, bucketName: null };
  }
  const tolerance = {
    band: band == null ? DEFAULT_BAND : parseBand(band),
    settle_hours: settle == null ? DEFAULT_SETTLE_HOURS : parseSettle(settle),
  };
  let bucketName = null;
  if (bucketColumn != null) {
    bucketName = normalizeHeader(bucketColumn);
    tolerance.bucket_column = bucketName;
  }
  return { tolerance, bucketName };
}

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
// Tolerance: passing any of `band` ("5%", "0.05"), `settle` ("72h", "3d"),
// or `bucketColumn` records a signed tolerance declaration in the manifest
// (missing parts take the defaults); invalid values throw before anything is
// written. No options means no tolerance field.
export function ingestFile({
  file,
  declaredOrigin = "",
  chainDir = "receipts/",
  keyPath = "keys/signing.key",
  band = null,
  settle = null,
  bucketColumn = null,
} = {}) {
  if (!file) throw new TypeError("ingestFile requires a `file` path.");
  // Parse the declaration before touching anything: an invalid value must
  // throw with nothing written and the existing chain untouched.
  const { tolerance, bucketName } = buildTolerance({ band, settle, bucketColumn });
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
    tolerance,
    bucketColumn: bucketName,
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
//
// After the stages complete, the run is archived as a snapshot under
// <chainDir>/history/ (signed with keyPath), so programmatic rebuilds leave
// the same run memory CLI verifies do. A failed archive degrades to a stderr
// notice and never fails the rebuild. This is the ONLY programmatic entry
// point that writes history: verifyChain stays side-effect-free by design,
// and API users who manage chains by hand call writeRunSnapshot (or
// archiveRunSnapshot) from "./history.js" explicitly.
export async function rebuildChain({
  file,
  stages = [],
  declaredOrigin = "",
  chainDir = "receipts/",
  keyPath = "keys/signing.key",
  band = null,
  settle = null,
  bucketColumn = null,
} = {}) {
  const { records } = ingestFile({
    file,
    declaredOrigin,
    chainDir,
    keyPath,
    band,
    settle,
    bucketColumn,
  });
  let current = records;
  for (const stage of stages) {
    if (typeof stage !== "function") {
      throw new TypeError("rebuildChain `stages` must be records -> records functions.");
    }
    const step = receiptStep(stage, { chainDir, keyPath });
    current = await step(current);
  }
  try {
    const privateKey = loadPrivateKey(keyPath);
    archiveRunSnapshot(chainDir, readChain(join(chainDir, CHAIN_FILENAME)), loadReceipts(chainDir), {
      privateKey,
      trustedKeys: [publicHexFromPrivate(privateKey)],
    });
  } catch (err) {
    // Archiving must never fail the rebuild; the chain itself is complete.
    console.error(`could not archive run snapshot: ${err.message}`);
  }
  return current;
}
