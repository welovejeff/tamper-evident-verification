// The verified Data tab: render the canonical table document written by
// `receipts export`, after proving in the viewer's browser that it IS the
// attested data. Design reference: designs/03-data-tab.html.
//
// mountReceiptTable(containerEl, chainUrl, tableUrl?, opts?)
//   Verifies the chain (same core as the badge and the signal), fetches the
//   canonical {"headers": [...], "rows": [...]} document, re-serializes it
//   with the byte-identical JCS from badge.js, hashes it with Web Crypto
//   SHA-256, and compares against the final receipt's output hash. Only when
//   they match does the strip say VERIFIED: the rows on screen are then
//   byte-for-byte the attested data, not a claim about it.
//
//   tableUrl defaults to table.json next to chain.json. opts:
//     maxRows  rows rendered before the "show all" footer (default 500)
//
//   Returns { el, ready, refresh(), destroy() }.
//
// Honesty notes baked into the states:
// - chain red: the table renders dimmed with a red strip naming the broken
//   link; columns whose totals moved at the break are flagged.
// - table hash mismatch: red strip; the table is NOT the attested data and
//   renders dimmed. This catches a stale or edited table.json.
// - chain yellow: amber strip with the caveats; the table still verified
//   against the final receipt.
// - fetch/capability failure: grey UNVERIFIED strip, never the yellow color.

import {
  verifyReceipts,
  canonicalize,
  outputHashOf,
  totalsOf,
  SHORT,
  stageNameOf,
} from "./badge.js";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function injectTableStyles() {
  if (document.getElementById("tamper-table-styles")) return;
  const css = `
  .tt{--tt-bg:#0b0f14;--tt-panel:#11161d;--tt-border:#1f2937;--tt-chrome:#161d26;
    --tt-text:#e5e7eb;--tt-dim:#8b98a5;--tt-faint:#3d4854;--tt-row:#18202b;
    --tt-green:#34d399;--tt-red:#f87171;--tt-amber:#fbbf24;--tt-cyan:#67e8f9;
    font-family:ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Code',monospace;
    background:var(--tt-bg);border:1px solid var(--tt-border);border-radius:12px;
    color:var(--tt-text);overflow:hidden}
  .tt .tt-strip{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;
    background:var(--tt-chrome);border-bottom:1px solid var(--tt-border);
    padding:10px 14px;font-size:11px;letter-spacing:0.4px}
  .tt .tt-mark{color:var(--tt-dim);letter-spacing:1.2px}
  .tt .tt-verdict{font-weight:700}
  .tt[data-state="green"] .tt-verdict{color:var(--tt-green)}
  .tt[data-state="yellow"] .tt-verdict{color:var(--tt-amber)}
  .tt[data-state="red"] .tt-verdict{color:var(--tt-red)}
  .tt[data-state="unverifiable"] .tt-verdict{color:var(--tt-dim)}
  .tt .tt-meta{color:var(--tt-dim)}
  .tt .tt-hash{color:var(--tt-cyan)}
  .tt .tt-note{padding:8px 14px;font-size:11px;color:var(--tt-amber);
    border-bottom:1px solid var(--tt-border);background:rgba(251,191,36,0.06)}
  .tt .tt-note.tt-bad{color:var(--tt-red);background:rgba(180,35,24,0.10)}
  .tt .tt-scroll{overflow:auto;max-height:440px}
  .tt table{border-collapse:collapse;width:100%;font-size:11.5px;line-height:1.5}
  .tt th{position:sticky;top:0;background:var(--tt-panel);color:var(--tt-dim);
    text-align:left;font-weight:600;padding:8px 12px;border-bottom:1px solid var(--tt-border);
    white-space:nowrap}
  .tt th.tt-flag{color:var(--tt-red)}
  .tt td{padding:6px 12px;border-bottom:1px solid var(--tt-row);white-space:nowrap;color:var(--tt-text)}
  .tt td.tt-null{color:var(--tt-faint);font-style:italic}
  .tt td.tt-flagcol{background:rgba(248,113,113,0.06)}
  .tt[data-trust="false"] .tt-scroll{opacity:0.45}
  .tt .tt-foot{display:flex;align-items:center;gap:10px;border-top:1px solid var(--tt-border);
    padding:8px 14px;font-size:10px;color:var(--tt-faint)}
  .tt .tt-foot button{font:10px inherit;font-family:inherit;color:var(--tt-cyan);
    background:none;border:1px solid var(--tt-border);border-radius:6px;
    padding:4px 10px;cursor:pointer}
  .tt .tt-foot button:hover{border-color:var(--tt-faint)}
  .tt .tt-tagline{margin-left:auto;color:var(--tt-green)}
  .tt .tt-export{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;
    border-top:1px solid var(--tt-border);padding:8px 14px;font-size:11px;color:var(--tt-dim)}
  .tt .tt-export .tt-xlabel{color:var(--tt-text);letter-spacing:0.3px}
  .tt .tt-export label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
  .tt .tt-export select{font:11px inherit;font-family:inherit;color:var(--tt-text);
    background:var(--tt-panel);border:1px solid var(--tt-border);border-radius:6px;padding:3px 6px}
  .tt .tt-export button{font:11px inherit;font-family:inherit;color:var(--tt-cyan);
    background:none;border:1px solid var(--tt-border);border-radius:6px;padding:4px 12px;cursor:pointer}
  .tt .tt-export button:hover:not(:disabled){border-color:var(--tt-faint)}
  .tt .tt-export button:disabled{color:var(--tt-faint);cursor:not-allowed;opacity:0.6}
  .tt .tt-export .tt-xnote{flex-basis:100%;color:var(--tt-dim)}
  .tt .tt-export .tt-xnote.tt-warn{color:var(--tt-amber)}
  .tt .tt-export .tt-xhint{margin-left:auto;color:var(--tt-faint)}`;
  document.head.appendChild(el("style", { id: "tamper-table-styles", textContent: css }));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Columns whose totals moved at the broken link; the table flags them.
function brokenColumns(result) {
  const { linkResult, receipts } = result;
  if (!linkResult || linkResult.ok !== false || linkResult.brokenAt == null) return new Set();
  const up = totalsOf(receipts[linkResult.brokenAt - 1]);
  const down = totalsOf(receipts[linkResult.brokenAt]);
  const cols = new Set();
  for (const key of ["numeric_sums", "null_counts"]) {
    const a = up[key] ?? {};
    const b = down[key] ?? {};
    for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[c] !== b[c]) cols.add(c);
    }
  }
  return cols;
}

