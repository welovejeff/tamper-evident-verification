// Tamper Signal for JavaScript pipelines: signed receipts at every stage,
// with verifiable continuity. Chains written here verify with the Python CLI
// and the in-browser signal, and vice versa; the canonicalization is
// byte-identical (see test/vectors.json).
//
// This proves continuity, not correctness. It can't tell you the data is
// right, but it can prove nobody changed it.

export {
  canonicalDocument,
  canonicalize,
  canonicalJsonBytes,
  evidenceHash,
  normalizeHeader,
  normalizeHeaders,
  semanticHash,
} from "./canonical.js";
export {
  generateKeys,
  keyFingerprint,
  loadPrivateKey,
  loadPublicKeyHex,
  publicHexFromPrivate,
  sign,
  verify,
} from "./keys.js";
export { loadCsv, loadJsonRecords, loadNdjson, loadRecords, parseCsv } from "./load.js";
export {
  CHAIN_FILENAME,
  SOURCE_RECEIPT_NAME,
  SPEC_VERSION,
  buildSourceManifest,
  buildTransformReceipt,
  codeHashOf,
  inputHashOf,
  loadReceipts,
  outputHashOf,
  readChain,
  readChainFiles,
  readReceipt,
  stageNameOf,
  totalsOf,
  verifyChain,
  verifySignature,
  writeChain,
  writeReceipt,
} from "./receipts.js";
export { UNBUCKETED_KEY, controlTotals, groupedNumericColumns, totalsDelta } from "./totals.js";
export { ChainTailMismatch, ingestFile, rebuildChain, receiptStep } from "./wrapper.js";
