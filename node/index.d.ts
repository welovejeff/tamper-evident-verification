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
/** Detail period key for the flat-band (whole-table) fallback comparison. */
export const WHOLE_TABLE_PERIOD: string;
/** Caveat string emitted when the bucket column is no longer detected. */
export const BUCKET_LOSS_CAVEAT: string;
/** Caveat string emitted when source columns changed since a prior run. */
export const COLUMNS_CHANGED_CAVEAT: string;

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

/**
 * Per-stage identity and totals in the snapshot's stage shape. Shared by
 * buildRunSnapshot and the diff command's chain-dir adapter, so a live chain
 * and an archived snapshot always compare in the same shape.
 */
export function runStages(receipts: Receipt[]): SnapshotStage[];
/** Source identity in the snapshot's source shape (filename, origin, columns). */
export function runSource(receipts: Receipt[]): RunSnapshot["source"];
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
    /** Baseline-advancement guard recorded into the snapshot body. */
    breached?: Record<string, string[]> | null;
  },
): string | null;

/**
 * One per-(type, metric) entry in a cross-run judgment's typed detail, as
 * surfaced under `caveat_details` in the verify --json payload. `bucket_loss`
 * and `columns_changed` are flag entries with no metric, worst, or buckets.
 */
export interface CaveatDetail {
  type: "band_breach" | "settled_movement" | "bucket_removed" | "bucket_loss" | "columns_changed";
  /** The judged metric id; null for flag entries (bucket_loss, columns_changed). */
  metric: string | null;
  /** Number of buckets in this group; 0 for flag entries. */
  periods: number;
  /** The worst movement in the group; null for flag entries. */
  worst: {
    period: string;
    before: string | null;
    after: string | null;
    delta: string | null;
    /** Present only for non-zero-baseline band breaches, e.g. "+9.2%". */
    delta_pct?: string;
  } | null;
  /** Per-bucket detail for the group; [] for flag entries. */
  buckets: Array<{
    period: string;
    before: string | null;
    after: string | null;
    delta: string | null;
  }>;
}

/** The structured result of judgeCrossRun. */
export interface JudgeCrossRunResult {
  /** Yellow caveat strings, one per (type, metric) group. */
  caveats: string[];
  /** Typed per-group detail (the verify --json caveat_details payload). */
  details: CaveatDetail[];
  /** Stderr-bound notices explaining why judgment was limited or skipped. */
  notices: string[];
  /**
   * Baseline-advancement guard: bucket key (or the WHOLE_TABLE_PERIOD
   * sentinel) -> the metric ids this run flagged. Empty when nothing breached.
   */
  breached: Record<string, string[]>;
}

/**
 * Judge the source manifest's period buckets against run history. Pure and
 * side-effect-free: takes the verified chain's receipts, the chain document,
 * and validated snapshot bodies (as loaded by loadSnapshots). With no
 * tolerance declaration it returns the empty judgment.
 */
export function judgeCrossRun(
  receipts: Receipt[],
  chain: Chain,
  snapshots: RunSnapshot[],
  options?: { now?: number | null },
): JudgeCrossRunResult;

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

/**
 * Structured, machine-readable delta between two control totals (feeds the
 * diff command). Only keys that CHANGED appear; an empty object means no
 * movement. Numeric deltas are plain decimal strings, never floats.
 */
export interface StructuredTotalsDelta {
  row_count?: { before: number | null; after: number | null; delta?: number };
  column_count?: { before: number | null; after: number | null; delta?: number };
  /** Absent side is null; delta omitted when either side does not parse. */
  numeric_sums?: Record<string, { before: string | null; after: string | null; delta?: string }>;
  /** Absent side counts as 0. */
  null_counts?: Record<string, { before: number; after: number; delta?: number }>;
  date_ranges?: Record<
    string,
    {
      before: { min: string; max: string } | null;
      after: { min: string; max: string } | null;
    }
  >;
  /** Bucket keys whose row_count/numeric_sums/null_counts moved, sorted. */
  period_buckets_changed?: string[];
}

/** Structured delta between two control totals; {} when nothing changed. */
export function structuredTotalsDelta(a: ControlTotals, b: ControlTotals): StructuredTotalsDelta;

// --- wrapper.js ------------------------------------------------------------

/** Default tolerance band when only a settling window is declared ("0.05"). */
export const DEFAULT_BAND: string;
/** Default settling window in hours when only a band is declared (72). */
export const DEFAULT_SETTLE_HOURS: number;

