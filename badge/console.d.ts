// Type declarations for "tamper-signal/console": the inspector console.

import type { BrowserVerifyResult } from "../types/core.js";

export type { BrowserVerifyResult } from "../types/core.js";

export interface ReceiptConsoleOptions {
  /** Re-verify every N milliseconds (min 1000). */
  watch?: number;
  /** Flag any control-totals movement across intact links. */
  warnDrift?: boolean;
  /** Trusted public key hex, single or rotation list. */
  pubKey?: string | string[];
  /**
   * URL of the published `timeline.json` for the chain-of-custody layer.
   * Defaults to `timeline.json` beside the chain. The custody layer is
   * additive and never affects the verdict (which comes from `chain.json`).
   */
  timeline?: string;
}

export interface ReceiptConsoleHandle {
  el: HTMLElement;
  ready: Promise<BrowserVerifyResult>;
  refresh(): Promise<BrowserVerifyResult>;
  destroy(): void;
}

/** Mount the inspector console (pipeline rail + event log) into containerEl. */
export function mountReceiptConsole(
  containerEl: HTMLElement,
  chainUrl: string,
  opts?: ReceiptConsoleOptions,
): ReceiptConsoleHandle;