// ---------------------------------------------------------------------------
// "Take your data": client-side export of the attested data.
//
// The browser only holds the canonical table document, so it reconstructs a
// native-format file from that data (column- and row-sorted, normalized) — the
// attested data, not the user's original file byte-for-byte. A verified bundle
// also carries chain.json and the receipts (fetched as raw bytes so the
// recipient can re-verify), packaged with a store-only zip writer that mirrors
// node/zip.js. xlsx is not offered here; it goes through the Python CLI.
// ---------------------------------------------------------------------------

const _CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = _CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Store-only (no compression) zip. Entry bytes are kept verbatim so the
// bundled chain.json and receipts stay byte-identical to the server's copies —
// receipt_hashes commit to raw bytes, and any transform would verify as broken.
function makeStoredZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);
    const size = bytes.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    const localHeader = new Uint8Array(local.buffer);
    parts.push(localHeader, nameBytes, bytes);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(14, 0x21, true); // DOS date at offset 14 (offset 12 is the time field, left 0)
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += localHeader.length + nameBytes.length + size;
  }
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const c of all) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function cellText(cell) {
  if (cell === null || cell === undefined) return "";
  if (cell === true) return "true";
  if (cell === false) return "false";
  return String(cell);
}

// Reconstruct a native-format file from the canonical document. Values are the
// attested values; format is the recipient's choice. Re-ingesting any of these
// yields the same Semantic hash, since canonicalization is format-agnostic.
function serializeDoc(doc, format) {
  const { headers, rows } = doc;
  if (format === "json") {
    return JSON.stringify(rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]))), null, 2) + "\n";
  }
  if (format === "ndjson") {
    return rows.map((r) => JSON.stringify(Object.fromEntries(headers.map((h, i) => [h, r[i]])))).join("\n") + "\n";
  }
  const sep = format === "tsv" ? "\t" : ",";
  const quote = (v) => {
    const s = cellText(v);
    if (format === "tsv") return s.replace(/[\t\r\n]/g, " ");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(quote).join(sep)];
  for (const row of rows) lines.push(row.map(quote).join(sep));
  return lines.join("\n") + "\n";
}

const EXPORT_EXT = { csv: "csv", tsv: "tsv", json: "json", ndjson: "ndjson" };

