// Type declarations for "tamper-signal/light": the inline status light.

import type { BrowserVerifyResult, SignalState } from "../types/core.js";

export type { BrowserVerifyResult, SignalState, Verdict } from "../types/core.js";

export interface SignalOptions {
  /** Re-verify every N milliseconds (min 1000). */
  watch?: number;
  /** Flag any control-totals movement across intact links. */
  warnDrift?: boolean;
  /** href for the popover's "view receipts" link (defaults to chainUrl). */
  receiptsHref?: string;
  /**
   * "light" renders a light pill, intended for a DARK host page (so the pill
   * stays the one foreign object). Omit it on a light host -- the default dark
   * pill is what you want there.
   */
  theme?: "light" | "dark";
}

export interface SignalHandle {
  /** The mounted root element. */
  el: HTMLElement;
  /** Resolves with the first verification result. */
  ready: Promise<BrowserVerifyResult>;
  /** Re-run verification now. */
  refresh(): Promise<BrowserVerifyResult>;
  /** Current state, including the transient "checking". */
  getState(): SignalState;
  /** Open or close the detail popover. */
  setOpen(open: boolean): void;
  /** Tear down: stop watching, remove listeners and the element. */
  destroy(): void;
}

/**
 * Mount the inline status light into hostEl. pubKeyHex may be a single trusted
 * key, an array (key rotation), or omitted to use the chain's embedded key. The
 * options object may be passed in place of pubKeyHex.
 */
export function mountTamperSignal(
  hostEl: HTMLElement,
  chainUrl: string,
  pubKeyHex?: string | string[] | SignalOptions,
  opts?: SignalOptions,
): SignalHandle;
