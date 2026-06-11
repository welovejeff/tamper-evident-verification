// Shared domain types for Tamper Signal, imported by the per-entry .d.ts files.
// Hand-authored to mirror the runtime API; the public surface is small and
// stable, so these track the JS by hand rather than via a build step.

/** One data row. Keys are column names; values are cells. */
export type DataRecord = Record<string, unknown>;

/** A verification verdict. */
export type Verdict = "green" | "yellow" | "red" | "unverifiable";

/** Signal state including the transient pre-result "checking". */
export type SignalState = Verdict | "checking";

/** Human-legible control totals attached to every receipt. */
export interface ControlTotals {
  row_count: number;
  column_count: number;
  /** column -> exact decimal sum, as a plain-decimal string. */
  numeric_sums: Record<string, string>;
  /** column -> ISO min/max for date-typed columns. */
  date_ranges: Record<string, { min: string; max: string }>;
  /** column -> count of null/blank cells. */
  null_counts: Record<string, number>;
}

export interface ReceiptSignature {
  key_fingerprint?: string;
  [key: string]: unknown;
}

export interface SourceManifest {
  kind: "source_manifest";
  spec_version: string;
  created_at: string;
  source: {
    filename: string;
    evidence_hash: string;
    byte_size: number;
    declared_origin: string;
  };
  semantic_hash: string;
  control_totals: ControlTotals;
  signature?: ReceiptSignature;
}

export interface TransformReceipt {
  kind: "transform_receipt";
  spec_version: string;
  created_at: string;
  transform: { name: string; code_hash: string; code_file: string };
  input_semantic_hash: string;
  output_semantic_hash: string;
  output_control_totals: ControlTotals;
  signature?: ReceiptSignature;
}

export type Receipt = SourceManifest | TransformReceipt;

/** Parsed chain.json: an ordered list of receipt files plus the public key. */
export interface Chain {
  receipts: string[];
  public_key?: string;
  receipt_hashes?: Record<string, string>;
  [key: string]: unknown;
}

/** Result of evaluate(): the hash-link check, with break detail when broken. */
export type LinkResult =
  | { ok: true }
  | {
      ok: false;
      brokenAt: number;
      brokenStage: string;
      expected: string;
      found: string;
      delta: string[];
    };

/**
 * The structured result of the in-browser verification pipeline
 * (verifyReceipts / a mount handle's `ready`).
 */
export interface BrowserVerifyResult {
  state: Verdict;
  /** Short human phrase for red / unverifiable states. */
  reason?: string;
  /** Yellow caveat strings (empty for green). */
  caveats: string[];
  /** evaluate() output: {ok:true} or the break detail. null when unverifiable. */
  linkResult: LinkResult | null;
  signaturesValid?: boolean;
  chain?: Chain;
  receipts: Receipt[];
  origin?: string;
  finalRows?: number;
  transforms?: number;
  /** ISO timestamp the verification ran at. */
  verifiedAt?: string;
}
