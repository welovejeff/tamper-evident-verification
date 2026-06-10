// <tamper-signal>: the inline status light as a custom element, so one tag
// works in plain HTML, Vue, Svelte, Angular, or anything else that renders
// DOM. Wraps mountTamperSignal; importing this module registers the element.
//
//   <script type="module" src="/badge/element.js"></script>
//   <tamper-signal chain="/receipts/chain.json"></tamper-signal>
//
// Attributes (all but `chain` optional):
//   chain          URL of chain.json (required; nothing mounts without it)
//   pub-key        trusted public key hex; defaults to the chain's embedded key
//   watch          re-verify every N milliseconds
//   warn-drift     present = flag any control-totals movement across links
//   receipts-href  href for the popover's "view receipts" link
//   theme          "light" to invert the pill on dark host pages
//
// The light renders into the element's light DOM (no shadow root) on purpose:
// the instrument's styles are aggressively namespaced already, and the red
// state must reach out and flag [data-receipt-column] elements in the host
// page, which a closed shadow boundary would complicate.

import { mountTamperSignal } from "./light.js";

const ATTRS = ["chain", "pub-key", "watch", "warn-drift", "receipts-href", "theme"];

class TamperSignalElement extends HTMLElement {
  static get observedAttributes() {
    return ATTRS;
  }

  constructor() {
    super();
    this._handle = null;
  }

  connectedCallback() {
    this._mount();
  }

  disconnectedCallback() {
    this._unmount();
  }

  attributeChangedCallback() {
    if (this.isConnected) this._mount();
  }

  // The mount handle, for hosts that want refresh()/setOpen()/getState().
  get signal() {
    return this._handle;
  }

  _unmount() {
    if (this._handle) {
      this._handle.destroy();
      this._handle = null;
    }
  }

  _mount() {
    this._unmount();
    const chain = this.getAttribute("chain");
    if (!chain) return; // nothing to verify yet; attribute may arrive later
    const watch = Number(this.getAttribute("watch"));
    this._handle = mountTamperSignal(this, chain, this.getAttribute("pub-key") || undefined, {
      watch: Number.isFinite(watch) && watch > 0 ? watch : undefined,
      warnDrift: this.hasAttribute("warn-drift"),
      receiptsHref: this.getAttribute("receipts-href") || undefined,
      theme: this.getAttribute("theme") || undefined,
    });
  }
}

if (!customElements.get("tamper-signal")) {
  customElements.define("tamper-signal", TamperSignalElement);
}

export { TamperSignalElement };
