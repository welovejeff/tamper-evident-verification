// Type declarations for "tamper-signal/element": the <tamper-signal> custom
// element. Importing the module registers the element as a side effect.

import type { SignalHandle } from "./light.js";

export type { SignalHandle } from "./light.js";

/**
 * The inline status light as a custom element. Attributes: chain (required),
 * pub-key, watch, warn-drift, receipts-href, theme.
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
