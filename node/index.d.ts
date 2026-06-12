// Type declarations for the package root ("tamper-signal"): the Node-side API
// for building, signing, and verifying receipt chains. Mirrors node/index.js.

import type { KeyObject } from "node:crypto";
import type {
  Chain,
  ControlTotals,
  DataRecord,
  Receipt,
  SourceManifest,
  TableDocument,
  TransformReceipt,
  Verdict,
} from "../types/core.js";

export type {
  Chain,
  ControlTotals,
  DataRecord,
  PeriodBucket,
  Receipt,
  SourceManifest,
  TableDocument,
  TransformReceipt,
  Verdict,
} from "../types/core.js";

// --- canonical.js ----------------------------------------------------------

/** The canonical table document for a record set (the table.json contents). */
export function canonicalDocument(records: DataRecord[]): TableDocument;
/** Canonical bytes whose SHA-256 is a record set's semantic hash. */
export function canonicalize(records: DataRecord[]): Buffer;
/** Canonical JSON bytes for an arbitrary JSON-serializable value. */
export function canonicalJsonBytes(value: unknown): Buffer;
/** SHA-256 (hex) of raw evidence bytes. */
export function evidenceHash(rawBytes: Uint8Array | Buffer | string): string;
/** Normalize one header: NFC, trimmed, lowercased, spaces -> underscores. */
export function normalizeHeader(header: string): string;
/** Normalize a list of headers; throws on post-normalization duplicates. */
export function normalizeHeaders(headers: string[]): string[];
/** SHA-256 (hex) of the canonical record bytes. */
export function semanticHash(records: DataRecord[]): string;

// --- keys.js ---------------------------------------------------------------

export const PRIVATE_KEY_NAME: string;
export const PUBLIC_KEY_NAME: string;
/** Generate an Ed25519 keypair into outDir; returns the written paths. */
export function generateKeys(outDir: string): { privatePath: string; publicPath: string };
/** Short fingerprint of a raw public key. */
export function keyFingerprint(publicKeyBytes: Uint8Array | Buffer): string;
/** Load a PKCS8 private key from a path (or the TAMPER_SIGNAL_KEY env PEM). */
export function loadPrivateKey(path: string): KeyObject;
/** Read a public key hex string from a path. */
export function loadPublicKeyHex(path: string): string;
/** Derive the raw public key hex from a private key. */
export function publicHexFromPrivate(privateKey: KeyObject): string;
/** Sign a message; returns the signature as hex. */
export function sign(privateKey: KeyObject, message: Uint8Array | Buffer): string;
/** Verify a hex signature. Returns false (never throws) on bad input. */
export function verify(publicHex: string, message: Uint8Array | Buffer, signatureHex: string): boolean;

// --- load.js ---------------------------------------------------------------

export function parseCsv(text: string, delimiter?: string): DataRecord[];
export function loadCsv(path: string, opts?: { delimiter?: string }): DataRecord[];
export function loadJsonRecords(path: string): DataRecord[];
export function loadNdjson(path: string): DataRecord[];
/** Load records from a file, dispatching on extension (csv/tsv/json/ndjson). */
export function loadRecords(path: string): DataRecord[];

// --- receipts.js -----------------------------------------------------------

export const SPEC_VERSION: string;
export const CHAIN_FILENAME: string;
export const SOURCE_RECEIPT_NAME: string;

export interface SourceManifestInput {
  filename: string;
  evidenceHash: string;
  byteSize: number;
  declaredOrigin: string;
  semanticHash: string;
  records: DataRecord[];
  privateKey: KeyObject;
  createdAt?: string;
}

export interface TransformReceiptInput {
  name: string;
  codeHash: string;
  codeFile: string;
  inputSemanticHash: string;
  outputSemanticHash: string;
  outputRecords: DataRecord[];
  privateKey: KeyObject;
  createdAt?: string;
}

export interface VerifyChainOptions {
  chainPublicHex?: string | null;
  receiptNames?: string[] | null;
  warnDrift?: boolean;
  recordedHashes?: Record<string, string> | null;
  actualHashes?: Record<string, string> | null;
}

export interface VerifyChainResult {
  ok: boolean;
  verdict: Verdict;
  caveats: string[];
  lines: string[];
  brokenLink: number | null;
  brokenLinkDetail: unknown | null;
  dataMismatch: unknown | null;
  receiptMismatch: string[] | null;
}

