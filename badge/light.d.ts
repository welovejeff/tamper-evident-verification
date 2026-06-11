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
   * The HOST page's surface. The pill should be the one foreign object on the
   * page, so on a "dark" host it inverts to a light pill. Pick this to match
   * what you see -- "dark" on a dark dashboard. Default: "light".
   */
  surface?: "light" | "dark";
  /** Boolean shortcut for `surface: "dark"`. */
  invert?: boolean;
  /**
   * @deprecated Use `surface` instead. `theme: "light"` is equivalent to
   * `surface: "dark"` (a light pill, for a dark host) -- the name invited the
   * opposite of what you want. Kept working for back-compat.
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

/**
 * Whether the inverted (light) pill should render, given the host options.
 * `surface: "dark"` (or `invert`, or the deprecated `theme: "light"`) inverts.
 */
export function shouldInvertPill(
  opts?: Pick<SignalOptions, "surface" | "invert" | "theme">,
): boolean;
