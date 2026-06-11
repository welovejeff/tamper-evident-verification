// Type declarations for "tamper-signal/element": the <tamper-signal> custom
// element. Importing the module registers the element as a side effect.

import type { SignalHandle } from "./light.js";

export type { SignalHandle } from "./light.js";

/**
 * The inline status light as a custom element.
 *
 * Attributes:
 * - `chain` (required) — URL of chain.json
 * - `pub-key` — trusted public key hex (space/comma list for rotation)
 * - `watch` — re-verify every N milliseconds
 * - `warn-drift` — present = flag control-totals movement across links
 * - `receipts-href` — href for the popover's "view receipts" link
 * - `surface` — the host page's surface: "light" (default) or "dark" (inverts)
 * - `invert` — present = shortcut for `surface="dark"`
 * - `theme` — **deprecated**: `theme="light"` == `surface="dark"`; prefer `surface`
 */
export class TamperSignalElement extends HTMLElement {
  static get observedAttributes(): string[];
  /** The underlying mount handle (refresh/setOpen/getState), or null. */
  get signal(): SignalHandle | null;
  connectedCallback(): void;
  disconnectedCallback(): void;
  attributeChangedCallback(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "tamper-signal": TamperSignalElement;
  }
}
