// The verification console, since 2.1 a preset of the Signal Room (room.js):
// the room opened with the provenance rail expanded — same lamp, same break
// card pinned at the severed link, same receipt inspector, CLI-mirror event
// log, and chain-of-custody timeline, plus the attested table the old console
// never had. This file keeps the 2.0 public contract exactly:
//
// mountReceiptConsole(containerEl, chainUrl, opts?)
//   opts: pubKey (trusted key hex or rotation array), watch (ms), warnDrift,
//         timeline (timeline.json URL; defaults to timeline.json beside chain)
//   Returns { el, ready, refresh(), destroy() }.
//
// The room is dynamic-imported so a vendored directory missing room.js fails
// LOUDLY with the re-run-assets panel instead of taking this module down with
// a static import error.

const ROOM_IMPORT = () => import("./room.js");

function skewPanel(containerEl) {
  const panel = document.createElement("div");
  panel.setAttribute(
    "style",
    "background:#0b0f14;color:#f87171;border:1px solid #1f2937;border-radius:12px;" +
      "padding:16px 18px;font:12px/1.6 ui-monospace,'SF Mono',Menlo,Monaco,monospace"
  );
  panel.textContent =
    "room.js is missing beside console.js — the vendored Tamper Signal assets are " +
    "out of step. Re-run `tamper-signal assets` (npm) or `receipts assets` (pip) " +
    "to refresh badge/, then reload.";
  containerEl.appendChild(panel);
  return panel;
}

export function mountReceiptConsole(containerEl, chainUrl, opts) {
  opts = opts || {};

  const wrap = document.createElement("div");
  containerEl.appendChild(wrap);

  let destroyed = false;
  const innerPromise = ROOM_IMPORT().then(
    ({ mountSignalRoom }) => {
      if (destroyed) return null;
      return mountSignalRoom(wrap, chainUrl, opts.pubKey, {
        preset: "console",
        density: "embedded",
        watch: opts.watch,
        warnDrift: opts.warnDrift,
        timelineUrl: opts.timeline,
      });
    },
    () => {
      if (!destroyed) skewPanel(wrap);
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