/**
 * Normalize a band declaration to its canonical plain decimal string. Accepts
 * percent forms ("5%", "5.5%") and plain fractions ("0.05"); throws on a
 * non-number, zero, or a value above 100%. Returns a STRING (floats never
 * enter signed bodies).
 */
export function parseBand(text: string): string;
/** Parse a settling window to whole hours: "72", "72h", or "3d". */
export function parseSettle(text: string): number;

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

/** Thrown by appendPeriod when the importer's key is not trusted by the chain. */
export class UntrustedSignerError extends Error {}

export interface AppendPeriodOptions {
  /** Path to the source file (.csv/.tsv/.json/.ndjson/.jsonl). */
  file: string;
  declaredOrigin?: string;
  chainDir?: string;
  keyPath?: string;
  /** Public key hexes to trust in addition to the chain's own key (--pub). */
  trustedPubHexes?: string[];
  /** Override the inherited tolerance band, e.g. "5%" or "0.05". */
  band?: string | null;
  /** Override the inherited settling window, e.g. "72h" or "3d". */
  settle?: string | null;
  /** Override the inherited bucket column. */
  bucketColumn?: string | null;
}

export interface AppendPeriodResult extends IngestFileResult {
  /** Cross-run judgment caveats (yellow), empty when in band. */
  caveats: string[];
  /** Additive caveat detail records. */
  details: unknown[];
  /** Baseline-advancement guard recorded in the archived snapshot. */
  breached: Record<string, string[]>;
  /** True when a prior trusted snapshot was found to compare against. */
  compared: boolean;
}

/**
 * Import a file as the next period of an existing chain's run history. Continues
 * history only under a trusted signer (the chain's key or one in
 * `trustedPubHexes`); an untrusted signer throws UntrustedSignerError. Inherits
 * the prior run's signed tolerance unless overridden, judges the new run against
 * prior trusted snapshots, and archives the snapshot with the breached guard.
 */
export function appendPeriod(options: AppendPeriodOptions): AppendPeriodResult;

// --- CLI --json payload shapes ---------------------------------------------
// Documented contracts for the `diff --json` and `log --json` stdout payloads.
// Byte-identical across the Node and Python CLIs.

/** One run's identity in a DiffResult side (a or b). */
export interface DiffSide {
  ref: string;
  /** Snapshot timestamp; null for a live chain directory. */
  created_at: string | null;
  /** True when the side is an unsigned snapshot (weaker evidence). */
  unsigned: boolean;
}

/** One stage row in a DiffResult. */
export interface DiffStage {
  name: string;
  /** "matched" when present on both sides, else "added" / "removed". */
  status: "matched" | "added" | "removed";
  code_changed: boolean;
  /** Structured totals delta for matched stages; null for added/removed. */
  totals: StructuredTotalsDelta | null;
  /** Present only when code_changed: the 8-char code-hash prefixes. */
  code_hash?: { before8: string; after8: string };
  /** Present only when code_changed and a source file was recorded. */
  code_file?: string;
}

/** The `diff --json` payload: two runs compared stage by stage. */
export interface DiffResult {
  a: DiffSide;
  b: DiffSide;
  stages: DiffStage[];
  /** True when filename or column set differs between the two sources. */
  identity_mismatch: boolean;
}

/** One metric cell in a LogRun: the display value and delta vs the prior row. */
export interface LogMetricCell {
  /** Display string, or "-" when the metric is absent in this run. */
  value: string;
  /** Signed delta vs the previous rendered row; omitted on the first. */
  delta?: string;
}

/** One period row in a LogResult. */
export interface LogRun {
  period: string;
  created_at: string;
  /** 8-char chain-tail-hash prefix, or null when absent. */
  tail: string | null;
  unsigned: boolean;
  /** Per-metric value and delta, keyed by metric id. */
  metrics: Record<string, LogMetricCell>;
  /** Metric ids this run's judgment flagged anywhere, sorted. */
  breached: string[];
}

/** The `log --json` payload: archived run history as a per-metric trend. */
export interface LogResult {
  granularity: "day" | "week" | "month" | "quarter";
  /** Total runs collapsed away by the granularity (hidden same-period runs). */
  collapsed: number;
  /** One row per period, oldest first. */
  runs: LogRun[];
}
