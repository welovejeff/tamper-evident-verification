// Type declarations for "tamper-signal/badge": the browser verification core
// shared by the light, table, and console. Most apps use the higher-level
// entries; this exposes the pipeline directly.

import type {
  BrowserVerifyResult,
  Chain,
  ControlTotals,
  LinkResult,
  Receipt,
} from "../types/core.js";

export type {
  BrowserVerifyResult,
  Chain,
  ControlTotals,
  LinkResult,
  Receipt,
} from "../types/core.js";

/** Abbreviate a hash for display: "abcd...ef". */
export function SHORT(hash: string | null | undefined): string;
/** Canonical JSON string whose SHA-256 matches the signed hash. */
export function canonicalize(value: unknown): string;

export function outputHashOf(receipt: Receipt): string;
export function inputHashOf(receipt: Receipt): string | null;
export function totalsOf(receipt: Receipt): ControlTotals;
export function stageNameOf(receipt: Receipt): string;
export function totalsDelta(upstream: ControlTotals, downstream: ControlTotals): string[];

/** Whether the runtime can verify Ed25519 via Web Crypto. */
export function ed25519Available(): Promise<boolean>;
/** Verify a single receipt's signature against a public key hex. */
export function verifySignature(receipt: Receipt, pubKeyHex: string): Promise<boolean>;

/** Fetch and parse chain.json and every receipt it references. */
export function loadChain(chainUrl: string): Promise<{
  chain: Chain;
  receipts: Receipt[];
  receiptMismatches: string[];
}>;

/** Numbering gaps in NNN_ receipt names (hand-named sets opt out). */
export function coverageGaps(receiptNames: string[]): Map<number, string>;

export function checkSignatures(
  receipts: Receipt[],
  trustedKeyHex: string | string[] | null | undefined,
  chainKeyHex: string | null | undefined,
): Promise<unknown>;

/** The hash-link check across the chain. */
export function evaluate(receipts: Receipt[]): LinkResult;

/** The whole browser verification pipeline as one call. */
export function verifyReceipts(
  chainUrl: string,
  pubKeyHex?: string | string[],
  opts?: { warnDrift?: boolean },
): Promise<BrowserVerifyResult>;

/** Render the standalone badge into containerEl. */
export function renderReceiptBadge(
  containerEl: HTMLElement,
  chainUrl: string,
  pubKeyHex?: string | string[],
): Promise<BrowserVerifyResult>;
