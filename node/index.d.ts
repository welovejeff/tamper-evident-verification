// Type declarations for the package root ("tamper-signal"): the Node-side API
// for building, signing, and verifying receipt chains. Mirrors node/index.js.

import type { KeyObject } from "node:crypto";
import type {
  Chain,
  ControlTotals,
  DataRecord,
  Receipt,
  RunSnapshot,
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
  RunSnapshot,
  SnapshotStage,
  SourceManifest,
  TableDocument,
  ToleranceDeclaration,
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

// --- history.js --------------------------------------------------------------

/** The directory under a chain dir holding run snapshots ("history"). */
export const HISTORY_DIRNAME: string;
/** created_at clock-skew tolerance for the history scanner, in seconds. */
export const FUTURE_SKEW_SECONDS: number;

/** One validated entry returned by loadSnapshots, newest first. */
export interface LoadedSnapshot {
  filename: string;
  path: string;
  snapshot: RunSnapshot;
  created_at: string;
  /** sha256 of the body's canonical bytes (the content address). */
  body_hash: string;
  signed: boolean;
  /** True only for signed snapshots verifying under a trusted key. */
  verified: boolean;
}

export interface BuildRunSnapshotOptions {
  /** Sign the body when present; omitted/null writes unsigned. */
  privateKey?: KeyObject | null;
  /** Needed only for chains that record no receipt_hashes. */
  chainDir?: string | null;
  /** Pin the timestamp (tests/fixtures); defaults to the clock. */
  createdAt?: string | null;
}

export interface LoadSnapshotsOptions {
  /** Keys signed snapshots may verify under (include the chain's key). */
  trustedKeys?: string[];
  /** Reading clock in ms since epoch (tests); defaults to Date.now(). */
  now?: number | null;
  /** Receives one line per skipped/unverifiable file; CLI routes to stderr. */
  onNotice?: ((message: string) => void) | null;
}

/** sha256 hex of a snapshot body's canonical bytes (its content address). */
export function snapshotBodyHash(snapshot: RunSnapshot): string;
/** The sha256 chain.json records for the LAST receipt file of the run. */
export function chainTailHash(chainDir: string, chain: Chain): string;
/** Build a run snapshot from a verified chain; signed when keyed. */
export function buildRunSnapshot(
  receipts: Receipt[],
  chain: Chain,
  options?: BuildRunSnapshotOptions,
): RunSnapshot;
/** Write a snapshot to <chainDir>/history/<body-hash>.json; returns the path. */
export function writeRunSnapshot(chainDir: string, snapshot: RunSnapshot): string;
/** Load and validate run snapshots, newest first. Never throws on bad content. */
export function loadSnapshots(chainDir: string, options?: LoadSnapshotsOptions): LoadedSnapshot[];
/** The newest snapshot that passes validation, or null. */
export function latestSnapshot(chainDir: string, options?: LoadSnapshotsOptions): LoadedSnapshot | null;
/** True when any usable snapshot records this chain tail hash. */
export function historyHasTail(
  chainDir: string,
  tailHash: string,
  options?: Pick<LoadSnapshotsOptions, "trustedKeys">,
): boolean;
/**
 * Build and write a run snapshot unless the latest one already records the
 * same chain tail hash (idempotent re-verify). Returns the path, or null when
 * skipped. Throws on build/write failure: programmatic callers decide whether
 * archiving is fatal (the CLI degrades to a stderr notice).
 */
export function archiveRunSnapshot(
  chainDir: string,
  chain: Chain,
  receipts: Receipt[],
  options?: {
    privateKey?: KeyObject | null;
    trustedKeys?: string[];
    onNotice?: ((message: string) => void) | null;
  },
): string | null;

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
  /** Tolerance band, e.g. "5%" or "0.05" (signs a declaration in). */
  band?: string | null;
  /** Settling window, e.g. "72h" or "3d". */
  settle?: string | null;
  /** Column to key period buckets off (must be date-shaped). */
  bucketColumn?: string | null;
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
  /** Tolerance band, e.g. "5%" or "0.05" (signs a declaration in). */
  band?: string | null;
  /** Settling window, e.g. "72h" or "3d". */
  settle?: string | null;
  /** Column to key period buckets off (must be date-shaped). */
  bucketColumn?: string | null;
}

/**
 * Rebuild a chain from scratch: re-ingest the source (resetting the chain),
 * then run each stage, appending a signed receipt per stage. Returns the final
 * output records. The idempotent "rebuild on data change" pipeline the raw
 * receiptStep chain can't express.
 *
 * After the stages complete the run is archived as a snapshot under
 * <chainDir>/history/ (signed with keyPath); a failed archive degrades to a
 * stderr notice. verifyChain itself stays side-effect-free: API users who
 * manage chains by hand call writeRunSnapshot / archiveRunSnapshot directly.
 */
export function rebuildChain(options: RebuildChainOptions): Promise<DataRecord[]>;