function triggerDownload(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

let _ttSeq = 0;

export function mountReceiptTable(containerEl, chainUrl, tableUrl, opts) {
  if (tableUrl && typeof tableUrl === "object") {
    opts = tableUrl;
    tableUrl = undefined;
  }
  opts = opts || {};
  const maxRows = opts.maxRows ?? 500;
  injectTableStyles();

  const root = el("div", { className: "tt" });
  const verdict = el("span", { className: "tt-verdict" }, "VERIFYING");
  const meta = el("span", { className: "tt-meta" });
  const strip = el("div", { className: "tt-strip" }, [
    el("span", { className: "tt-mark" }, "🧾 DATA · TAMPER SIGNAL"),
    verdict,
    meta,
  ]);
  const noteSlot = el("div");
  const scroll = el("div", { className: "tt-scroll" });
  const foot = el("div", { className: "tt-foot" });
  const exportBar = el("div", { className: "tt-export" });
  root.append(strip, noteSlot, scroll, foot, exportBar);
  containerEl.appendChild(root);
  root.dataset.state = "unverifiable";

  const uid = String(_ttSeq++);
  let destroyed = false;
  let showAll = false;
  let currentDoc = null;
  let currentAttested = false;

  // "Take your data": rebuilt each refresh from the current verdict. The
  // verified-bundle option is offered only when the data is attested and the
  // light is green or yellow; rows-only is always available but never claims
  // proof.
  function renderExport() {
    exportBar.textContent = "";
    const state = root.dataset.state;
    const doc = currentDoc;
    if (!doc) {
      exportBar.appendChild(el("span", { className: "tt-xnote" },
        "Export unavailable: verification did not complete."));
      return;
    }
    const bundleOk = currentAttested && (state === "green" || state === "yellow");
    const typeName = `tt-xtype-${uid}`;
    const bundleRadio = el("input",
      { type: "radio", name: typeName, value: "bundle", checked: bundleOk, disabled: !bundleOk });
    const rowsRadio = el("input",
      { type: "radio", name: typeName, value: "rows", checked: !bundleOk });
    const fmt = el("select", {}, Object.keys(EXPORT_EXT).map((f) => el("option", { value: f }, f)));
    const btn = el("button", { type: "button" }, "Download");
    const note = el("div", { className: "tt-xnote" });

    exportBar.append(
      el("span", { className: "tt-xlabel" }, "Take your data"),
      el("label", {}, [bundleRadio, "Verified bundle"]),
      el("label", {}, [rowsRadio, "Rows only"]),
      fmt,
      btn,
      el("span", { className: "tt-xhint" }, "xlsx: use the receipts export command"),
      note,
    );

    function updateNote() {
      note.className = "tt-xnote";
      if (rowsRadio.checked) {
        note.textContent = "Rows only: no chain or receipts. A recipient can't verify this file.";
      } else if (state === "yellow") {
        note.className = "tt-xnote tt-warn";
        note.textContent = "The chain has caveats; a recipient will see a yellow light.";
      } else if (!bundleOk) {
        note.className = "tt-xnote tt-warn";
        note.textContent = "Verified bundle unavailable: this table is not the attested data.";
      } else {
        note.textContent = "Verified bundle: data plus chain.json and receipts. The recipient verifies it offline.";
      }
    }
    bundleRadio.addEventListener("change", updateNote);
    rowsRadio.addEventListener("change", updateNote);
    updateNote();

    btn.addEventListener("click", async () => {
      const rowsOnly = rowsRadio.checked;
      const ext = EXPORT_EXT[fmt.value];
      const dataBytes = new TextEncoder().encode(serializeDoc(doc, fmt.value));
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Preparing…";
      try {
        if (rowsOnly) {
          triggerDownload(`data-rows-only.${ext}`, dataBytes, "application/octet-stream");
        } else {
          const base = new URL(chainUrl, window.location.href);
          const chainBytes = new Uint8Array(await (await fetch(base)).arrayBuffer());
          const chainDoc = JSON.parse(new TextDecoder().decode(chainBytes));
          const entries = [
            { name: `data.${ext}`, bytes: dataBytes },
            { name: "chain.json", bytes: chainBytes },
          ];
          for (const name of chainDoc.receipts || []) {
            const bytes = new Uint8Array(await (await fetch(new URL(name, base))).arrayBuffer());
            entries.push({ name, bytes });
          }
          triggerDownload("data-verified.zip", makeStoredZip(entries), "application/zip");
        }
      } catch (_e) {
        note.className = "tt-xnote tt-warn";
        note.textContent = "Could not build the download. Try again.";
      } finally {
        btn.textContent = label;
        btn.disabled = false;
      }
    });
  }

  function setStrip(state, verdictText, metaText, trusted) {
    root.dataset.state = state;
    root.dataset.trust = String(trusted);
    verdict.textContent = verdictText;
    meta.textContent = metaText || "";
  }

  function renderTable(doc, flagged) {
    scroll.textContent = "";
    foot.textContent = "";
    const limit = showAll ? doc.rows.length : Math.min(maxRows, doc.rows.length);
    const head = el("tr", {}, doc.headers.map((h) =>
      el("th", { className: flagged.has(h) ? "tt-flag" : "" },
        flagged.has(h) ? `⚠ ${h}` : h)
    ));
    const body = doc.rows.slice(0, limit).map((row) =>
      el("tr", {}, row.map((cell, i) => {
        const cls = [
          cell === null ? "tt-null" : "",
          flagged.has(doc.headers[i]) ? "tt-flagcol" : "",
        ].join(" ").trim();
        return el("td", { className: cls }, cell === null ? "null" : String(cell));
      }))
    );
    scroll.appendChild(el("table", {}, [el("thead", {}, head), el("tbody", {}, body)]));

    foot.appendChild(el("span", {}, `${limit.toLocaleString()} of ${doc.rows.length.toLocaleString()} rows`));
    if (!showAll && doc.rows.length > maxRows) {
      const btn = el("button", { type: "button" }, "show all");
      btn.addEventListener("click", () => {
        showAll = true;
        renderTable(doc, flagged);
      });
      foot.appendChild(btn);
    }
    if (root.dataset.state === "green") {
      foot.appendChild(el("span", { className: "tt-tagline" }, "green light, open table"));
    }
  }

  async function refresh() {
    const result = await verifyReceipts(chainUrl);
    if (destroyed) return result;

    const resolvedTableUrl = tableUrl || new URL("table.json", new URL(chainUrl, window.location.href));
    let doc = null;
    try {
      const fetched = await fetch(resolvedTableUrl);
      if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
      doc = await fetched.json();
      if (!Array.isArray(doc.headers) || !Array.isArray(doc.rows)) throw new Error("not a table document");
    } catch (_e) {
      doc = null;
    }
    if (destroyed) return result;

    if (result.state === "unverifiable" || !doc) {
      setStrip("unverifiable", "UNVERIFIED",
        !doc ? "could not load table.json (run the export step)" : result.reason, false);
      scroll.textContent = "";
      foot.textContent = "";
      if (doc) renderTable(doc, new Set());
      currentDoc = doc;
      currentAttested = false;
      renderExport();
      return result;
    }

    // Hash the document exactly as Python signed it.
    let tableHash = null;
    try {
      tableHash = await sha256Hex(
        new TextEncoder().encode(canonicalize({ headers: doc.headers, rows: doc.rows }))
      );
    } catch (_e) {
      setStrip("unverifiable", "UNVERIFIED", "could not hash the table in this browser", false);
      renderTable(doc, new Set());
      return result;
    }
    const finalReceipt = result.receipts[result.receipts.length - 1];
    const attested = tableHash === outputHashOf(finalReceipt);
    const rowsText = `${doc.rows.length.toLocaleString()} rows · sha ${SHORT(tableHash)}`;
    noteSlot.textContent = "";

    if (result.state === "red") {
      const flagged = brokenColumns(result);
      setStrip("red", "CHAIN BROKEN", rowsText, false);
      noteSlot.appendChild(el("div", { className: "tt-note tt-bad" },
        `✗ ${result.reason}. Totals fed by this chain cannot be trusted` +
        (flagged.size ? `; flagged columns moved at the break: ${[...flagged].join(", ")}` : ".")));
      renderTable(doc, flagged);
    } else if (!attested) {
      setStrip("red", "NOT THE ATTESTED DATA", rowsText, false);
      noteSlot.appendChild(el("div", { className: "tt-note tt-bad" },
        `✗ This table does not match the final receipt (${stageNameOf(finalReceipt)}): ` +
        `expected ${SHORT(outputHashOf(finalReceipt))}, found ${SHORT(tableHash)}. ` +
        "The file may be stale; re-run the export step (receipts export / tamper-signal export)"));
      renderTable(doc, new Set());
    } else if (result.state === "yellow") {
      setStrip("yellow", "VERIFIED, WITH CAVEATS", rowsText, true);
      noteSlot.appendChild(el("div", { className: "tt-note" },
        "⚠ " + result.caveats.join(" · ")));
      renderTable(doc, new Set());
    } else {
      setStrip("green", "VERIFIED", rowsText, true);
      renderTable(doc, new Set());
    }
    currentDoc = doc;
    currentAttested = attested;
    renderExport();
    return result;
  }

  const ready = refresh();
  return {
    el: root,
    ready,
    refresh,
    destroy() {
      destroyed = true;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