/** SHA-256 (hex) of a transform function's source. */
export function codeHashOf(fn: (...args: any[]) => unknown): string;
export function buildSourceManifest(input: SourceManifestInput): SourceManifest;
export function buildTransformReceipt(input: TransformReceiptInput): TransformReceipt;
/** A receipt's output hash (semantic_hash for sources). */
export function outputHashOf(receipt: Receipt): string;
/** A receipt's declared input hash, or null for a source manifest. */
export function inputHashOf(receipt: Receipt): string | null;
/** A receipt's control totals (control_totals or output_control_totals). */
export function totalsOf(receipt: Receipt): ControlTotals;
/** A receipt's stage name ("source" for the manifest). */
export function stageNameOf(receipt: Receipt): string;
export function writeReceipt(chainDir: string, filename: string, receipt: Receipt): void;
export function readReceipt(chainDir: string, filename: string): Receipt;
export function readChain(chainPath: string): Chain;
export function writeChain(chainDir: string, receiptFiles: string[], publicHex: string): void;
/** The ordered receipt filenames recorded in a chain directory's chain.json. */
export function readChainFiles(chainDir: string): string[];
/** Load every receipt referenced by a chain directory's chain.json. */
export function loadReceipts(chainDir: string): Receipt[];
/** Verify a single receipt's signature against a public key hex. */
export function verifySignature(receipt: Receipt, publicHex: string): boolean;
export function verifyChain(
  receipts: Receipt[],
  publicHex: string | string[],
  dataSemanticHash?: string | null,
  dataTotals?: ControlTotals | null,
  options?: VerifyChainOptions,
): VerifyChainResult;

// --- totals.js -------------------------------------------------------------

/** Bucket key for rows whose bucket-column value is null or unparseable. */
export const UNBUCKETED_KEY: string;
/**
 * Control totals for a record set. Pass bucketColumn to pick the period
 * bucket column when several qualify; throws if the named column does not
 * qualify (fewer than 90% of its non-null values are date-shaped).
 */
export function controlTotals(
  records: DataRecord[],
  opts?: { bucketColumn?: string | null },
): ControlTotals;
/**
 * Columns excluded from numeric_sums that would become numeric if thousands
 * grouping separators were stripped. Use to surface silently-inert
 * data-receipt-column wiring. Returns one entry per flagged column.
 */
export function groupedNumericColumns(
  records: DataRecord[],
): Array<{ column: string; example: string | null }>;
/** Human-legible lines describing what changed between two control totals. */
export function totalsDelta(upstream: ControlTotals, downstream: ControlTotals): string[];

// --- wrapper.js ------------------------------------------------------------

/** Thrown when input data does not descend from the current chain tail. */
export class ChainTailMismatch extends Error {}

export interface ReceiptStepOptions {
  chainDir?: string;
  keyPath?: string;
  codeFile?: string;
  name?: string;
}

/**
 * Wrap a transform so that calling it appends a signed receipt continuing the
 * chain. The returned function verifies the existing chain and asserts the
 * input descends from the tail before running.
 */
export function receiptStep<I extends DataRecord[], O>(
  fn: (records: I, ...args: any[]) => O | Promise<O>,
  options?: ReceiptStepOptions,
): (records: I, ...args: any[]) => Promise<O>;

export interface IngestFileOptions {
  /** Path to the source file (.csv/.tsv/.json/.ndjson/.jsonl). */
  file: string;
  declaredOrigin?: string;
  chainDir?: string;
  keyPath?: string;
}

export interface IngestFileResult {
  manifest: SourceManifest;
  records: DataRecord[];
  /** The source's semantic hash (the new chain tail). */
  sourceHash: string;
  chainDir: string;
}

/**
 * Programmatic equivalent of `tamper-signal ingest`: build a signed source
 * manifest and RESET chain.json to list only that source. Re-running it is the
 * idempotent foundation for "rebuild on data change".
 */
export function ingestFile(options: IngestFileOptions): IngestFileResult;

export interface RebuildChainOptions {
  /** Path to the source file. */
  file: string;
  /** Records -> records transforms, run in order and wrapped per stage. */
  stages?: Array<(records: DataRecord[], ...args: any[]) => DataRecord[] | Promise<DataRecord[]>>;
  declaredOrigin?: string;
  chainDir?: string;
  keyPath?: string;
}

/**
 * Rebuild a chain from scratch: re-ingest the source (resetting the chain),
 * then run each stage, appending a signed receipt per stage. Returns the final
 * output records. The idempotent "rebuild on data change" pipeline the raw
 * receiptStep chain can't express.
 */
export function rebuildChain(options: RebuildChainOptions): Promise<DataRecord[]>;
