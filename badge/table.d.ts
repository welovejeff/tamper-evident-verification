// Type declarations for "tamper-signal/table": the verified Data tab.

import type { BrowserVerifyResult } from "../types/core.js";

export type { BrowserVerifyResult } from "../types/core.js";

/** The verdict the table emits after each verification. */
export interface ReceiptTableState {
  /** "green" | "yellow" | "red" | "unverifiable". */
  state: string;
  /** Whether the rendered table hashes to the final receipt. */
  attested: boolean;
  /** Whether strict mode is enabled (the host should gate when untrustworthy). */
  strict: boolean;
}

export interface ReceiptTableOptions {
  /** Rows rendered before the "show all" control (default 500). */
  maxRows?: number;
  /**
   * Enforced mode: when true, the emitted state carries `strict: true` so the
   * host gates its own views on a broken chain. The table never blocks UI
   * itself. Default false — the table stays default-on and always-honest.
   */
  strict?: boolean;
  /**
   * Called after each verification with the verdict. The same payload is also
   * dispatched as a bubbling `tamper-signal:state` CustomEvent on the container.
   * Recommended host gate: `strict && (state === "red" || !attested)`.
   */
  onState?: (state: ReceiptTableState) => void;
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
 * - `strict` — present = emit state with `strict: true` so the host gates other
 *   views on a broken chain (the table never blocks UI itself; listen for the
 *   bubbling `tamper-signal:state` event)
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
