// The verified Data tab, since 2.1 a preset of the Signal Room (room.js):
// same verification claims, same emitted state contract, upgraded frame — the
// chain rail, receipt inspector, event log, and custody drawers ride along
// one click away. This file keeps the 2.0 public contract exactly:
//
// mountReceiptTable(containerEl, chainUrl, tableUrl?, opts?)
//   opts: maxRows (default 500), strict, onState
//   Returns { el, ready, refresh(), destroy() }.
//
// <tamper-signal-table chain table max-rows strict> keeps working and keeps
// emitting the bubbling `tamper-signal:state` event with detail
// {state, attested, strict} — the documented host gate
// `strict && (state === "red" || !attested)` is unchanged.
//
// The room is dynamic-imported so a vendored directory missing room.js fails
// LOUDLY with the re-run-assets panel instead of taking this module down with
// a static import error.

const ROOM_IMPORT = () => import("./room.js");

function skewPanel(containerEl, cmdHint) {
  const panel = document.createElement("div");
  panel.setAttribute(
    "style",
    "background:#0b0f14;color:#f87171;border:1px solid #1f2937;border-radius:12px;" +
      "padding:16px 18px;font:12px/1.6 ui-monospace,'SF Mono',Menlo,Monaco,monospace"
  );
  panel.textContent =
    `room.js is missing beside ${cmdHint} — the vendored Tamper Signal assets are ` +
    "out of step. Re-run `tamper-signal assets` (npm) or `receipts assets` (pip) " +
    "to refresh badge/, then reload.";
  containerEl.appendChild(panel);
  return panel;
}

function emitSkewState(containerEl, opts) {
  const detail = { state: "unverifiable", attested: false, strict: !!(opts && opts.strict) };
  try {
    if (opts && typeof opts.onState === "function") opts.onState(detail);
  } catch (_e) {
    /* a host callback throwing must not break the failure panel */
  }
  try {
    containerEl.dispatchEvent(new CustomEvent("tamper-signal:state", { detail, bubbles: true }));
  } catch (_e) {
    /* CustomEvent unavailable: the callback path still delivered the state */
  }
}

export function mountReceiptTable(containerEl, chainUrl, tableUrl, opts) {
  if (tableUrl && typeof tableUrl === "object") {
    opts = tableUrl;
    tableUrl = undefined;
  }
  opts = opts || {};

  const wrap = document.createElement("div");
  containerEl.appendChild(wrap);

  let destroyed = false;
  const innerPromise = ROOM_IMPORT().then(
    ({ mountSignalRoom }) => {
      if (destroyed) return null;
      return mountSignalRoom(wrap, chainUrl, {
        preset: "table",
        density: "embedded",
        tableUrl,
        maxRows: opts.maxRows,
        strict: opts.strict,
        onState: opts.onState,
      });
    },
    () => {
      if (!destroyed) {
        skewPanel(wrap, "table.js");
        emitSkewState(containerEl, opts);
      }
      return null;
    }
  );

  return {
    el: wrap,
    ready: innerPromise.then((handle) => (handle ? handle.ready : null)),
    refresh: () => innerPromise.then((handle) => (handle ? handle.refresh() : null)),
    destroy() {
      destroyed = true;
      innerPromise.then((handle) => handle && handle.destroy());
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    },
  };
}

// <tamper-signal-table>: unchanged element name, attributes, and handle shape.
//
//   <script type="module" src="/badge/table.js"></script>
//   <tamper-signal-table chain="/receipts/chain.json"></tamper-signal-table>
//
// Attributes:
//   chain     URL of chain.json (required; nothing mounts without it)
//   table     URL of table.json (optional; defaults to table.json beside chain)
//   max-rows  rows rendered before the "show all" footer (default 500)
//   strict    present = emit state with strict:true so the host gates other
//             views on a broken chain (the surface never blocks UI itself)
// SSR/Node safety: importing this module must not require a DOM.
const TableBase = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

class TamperSignalTableElement extends TableBase {
  static get observedAttributes() {
    return ["chain", "table", "max-rows", "strict"];
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

  // The mount handle, for hosts that want refresh()/destroy().
  get table() {
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
    const tableUrl = this.getAttribute("table") || undefined;
    const maxRows = Number(this.getAttribute("max-rows"));
    this._handle = mountReceiptTable(this, chain, tableUrl, {
      maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : undefined,
      strict: this.hasAttribute("strict"),
    });
  }
}

if (typeof customElements !== "undefined" && !customElements.get("tamper-signal-table")) {
  customElements.define("tamper-signal-table", TamperSignalTableElement);
}

export { TamperSignalTableElement };
