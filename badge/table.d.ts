// Type declarations for "tamper-signal/table": the verified Data tab.

import type { BrowserVerifyResult } from "../types/core.js";

export type { BrowserVerifyResult } from "../types/core.js";

export interface ReceiptTableOptions {
  /** Rows rendered before the "show all" control (default 500). */
  maxRows?: number;
}

export interface ReceiptTableHandle {
  el: HTMLElement;
  ready: Promise<BrowserVerifyResult>;
  refresh(): Promise<BrowserVerifyResult>;
  destroy(): void;
}

/**
 * Mount the verified table. tableUrl defaults to table.json beside chainUrl;
 * the options object may be passed in its place.
 */
export function mountReceiptTable(
  containerEl: HTMLElement,
  chainUrl: string,
  tableUrl?: string | ReceiptTableOptions,
  opts?: ReceiptTableOptions,
): ReceiptTableHandle;
