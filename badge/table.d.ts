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

/**
 * The verified Data tab as a custom element, the parallel of `<tamper-signal>`.
 * Importing this module registers `<tamper-signal-table>` as a side effect.
 *
 * Attributes:
 * - `chain` (required) — URL of chain.json
 * - `table` — URL of table.json (defaults to table.json beside chain)
 * - `max-rows` — rows rendered before the "show all" footer (default 500)
 */
export class TamperSignalTableElement extends HTMLElement {
  static get observedAttributes(): string[];
  /** The underlying mount handle (refresh/destroy), or null. */
  get table(): ReceiptTableHandle | null;
  connectedCallback(): void;
  disconnectedCallback(): void;
  attributeChangedCallback(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "tamper-signal-table": TamperSignalTableElement;
  }
}
