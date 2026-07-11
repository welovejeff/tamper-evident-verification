// The Signal Room: one light, one room. The inline status light answers "is
// it fine?"; this page answers everything after that click. It is v2's one
// robust surface — the verified data table as the landing plane, carrying
// every fixing the old table and console held: pinned signed control totals,
// the provenance rail with the break pinned at the severed link, the receipt
// inspector, the CLI-mirror event log, the chain-of-custody timeline, and the
// "Take your data" evidence export. Built on the same verification core as
// the light (verifyReceipts in badge.js). No build step, no framework.
//
// The room renders a FIXED six-region skeleton — verdict strip, headline
// slot, provenance rail, table plane, drawers, footer — whose prominence
// adapts to the verdict while its DOM order never changes: green earns
// silence and leads with rows; yellow leads with located caveat cards; red
// leads with the break exhibit in business numbers while the table dims to
// supporting evidence. Transitions only expand/collapse/recolor; under watch
// nothing steals scroll or focus.
//
// mountSignalRoom(containerEl, chainUrl, pubKeyHex?, opts?)
//   Same argument contract as mountTamperSignal: pubKeyHex may be a trusted
//   key hex, an array of them (rotation), or the opts object. opts:
//     tableUrl     table.json URL (default: table.json beside chain.json)
//     timelineUrl  timeline.json URL (default: timeline.json beside chain.json)
//     warnDrift    flag control-totals movement across links as a caveat
//     watch        re-verify every N ms (min 1000)
//     strict       emitted in the state detail so a host can gate its own UI
//     maxRows      rows rendered before "show all" (default 500)
//     onState      callback receiving every emitted state detail
//     focus        programmatic deep-link target applied after first render
//     preset       "room" (default) | "table" | "console" — initial emphasis
//                  only: "table" keeps the rail collapsed to chips (today's
//                  Data tab, fixings one click away), "console" starts with
//                  the rail expanded
//     density      "page" (served route: full-bleed, hash deep links) |
//                  "embedded" (default: bordered card, no hash routing)
//     rawHref      override the footer's raw chain.json link
//   Returns { el, ready, refresh(), destroy(), getState(), open(target) }.
//   refresh() always bypasses the verification memo (invalidateVerification)
//   so "re-verify" means a fresh run. open() accepts "break",
//   "inspector:<stageOrIndex>", "caveat:<n>", "column:<name>", "custody",
//   "log", "rail".
//
// Verdicts (vocabulary from VOCAB in badge.js, shared with the light):
//   green        chain intact + the rows on screen are byte-identical to the
//                final receipt's output (continuity, never source correctness)
//   yellow       verifies, with located caveats — never green-with-an-asterisk
//   red          CHAIN BROKEN (hash mismatch / bad signature / receipt file
//                mismatch / empty chain) — the only state that wears the
//                severed-link grammar
//   red-stale    NOT THE ATTESTED DATA: the chain verifies; the published
//                table does not match its tail. A build-behind state — solid
//                lamp, wrench copy, no lightning, never styled as forgery
//   unverifiable grey capability fallback; says nothing about the chain and
//                never wears the yellow color
// A missing table.json is NOT a verdict: the chain verdict renders fully and
// only the table plane shows a grey "no attested table published" slab.
//
// After every run the room fires opts.onState(detail) and a bubbling
// "tamper-signal:state" CustomEvent with detail {state, attested, strict}:
// state is the CHAIN verdict, attested the byte-identity boolean (red-stale
// emits its chain state with attested:false). The room never blocks host UI;
// the documented host gate is `strict && (state === "red" || !attested)`.
//
// Deep links (#break, #receipt=<stage>, #caveat=<n>, #column=<name>,
// #custody, #log, ?focus=auto) are scroll/expand hints ONLY, honored only in
// page density and only when this document's own fresh verification agrees
// with the state they imply — the URL can never carry or imply a verdict.

import {
  verifyReceipts,
  invalidateVerification,
  verifySignature,
  canonicalize,
  SHORT,
  totalsOf,
  stageNameOf,
  outputHashOf,
  inputHashOf,
  changedColumns,
  el,
  VOCAB,
  TOKENS,
} from "./badge.js";

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// "Take your data": client-side export of the attested data (moved verbatim
// from the old table.js). The browser reconstructs a native-format file from
// the canonical table document; a verified bundle also carries chain.json and
// the receipts as raw bytes so the recipient can re-verify offline.
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

// Shipped inside every verified bundle so a recipient can verify it without
// prior knowledge of Tamper Signal. Kept in sync with the CLIs (tamper_signal/
// cli.py BUNDLE_README, node/cli.js BUNDLE_README).
const BUNDLE_README = `# Verified data bundle (Tamper Signal)

This zip is a verified export from Tamper Signal. It holds the data file plus
chain.json and the receipt files that prove it.

## Verify it yourself, offline

Install either stack (chains are interchangeable across them):

    pip install tamper-signal       # Python 3.11+, command: receipts
    npm install -g tamper-signal    # Node 18.17+, command: tamper-signal

Then, from the folder you unzipped this into:

    receipts verify chain.json

The exit code is the traffic light: 0 green (intact), 2 yellow (verifies, with
caveats), 1 red (broken, at the exact link, with the totals that moved).

## What a green light proves

Continuity, not correctness. It proves this data descends unchanged from the
signed source, not that the source was right to begin with. Green means nobody
changed the data between the export and you.

https://tampersignal.com
`;

// The evidence variant, offered at red-broken: it packages the chain and
// receipts so an analyst can reproduce the failure. It claims nothing about
// the data — the recipient will see the same red light at the same link.
const EVIDENCE_README = `# Evidence bundle (Tamper Signal)

This chain DOES NOT VERIFY: the receipts in this zip reproduce the failure.
Run the verifier to see the broken link and the control totals that moved:

    pip install tamper-signal && receipts verify chain.json
    # or: npm install -g tamper-signal && tamper-signal verify chain.json

verification-transcript.txt holds the browser verifier's log for this session.

https://tampersignal.com
`;

// ---------------------------------------------------------------------------
// Chain-topology helpers (moved from the old console.js).
// ---------------------------------------------------------------------------

// Parse "coverage gap: receipt numbering jumps 001 -> 003; ..." caveats into
// the rail position (insert the ghost after the receipt whose prefix is the
// jump's left side). Returns a map from receipt-array index to gap label.
function gapPositions(result) {
  const gaps = new Map();
  const names = result.chain?.receipts ?? [];
  for (const caveat of result.caveats ?? []) {
    const match = /numbering jumps (\d{3}) -> (\d{3})/.exec(caveat);
    if (!match) continue;
    const after = names.findIndex((n) => String(n).startsWith(match[1] + "_"));
    if (after !== -1) gaps.set(after, `between ${match[1]} and ${match[2]}`);
  }
  return gaps;
}

// Columns that first appear downstream of a coverage gap: a stage that left no
// receipt derived them, so they carry an UNVERIFIED tag in the table. This is
// the honest, computable subset — column-level, never per-cell.
function gapDerivedColumns(result) {
  const cols = new Set();
  const receipts = result.receipts || [];
  for (const [afterIndex] of gapPositions(result)) {
    const up = totalsOf(receipts[afterIndex]) || {};
    const down = totalsOf(receipts[afterIndex + 1]) || {};
    const upCols = new Set([
      ...Object.keys(up.numeric_sums || {}),
      ...Object.keys(up.null_counts || {}),
    ]);
    for (const key of ["numeric_sums", "null_counts"]) {
      for (const c of Object.keys(down[key] || {})) {
        if (!upCols.has(c)) cols.add(c);
      }
    }
  }
  return cols;
}

// Mirror the CLI verifier's report shape for the event log. Character-
// identical to the old console.js: what is projected in a meeting matches
// what the skeptic's analyst runs in the terminal afterwards.
function cliLines(result) {
  const out = [];
  if (result.state === "unverifiable") {
    out.push(["t-faint", `! UNVERIFIABLE: ${result.reason}`]);
    return out;
  }
  const rows = result.receipts.length
    ? totalsOf(result.receipts[result.receipts.length - 1]).row_count ?? "?"
    : "?";
  if (result.state === "green") {
    out.push(["t-green", `✓ CHAIN INTACT: ${result.receipts.length} receipts, ${result.transforms} transforms, final row_count ${rows}`]);
  } else if (result.state === "yellow") {
    out.push(["t-amber", `⚠ CHAIN VERIFIES, WITH CAVEATS: ${result.receipts.length} receipts, ${result.transforms} transforms, final row_count ${rows}`]);
    for (const caveat of result.caveats) out.push(["", `  - ${caveat}`]);
    out.push(["t-amber", "  A human should look."]);
  } else {
    const lr = result.linkResult;
    if (lr && lr.ok === false) {
      out.push(["t-red", `✗ CHAIN BROKEN at link ${lr.brokenAt - 1} -> ${lr.brokenAt} (${lr.brokenStage})`]);
      out.push(["", `  expected input hash ${SHORT(lr.expected)}  (output of ${stageNameOf(result.receipts[lr.brokenAt - 1])})`]);
      out.push(["", `  found    input hash ${SHORT(lr.found)}`]);
      if (lr.delta?.length) out.push(["", `  Control totals delta vs upstream: ${lr.delta.join(", ")}`]);
    } else {
      out.push(["t-red", `✗ ${result.reason.toUpperCase()}`]);
    }
  }
  return out;
}

// The break exhibit's business-numbers grid: metric | expected | found | Δ,
// built from the raw control totals either side of the severed link.
function breakGridRows(result) {
  const lr = result.linkResult;
  if (!lr || lr.ok !== false || lr.brokenAt == null) return [];
  const up = totalsOf(result.receipts[lr.brokenAt - 1]) || {};
  const down = totalsOf(result.receipts[lr.brokenAt]) || {};
  const rows = [];
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (v) => {
    const n = num(v);
    if (n === null) return v === undefined ? "—" : String(v);
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };
  const delta = (a, b) => {
    const x = num(a);
    const y = num(b);
    if (x === null || y === null) return "—";
    const d = y - x;
    return `${d >= 0 ? "+" : ""}${d.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  };
  if (up.row_count !== down.row_count) {
    rows.push(["rows", fmt(up.row_count), fmt(down.row_count), delta(up.row_count, down.row_count)]);
  }
  for (const col of changedColumns(up, down)) {
    const a = (up.numeric_sums || {})[col];
    const b = (down.numeric_sums || {})[col];
    if (a !== b) {
      rows.push([col, fmt(a), fmt(b), delta(a, b)]);
      continue;
    }
    const an = (up.null_counts || {})[col] ?? 0;
    const bn = (down.null_counts || {})[col] ?? 0;
    rows.push([`${col} (nulls)`, fmt(an), fmt(bn), delta(an, bn)]);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Styles: one injection, consuming the shared TOKENS palette from badge.js.
// ---------------------------------------------------------------------------

function injectRoomStyles() {
  if (document.getElementById("tamper-room-styles")) return;
  const css = `
  .tsr{${TOKENS};
    font-family:ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Code',monospace;
    background:var(--ts-bg);color:var(--ts-text);font-size:12px;line-height:1.55}
  .tsr[data-density="embedded"]{border:1px solid var(--ts-border);border-radius:12px;overflow:hidden}
  .tsr[data-density="page"]{min-height:100vh}

  /* 1 · verdict strip */
  .tsr .tsr-strip{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;
    gap:8px 12px;background:var(--ts-chrome);border-bottom:1px solid var(--ts-border);
    padding:11px 16px}
  .tsr .tsr-lamp{width:16px;height:16px;border-radius:50%;flex:none;background:var(--ts-faint)}
  .tsr[data-state="green"] .tsr-lamp{background:var(--ts-green);box-shadow:0 0 10px 1px rgba(52,211,153,0.7);
    animation:tsr-breathe 4s ease-in-out infinite}
  .tsr[data-state="yellow"] .tsr-lamp{background:var(--ts-amber);box-shadow:0 0 10px 1px rgba(251,191,36,0.7);
    animation:tsr-breathe 1.6s ease-in-out infinite}
  .tsr[data-state="red"] .tsr-lamp{background:var(--ts-red);box-shadow:0 0 10px 1px rgba(248,113,113,0.7);
    animation:tsr-blink 1.8s steps(1) infinite}
  .tsr[data-state="red-stale"] .tsr-lamp{background:var(--ts-red);box-shadow:0 0 10px 1px rgba(248,113,113,0.7)}
  @keyframes tsr-breathe{0%,100%{opacity:1}50%{opacity:0.55}}
  @keyframes tsr-blink{0%,12%,24%{opacity:1}6%,18%{opacity:0.25}30%,100%{opacity:1}}
  @media (prefers-reduced-motion: reduce){.tsr .tsr-lamp{animation:none !important}}
  .tsr .tsr-mark{color:var(--ts-dim);letter-spacing:1.2px;font-size:11px}
  .tsr .tsr-verdict{font-weight:700}
  .tsr[data-state="green"] .tsr-verdict{color:var(--ts-green)}
  .tsr[data-state="yellow"] .tsr-verdict{color:var(--ts-amber)}
  .tsr[data-state="red"] .tsr-verdict,.tsr[data-state="red-stale"] .tsr-verdict{color:var(--ts-red)}
  .tsr[data-state="checking"] .tsr-verdict,.tsr[data-state="unverifiable"] .tsr-verdict{color:var(--ts-dim)}
  .tsr .tsr-directive{color:var(--ts-dim)}
  .tsr .tsr-time{margin-left:auto;color:var(--ts-faint);font-size:10px}
  .tsr .tsr-reverify{font:10px inherit;font-family:inherit;color:var(--ts-cyan);background:none;
    border:1px solid var(--ts-border);border-radius:6px;padding:5px 10px;cursor:pointer}
  .tsr .tsr-reverify:hover{border-color:var(--ts-faint)}
  .tsr .tsr-reverify:focus-visible{outline:2px solid var(--ts-cyan);outline-offset:2px}

  /* 2 · headline slot (empty on green — green earns silence) */
  .tsr .tsr-headline:empty{display:none}
  .tsr .tsr-break{margin:14px 16px 4px;border:1px solid rgba(248,113,113,0.4);
    background:rgba(180,35,24,0.10);border-radius:9px;padding:12px 16px}
  .tsr .tsr-break h3{margin:0 0 8px;color:var(--ts-red);font-size:12px}
  .tsr .tsr-break-grid{width:auto;border-collapse:collapse;margin:0 0 10px;font-size:12px}
  .tsr .tsr-break-grid th{text-align:left;font-weight:400;font-size:10px;color:var(--ts-faint);
    padding:0 18px 4px 0;border-bottom:1px solid var(--ts-border)}
  .tsr .tsr-break-grid td{padding:4px 18px 4px 0}
  .tsr .tsr-break-grid td:first-child{font-weight:700}
  .tsr .tsr-break-grid .bad{color:var(--ts-red)}
  .tsr .tsr-break .kv{display:flex;gap:10px;padding:1px 0;font-size:11px}
  .tsr .tsr-break .kv b{color:var(--ts-faint);font-weight:400;width:70px;flex:none}
  .tsr .tsr-break .bad{color:var(--ts-red)}
  .tsr .tsr-break .hash{color:var(--ts-cyan)}
  .tsr .tsr-break-open{margin-top:9px;font:11px inherit;font-family:inherit;color:var(--ts-cyan);
    background:none;border:1px solid var(--ts-border);border-radius:6px;padding:5px 12px;cursor:pointer}
  .tsr .tsr-break-open:hover{border-color:var(--ts-faint)}
  .tsr .tsr-stale{margin:14px 16px 4px;border:1px dashed rgba(248,113,113,0.55);
    background:repeating-linear-gradient(135deg,rgba(180,35,24,0.07),rgba(180,35,24,0.07) 8px,
      rgba(180,35,24,0.02) 8px,rgba(180,35,24,0.02) 16px);
    border-radius:9px;padding:12px 16px;color:var(--ts-text)}
  .tsr .tsr-stale h3{margin:0 0 6px;color:var(--ts-red);font-size:12px}
  .tsr .tsr-stale code{color:var(--ts-cyan)}
  .tsr .tsr-stale .hash{color:var(--ts-cyan)}
  .tsr .tsr-caveat{margin:14px 16px 4px;border:1px dashed rgba(251,191,36,0.45);
    background:rgba(251,191,36,0.07);border-radius:9px;padding:10px 14px;color:var(--ts-amber);
    display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px}
  .tsr .tsr-caveat + .tsr-caveat{margin-top:8px}
  .tsr .tsr-caveat .showme{font:10px inherit;font-family:inherit;color:var(--ts-cyan);background:none;
    border:1px solid var(--ts-border);border-radius:6px;padding:3px 9px;cursor:pointer;flex:none}
  .tsr .tsr-caveat .showme:hover{border-color:var(--ts-faint)}
  .tsr .tsr-grey{margin:14px 16px 4px;border:1px solid var(--ts-border);
    background:var(--ts-panel);border-radius:9px;padding:10px 14px;color:var(--ts-dim)}

  /* 3 · provenance rail */
  .tsr .tsr-rail-region{padding:10px 16px 2px}
  .tsr .tsr-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11px;color:var(--ts-dim)}
  .tsr .tsr-chip{border:1px solid var(--ts-border);border-radius:999px;background:var(--ts-panel);
    padding:4px 10px;cursor:pointer;color:var(--ts-text);font:11px inherit;font-family:inherit;
    display:inline-flex;align-items:center;gap:6px}
  .tsr .tsr-chip:hover{border-color:var(--ts-faint)}
  .tsr .tsr-chip .ok{color:var(--ts-green)}
  .tsr .tsr-chip.gap{border-style:dashed;border-color:rgba(251,191,36,0.55);color:var(--ts-amber)}
  .tsr .tsr-chips .arrow{color:var(--ts-faint)}
  .tsr .tsr-expand{font:10px inherit;font-family:inherit;color:var(--ts-cyan);background:none;
    border:1px solid var(--ts-border);border-radius:6px;padding:4px 10px;cursor:pointer;margin-left:4px}
  .tsr .tsr-expand:hover{border-color:var(--ts-faint)}
  .tsr .tsr-rail-wrap{padding:8px 0 6px;overflow-x:auto}
  .tsr .tsr-rail{display:flex;align-items:flex-start;gap:0;min-width:max-content}
  .tsr .tsr-node{border:1px solid var(--ts-border);border-radius:10px;background:var(--ts-panel);
    padding:10px 12px;min-width:148px;cursor:pointer}
  .tsr .tsr-node:hover{border-color:var(--ts-faint)}
  .tsr .tsr-node.active{border-color:var(--ts-cyan)}
  .tsr .tsr-node.ghost{border-style:dashed;border-color:rgba(251,191,36,0.55);
    color:var(--ts-amber);cursor:default;background:rgba(251,191,36,0.04)}
  .tsr .tsr-node .n-name{font-weight:700;font-size:12px}
  .tsr .tsr-node .n-kind{color:var(--ts-faint);font-size:9px;letter-spacing:0.6px;text-transform:uppercase}
  .tsr .tsr-node .n-row{color:var(--ts-dim);font-size:10.5px;margin-top:5px}
  .tsr .tsr-node .hash{color:var(--ts-cyan)}
  .tsr .tsr-node .ok{color:var(--ts-green)}
  .tsr .tsr-link{display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:0 4px;min-width:96px;align-self:stretch}
  .tsr .tsr-link .l-line{font-size:11px;white-space:nowrap;color:var(--ts-green)}
  .tsr .tsr-link .l-hash{font-size:9.5px;color:var(--ts-faint);margin-top:2px}
  .tsr .tsr-link.broken .l-line{color:var(--ts-red);font-weight:700}
  .tsr .tsr-link.gap .l-line{color:var(--ts-amber)}

  /* 4 · table plane */
  .tsr .tsr-table-region{margin:12px 16px}
  .tsr .tsr-table-note{font-size:10px;color:var(--ts-faint);margin:0 0 6px}
  .tsr .tsr-scroll{overflow:auto;max-height:480px;border:1px solid var(--ts-border);border-radius:9px}
  .tsr table.tsr-data{border-collapse:collapse;width:100%;font-size:11.5px;line-height:1.5}
  .tsr .tsr-data th{position:sticky;top:0;background:var(--ts-panel);color:var(--ts-dim);
    text-align:left;font-weight:600;padding:8px 12px;border-bottom:1px solid var(--ts-border);
    white-space:nowrap;z-index:1}
  .tsr .tsr-data th.flag{color:var(--ts-red)}
  .tsr .tsr-data th .untag{color:var(--ts-amber);font-size:9px;letter-spacing:0.5px;margin-left:6px}
  .tsr .tsr-data td{padding:6px 12px;border-bottom:1px solid var(--ts-row);white-space:nowrap;color:var(--ts-text)}
  .tsr .tsr-data td.null{color:var(--ts-faint);font-style:italic}
  .tsr .tsr-data td.flagcol{background:rgba(248,113,113,0.06)}
  .tsr .tsr-data tr.totals td{position:sticky;top:33px;background:var(--ts-chrome);color:var(--ts-cyan);
    border-bottom:1px solid var(--ts-border);font-weight:600;z-index:1}
  .tsr .tsr-data tr.totals td:first-child{color:var(--ts-dim);font-weight:400;font-size:10px;letter-spacing:0.5px}
  .tsr .tsr-dim-wrap{position:relative}
  .tsr[data-trust="false"] .tsr-scroll{opacity:0.45}
  .tsr .tsr-dim-note{display:none}
  .tsr[data-trust="false"] .tsr-dim-note{display:block;position:absolute;top:8px;left:50%;
    transform:translateX(-50%);z-index:2;background:var(--ts-bg);border:1px solid var(--ts-border);
    border-radius:7px;padding:5px 12px;color:var(--ts-dim);font-size:10px;white-space:nowrap}
  .tsr .tsr-table-foot{display:flex;align-items:center;gap:10px;padding:7px 2px 0;
    font-size:10px;color:var(--ts-faint)}
  .tsr .tsr-table-foot button{font:10px inherit;font-family:inherit;color:var(--ts-cyan);
    background:none;border:1px solid var(--ts-border);border-radius:6px;padding:4px 10px;cursor:pointer}
  .tsr .tsr-table-foot button:hover{border-color:var(--ts-faint)}
  .tsr .tsr-noshown{border:1px solid var(--ts-border);border-radius:9px;background:var(--ts-panel);
    color:var(--ts-dim);padding:16px;font-size:11px}
  .tsr .tsr-noshown code{color:var(--ts-cyan)}
  .tsr .tsr-shownote{border-bottom:1px solid var(--ts-border);background:var(--ts-chrome);
    color:var(--ts-dim);padding:6px 12px;font-size:10px}

  /* 5 · drawers */
  .tsr .tsr-drawers{margin:4px 16px 10px}
  .tsr details.tsr-drawer{border:1px solid var(--ts-border);border-radius:9px;background:var(--ts-panel);
    margin:8px 0}
  .tsr details.tsr-drawer>summary{cursor:pointer;padding:9px 14px;color:var(--ts-dim);font-size:10px;
    letter-spacing:1px;text-transform:uppercase;list-style:none;display:flex;align-items:baseline;gap:8px}
  .tsr details.tsr-drawer>summary::-webkit-details-marker{display:none}
  .tsr details.tsr-drawer>summary::before{content:"▸";color:var(--ts-faint);font-size:9px}
  .tsr details.tsr-drawer[open]>summary::before{content:"▾"}
  .tsr details.tsr-drawer>summary:focus-visible{outline:2px solid var(--ts-cyan);outline-offset:2px}
  .tsr .tsr-drawer-body{border-top:1px solid var(--ts-border);padding:10px 14px;font-size:11px}
  .tsr .tsr-inspect .kv{display:flex;gap:10px;padding:1px 0}
  .tsr .tsr-inspect .kv b{color:var(--ts-faint);font-weight:400;width:92px;flex:none}
  .tsr .tsr-inspect .hash{color:var(--ts-cyan)}
  .tsr .tsr-inspect summary{cursor:pointer;color:var(--ts-faint);font-size:10px;margin-top:6px}
  .tsr .tsr-inspect pre{margin:8px 0 0;padding:10px;background:var(--ts-bg);
    border:1px solid var(--ts-border);border-radius:7px;font-size:10px;line-height:1.5;
    overflow:auto;max-height:240px}
  .tsr .tsr-inspect .hint{color:var(--ts-faint)}
  .tsr .tsr-log{background:#07090d;border-radius:0 0 8px 8px;padding:10px 14px;max-height:190px;overflow-y:auto}
  .tsr .tsr-log .entry{font-size:10.5px;line-height:1.7;color:var(--ts-dim);white-space:pre-wrap}
  .tsr .t-green{color:var(--ts-green)}
  .tsr .t-amber{color:var(--ts-amber)}
  .tsr .t-red{color:var(--ts-red)}
  .tsr .t-faint{color:var(--ts-faint)}
  .tsr .tsr-custody-warn{color:var(--ts-amber);font-size:11px}
  .tsr .tsr-custody-count{color:var(--ts-faint);font-size:10px;margin:0 0 6px}
  .tsr .tsr-custody-list .c-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;
    padding:6px 0;border-top:1px solid var(--ts-row)}
  .tsr .tsr-custody-list .c-mark{color:var(--ts-cyan);font-size:10px;min-width:64px}
  .tsr .tsr-custody-list .c-mark.c-pending{color:var(--ts-amber)}
  .tsr .tsr-custody-list .c-stage{font-weight:700}
  .tsr .tsr-custody-list .c-meta{color:var(--ts-dim);font-size:10.5px}
  .tsr .tsr-custody-list .c-when{margin-left:auto;color:var(--ts-faint);font-size:10px}
  .tsr .tsr-custody-list .c-ann{padding:3px 0 5px 64px;font-size:11px;color:var(--ts-text)}
  .tsr .tsr-custody-list .c-ann.c-superseded{opacity:0.55;text-decoration:line-through}
  .tsr .tsr-custody-list .c-ann .c-author{margin-left:10px;color:var(--ts-faint);font-size:10px}
  .tsr .tsr-custody-head2{color:var(--ts-dim);letter-spacing:1px;font-size:10px;
    margin:10px 0 4px;text-transform:uppercase}

  /* 6 · footer */
  .tsr .tsr-foot{border-top:1px solid var(--ts-border);padding:10px 16px 12px}
  .tsr .tsr-export{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;
    font-size:11px;color:var(--ts-dim)}
  .tsr .tsr-export .xlabel{color:var(--ts-text);letter-spacing:0.3px}
  .tsr .tsr-export label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
  .tsr .tsr-export select{font:11px inherit;font-family:inherit;color:var(--ts-text);
    background:var(--ts-panel);border:1px solid var(--ts-border);border-radius:6px;padding:3px 6px}
  .tsr .tsr-export button{font:11px inherit;font-family:inherit;color:var(--ts-cyan);
    background:none;border:1px solid var(--ts-border);border-radius:6px;padding:4px 12px;cursor:pointer}
  .tsr .tsr-export button:hover:not(:disabled){border-color:var(--ts-faint)}
  .tsr .tsr-export button:disabled{color:var(--ts-faint);cursor:not-allowed;opacity:0.6}
  .tsr .tsr-export .xnote{flex-basis:100%;color:var(--ts-dim)}
  .tsr .tsr-export .xnote.warn{color:var(--ts-amber)}
  .tsr .tsr-foot-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;
    margin-top:10px;font-size:10px;color:var(--ts-faint)}
  .tsr .tsr-foot-meta a{color:var(--ts-cyan);opacity:0.7;text-decoration:none}
  .tsr .tsr-foot-meta a:hover{text-decoration:underline}
  .tsr .tsr-tagline{margin-left:auto;color:var(--ts-green)}`;
  document.head.appendChild(el("style", { id: "tamper-room-styles", textContent: css }));
}

// ---------------------------------------------------------------------------
// The room.
// ---------------------------------------------------------------------------

export function mountSignalRoom(containerEl, chainUrl, pubKeyHex, opts) {
  // Same shifted-argument contract as mountTamperSignal: arrays are trusted
  // keysets (rotation), a plain object is the options bag.
  if (pubKeyHex && typeof pubKeyHex === "object" && !Array.isArray(pubKeyHex)) {
    opts = pubKeyHex;
    pubKeyHex = undefined;
  }
  opts = opts || {};
  const preset = opts.preset === "table" || opts.preset === "console" ? opts.preset : "room";
  const density = opts.density === "page" ? "page" : "embedded";
  const maxRows = opts.maxRows ?? 500;
  injectRoomStyles();

  // --- fixed six-region skeleton (DOM order never changes) ---
  const lamp = el("span", { className: "tsr-lamp" });
  lamp.setAttribute("aria-hidden", "true");
  const verdictEl = el("span", { className: "tsr-verdict" }, VOCAB.verdicts.checking);
  verdictEl.setAttribute("aria-live", "polite");
  const directiveEl = el("span", { className: "tsr-directive" }, VOCAB.directives.checking);
  const timeEl = el("span", { className: "tsr-time" });
  const reverify = el("button", { className: "tsr-reverify", type: "button" }, "re-verify");
  const strip = el("div", { className: "tsr-strip" }, [
    lamp,
    el("span", { className: "tsr-mark" }, "TAMPER SIGNAL · ROOM"),
    verdictEl,
    directiveEl,
    timeEl,
    reverify,
  ]);

  const headline = el("div", { className: "tsr-headline" });
  const railRegion = el("div", { className: "tsr-rail-region" });
  const tableRegion = el("div", { className: "tsr-table-region" });

  const inspectBody = el("div", { className: "tsr-drawer-body tsr-inspect" }, [
    el("span", { className: "hint" }, "Click a stage in the chain above to inspect its receipt."),
  ]);
  const inspectDrawer = el("details", { className: "tsr-drawer" }, [
    el("summary", {}, "Receipt inspector"),
    inspectBody,
  ]);
  const logEntries = el("div");
  const logDrawer = el("details", { className: "tsr-drawer" }, [
    el("summary", {}, "Event log · mirrors `receipts verify`"),
    el("div", { className: "tsr-drawer-body tsr-log" }, [logEntries]),
  ]);
  const custodyBody = el("div", { className: "tsr-drawer-body" });
  const custodyDrawer = el("details", { className: "tsr-drawer" }, [
    // Text-only header, no counts: custody is additive and must not lend the
    // verdict weight from a collapsed summary (R16).
    el("summary", {}, "Chain of custody · additive · never affects the verdict"),
    custodyBody,
  ]);
  const drawers = el("div", { className: "tsr-drawers" }, [inspectDrawer, logDrawer, custodyDrawer]);

  const exportBar = el("div", { className: "tsr-export" });
  const rawLink = el("a", {
    href: opts.rawHref || chainUrl,
    target: "_blank",
    rel: "noopener",
    textContent: "raw chain (JSON) ↗",
  });
  const taglineSlot = el("span", { className: "tsr-tagline" });
  const footMeta = el("div", { className: "tsr-foot-meta" }, [
    el("span", {}, "green = continuity, not correctness · re-verified in your browser"),
    rawLink,
    taglineSlot,
  ]);
  const foot = el("div", { className: "tsr-foot" }, [exportBar, footMeta]);

  const root = el("div", { className: "tsr" }, [strip, headline, railRegion, tableRegion, drawers, foot]);
  root.dataset.state = "checking";
  root.dataset.density = density;
  root.dataset.preset = preset;
  root.dataset.trust = "true";
  // The room's stable anchor: the first room in a document owns #tamper-room,
  // so inline light mounts can pass receiptsHref: "#tamper-room".
  if (!document.getElementById("tamper-room")) root.id = "tamper-room";
  containerEl.appendChild(root);

  // --- mutable state ---
  let destroyed = false;
  let timer = null;
  let firstRender = true;
  let railExpanded = preset === "console";
  let railExpandedExplicit = preset === "console";
  let showAll = false;
  let activeNode = null;
  let current = {
    result: null,
    doc: null,
    attested: false,
    tableState: "missing", // "attested" | "stale" | "missing" | "unhashable" | "unverified"
    tableHash: null,
  };
  const transcript = [];

  const resolvedTableUrl = () =>
    opts.tableUrl || new URL("table.json", new URL(chainUrl, window.location.href)).href;
  const timelineUrl =
    opts.timelineUrl || opts.timeline ||
    new URL("timeline.json", new URL(chainUrl, window.location.href)).href;

  // Display state: the chain verdict, except that an intact chain over a
  // stale/mismatched table wears "red-stale" (NOT THE ATTESTED DATA).
  function displayState() {
    const r = current.result;
    if (!r) return "checking";
    if (r.state === "red" || r.state === "unverifiable") return r.state;
    return current.tableState === "stale" ? "red-stale" : r.state;
  }

  function emitState() {
    const r = current.result;
    if (!r) return;
    const detail = { state: r.state, attested: current.attested, strict: !!opts.strict };
    try {
      if (typeof opts.onState === "function") opts.onState(detail);
    } catch (_e) {
      /* a host callback throwing must not break verification rendering */
    }
    try {
      containerEl.dispatchEvent(new CustomEvent("tamper-signal:state", { detail, bubbles: true }));
    } catch (_e) {
      /* CustomEvent unavailable: the callback path still delivered the state */
    }
  }

  // --- region 1: verdict strip ---
  function renderStrip() {
    const state = displayState();
    root.dataset.state = state;
    const r = current.result;
    if (state === "red-stale") {
      verdictEl.textContent = VOCAB.redStale;
      directiveEl.textContent = VOCAB.directives.redStale;
    } else {
      verdictEl.textContent = VOCAB.verdicts[state] || VOCAB.verdicts.checking;
      directiveEl.textContent = VOCAB.directives[state] || "";
    }
    if (r && r.verifiedAt) {
      timeEl.textContent = `verified ${r.verifiedAt.slice(11, 19)}Z in this browser`;
    }
  }

  // --- region 2: headline slot ---
  function renderHeadline() {
    headline.textContent = "";
    const state = displayState();
    const r = current.result;
    if (!r || state === "green" || state === "checking") return; // green earns silence

    if (state === "unverifiable") {
      headline.appendChild(
        el("div", { className: "tsr-grey" }, [
          el("strong", {}, "The room could not check this chain: "),
          `${r.reason}. ${VOCAB.directives.unverifiable}`,
        ])
      );
      return;
    }

    if (state === "red") {
      const lr = r.linkResult;
      const card = el("div", { className: "tsr-break", id: "tsr-break" });
      if (lr && lr.ok === false) {
        card.appendChild(
          el("h3", {}, `✗ break at link ${lr.brokenAt - 1} -> ${lr.brokenAt} (${lr.brokenStage})`)
        );
        const grid = breakGridRows(r);
        if (grid.length) {
          card.appendChild(
            el("table", { className: "tsr-break-grid" }, [
              el("thead", {}, el("tr", {}, [
                el("th", {}, "metric"),
                el("th", {}, "expected"),
                el("th", {}, "found"),
                el("th", {}, "Δ"),
              ])),
              el("tbody", {}, grid.map(([metric, a, b, d]) =>
                el("tr", {}, [
                  el("td", {}, metric),
                  el("td", {}, a),
                  el("td", { className: "bad" }, b),
                  el("td", { className: "bad" }, d),
                ])
              )),
            ])
          );
        }
        card.appendChild(el("div", { className: "kv" }, [
          el("b", {}, "expected"),
          el("span", {}, [
            el("span", { className: "hash" }, SHORT(lr.expected)),
            ` (output of ${stageNameOf(r.receipts[lr.brokenAt - 1])}, signed)`,
          ]),
        ]));
        card.appendChild(el("div", { className: "kv" }, [
          el("b", {}, "found"),
          el("span", { className: "bad" }, SHORT(lr.found)),
        ]));
        const openBtn = el("button", { className: "tsr-break-open", type: "button" }, "open at the break ↓");
        openBtn.addEventListener("click", () => open("rail"));
        card.appendChild(openBtn);
      } else {
        card.appendChild(el("h3", {}, `✗ ${r.reason}`));
        card.appendChild(el("div", {}, "The chain cannot be trusted as signed."));
      }
      headline.appendChild(card);
      return;
    }

    if (state === "red-stale") {
      const final = r.receipts[r.receipts.length - 1];
      headline.appendChild(
        el("div", { className: "tsr-stale", id: "tsr-stale" }, [
          el("h3", {}, "🔧 the chain verifies; the published table does not match its tail"),
          el("p", { style: "margin:0 0 8px" }, [
            "This table does not match the final receipt (expected ",
            el("span", { className: "hash" }, SHORT(outputHashOf(final))),
            ", found ",
            el("span", { className: "hash" }, SHORT(current.tableHash)),
            "). The chain itself verifies — the light stays ",
            el("span", { style: "color:var(--ts-green)" }, "green"),
            "; this page's table is behind it.",
          ]),
          el("p", { style: "margin:0" }, [
            "Re-run the export step: ",
            el("code", {}, "receipts export receipts/chain.json --data <file>"),
            " (pip) / ",
            el("code", {}, "tamper-signal export"),
            " (npm).",
          ]),
        ])
      );
      return;
    }

    // yellow: one located caveat card per caveat, each with a way in.
    (r.caveats || []).forEach((caveat, i) => {
      const card = el("div", { className: "tsr-caveat" }, [el("span", {}, `⚠ ${caveat}`)]);
      card.id = `tsr-caveat-${i}`;
      const btn = el("button", { className: "showme", type: "button" }, "show me →");
      btn.addEventListener("click", () => locateCaveat(caveat));
      card.appendChild(btn);
      headline.appendChild(card);
    });
  }

  function locateCaveat(caveat) {
    if (caveat.startsWith("coverage gap")) {
      setRailExpanded(true);
      const ghost = railRegion.querySelector(".tsr-node.ghost");
      if (ghost) ghost.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      railRegion.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (caveat.startsWith("unrecognized signing key")) {
      const receipts = current.result?.receipts || [];
      if (receipts.length) openInspector(receipts.length - 1);
      return;
    }
    if (caveat.startsWith("totals drift")) {
      const stage = /totals drift at ([^:]+):/.exec(caveat)?.[1];
      const receipts = current.result?.receipts || [];
      const i = receipts.findIndex((rr) => stageNameOf(rr) === stage);
      if (i !== -1) {
        const up = totalsOf(receipts[i - 1] || receipts[i]);
        const down = totalsOf(receipts[i]);
        const col = [...changedColumns(up, down)][0];
        if (col && scrollToColumn(col)) return;
      }
    }
    // Fallback: the rail locates most caveats.
    setRailExpanded(true);
    railRegion.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // --- region 3: provenance rail ---
  function setRailExpanded(expanded) {
    railExpanded = expanded;
    railExpandedExplicit = true;
    renderRail();
  }

  function renderRail() {
    railRegion.textContent = "";
    const r = current.result;
    if (!r || r.state === "unverifiable" || !r.receipts?.length) return; // nothing was walked

    const gaps = gapPositions(r);
    const lr = r.linkResult;
    // Signatures were actually checked only when verification got past the
    // receipt-hash gate: green/yellow always; red only for a link break or an
    // explicit signature failure. A receipt-file-mismatch red returns before
    // the signature pass, so its receipts must not wear a ✓ they never earned.
    const sigChecked =
      r.state === "green" || r.state === "yellow" ||
      (r.state === "red" && ((lr && lr.ok === false) || r.reason === "signature invalid"));
    const sigOk = sigChecked && r.signaturesValid;

    if (!railExpandedExplicit) {
      // Default prominence per verdict: red-broken opens the topology; the
      // table preset keeps chips at every other verdict; green/grey stay quiet.
      railExpanded = r.state === "red" && lr && lr.ok === false;
      if (preset === "console") railExpanded = true;
    }

    if (!railExpanded) {
      const chips = el("div", { className: "tsr-chips" });
      r.receipts.forEach((receipt, i) => {
        if (i > 0) chips.appendChild(el("span", { className: "arrow" }, "→"));
        const chip = el("button", { className: "tsr-chip", type: "button" }, [
          stageNameOf(receipt),
          sigOk ? el("span", { className: "ok" }, " ✓") : " ?",
        ]);
        chip.addEventListener("click", () => openInspector(i));
        chips.appendChild(chip);
        if (gaps.has(i)) {
          chips.appendChild(el("span", { className: "arrow" }, "→"));
          chips.appendChild(el("span", { className: "tsr-chip gap" }, "?"));
        }
      });
      chips.appendChild(
        el("span", {}, ` · ${r.receipts.length} receipt${r.receipts.length === 1 ? "" : "s"}`)
      );
      const expand = el("button", { className: "tsr-expand", type: "button" }, "expand chain");
      expand.addEventListener("click", () => setRailExpanded(true));
      chips.appendChild(expand);
      railRegion.appendChild(chips);
      return;
    }

    const collapse = el("button", { className: "tsr-expand", type: "button" }, "collapse chain");
    collapse.addEventListener("click", () => setRailExpanded(false));
    railRegion.appendChild(collapse);

    const rail = el("div", { className: "tsr-rail" });
    r.receipts.forEach((receipt, i) => {
      if (i > 0) {
        // The severed-link grammar appears ONLY on a hash-mismatch break;
        // red-stale renders the intact chain honestly, all green.
        const broken = r.state === "red" && lr && lr.ok === false && lr.brokenAt === i;
        rail.appendChild(el("div", { className: `tsr-link${broken ? " broken" : ""}` }, [
          el("span", { className: "l-line" }, broken ? "──✗⚡✗──" : "───▶"),
          el("span", { className: "l-hash" },
            broken ? "link severed" : `carries ${SHORT(inputHashOf(receipt))}`),
        ]));
      }
      const totals = totalsOf(receipt);
      const card = el("div", { className: "tsr-node" }, [
        el("div", { className: "n-kind" }, receipt.kind === "source_manifest" ? "source" : "transform"),
        el("div", { className: "n-name" }, stageNameOf(receipt)),
        el("div", { className: "n-row" }, [
          "out ", el("span", { className: "hash" }, SHORT(outputHashOf(receipt))),
        ]),
        el("div", { className: "n-row" }, [
          `rows ${totals.row_count ?? "?"} · sig `,
          sigOk ? el("span", { className: "ok" }, "✓") : "?",
        ]),
      ]);
      card.dataset.receiptIndex = String(i);
      card.addEventListener("click", () => openInspector(i));
      rail.appendChild(card);

      if (gaps.has(i)) {
        rail.appendChild(el("div", { className: "tsr-link gap" }, [
          el("span", { className: "l-line" }, "┄┄?┄┄"),
          el("span", { className: "l-hash" }, "coverage gap"),
        ]));
        rail.appendChild(el("div", { className: "tsr-node ghost" }, [
          el("div", { className: "n-kind" }, "missing"),
          el("div", { className: "n-name" }, "no receipt emitted"),
          el("div", { className: "n-row" }, gaps.get(i)),
        ]));
      }
    });
    const wrap = el("div", { className: "tsr-rail-wrap" }, [rail]);
    railRegion.appendChild(wrap);

    if (r.state === "red" && lr && lr.ok === false) {
      const severed = rail.querySelector(".tsr-link.broken");
      if (severed && firstRender) {
        severed.scrollIntoView({ block: "nearest", inline: "center" });
      }
    }
  }

  // --- region 4: table plane ---
  function scrollToColumn(name) {
    const th = tableRegion.querySelector(`th[data-col="${CSS.escape(name)}"]`);
    if (!th) return false;
    th.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    return true;
  }

  function renderTablePlane() {
    tableRegion.textContent = "";
    const r = current.result;
    const state = displayState();
    const doc = current.doc;

    if (!doc) {
      if (current.tableState === "missing") {
        // Absence is not tampering (grey, not red) and not a chain caveat
        // (not amber): the chain verdict stands and only this plane is empty.
        tableRegion.appendChild(el("div", { className: "tsr-noshown" }, [
          "NO ATTESTED TABLE PUBLISHED — run: ",
          el("code", {}, "receipts export receipts/chain.json --data <file>"),
          " (or ", el("code", {}, "tamper-signal export"), ") after the pipeline, ",
          "then this plane fills with the attested rows.",
        ]));
      }
      root.dataset.trust = "true";
      return;
    }

    const chainRed = r && r.state === "red";
    const trusted = current.attested && r && (r.state === "green" || r.state === "yellow");
    root.dataset.trust = String(Boolean(trusted || r?.state === "unverifiable"));

    const flagged = chainRed
      ? changedColumns(
          totalsOf(r.receipts[r.linkResult?.brokenAt - 1] || {}),
          totalsOf(r.receipts[r.linkResult?.brokenAt] || {})
        )
      : new Set();
    const unverifiedCols = r && r.state === "yellow" ? gapDerivedColumns(r) : new Set();

    tableRegion.appendChild(el("p", { className: "tsr-table-note" },
      "CONTROL TOTALS · SIGNED — computed over the full verified set, not visible rows"));

    const wrap = el("div", { className: "tsr-dim-wrap" });
    if (r?.state === "unverifiable") {
      wrap.appendChild(el("div", { className: "tsr-shownote" },
        "shown, not verified — the room could not check this chain"));
    }
    wrap.appendChild(el("div", { className: "tsr-dim-note" }, "rendered for reference — not trustworthy as shown"));

    const scroll = el("div", { className: "tsr-scroll" });
    const head = el("tr", {}, doc.headers.map((h) => {
      const th = el("th", { className: flagged.has(h) ? "flag" : "" }, [
        flagged.has(h) ? `⚠ ${h}` : h,
        unverifiedCols.has(h) ? el("span", { className: "untag" }, "UNVERIFIED") : null,
      ]);
      th.dataset.col = h;
      return th;
    }));

    // Pinned signed control totals, from the final receipt (never recomputed
    // from visible rows).
    const finalTotals = r && r.receipts?.length ? totalsOf(r.receipts[r.receipts.length - 1]) : null;
    const totalsRow = finalTotals
      ? el("tr", { className: "totals" }, doc.headers.map((h, i) => {
          const sum = (finalTotals.numeric_sums || {})[h];
          if (i === 0 && sum === undefined) {
            return el("td", {}, `Σ signed · rows ${finalTotals.row_count ?? "?"}`);
          }
          return el("td", {}, sum !== undefined ? String(sum) : "");
        }))
      : null;

    const limit = showAll ? doc.rows.length : Math.min(maxRows, doc.rows.length);
    const body = doc.rows.slice(0, limit).map((row) =>
      el("tr", {}, row.map((cell, i) => {
        const cls = [
          cell === null ? "null" : "",
          flagged.has(doc.headers[i]) ? "flagcol" : "",
        ].join(" ").trim();
        return el("td", { className: cls }, cell === null ? "null" : String(cell));
      }))
    );
    scroll.appendChild(el("table", { className: "tsr-data" }, [
      el("thead", {}, head),
      el("tbody", {}, [totalsRow, ...body]),
    ]));
    wrap.appendChild(scroll);
    tableRegion.appendChild(wrap);

    const footRow = el("div", { className: "tsr-table-foot" }, [
      el("span", {}, `${limit.toLocaleString()} of ${doc.rows.length.toLocaleString()} rows`),
    ]);
    if (!showAll && doc.rows.length > maxRows) {
      const btn = el("button", { type: "button" }, "show all");
      btn.addEventListener("click", () => {
        showAll = true;
        renderTablePlane();
      });
      footRow.appendChild(btn);
    }
    footRow.appendChild(el("span", {},
      current.tableHash ? `sha ${SHORT(current.tableHash)}` : ""));
    tableRegion.appendChild(footRow);
  }

  // --- region 5a: receipt inspector ---
  function openInspector(index) {
    const receipts = current.result?.receipts || [];
    const receipt = receipts[index];
    if (!receipt) return;
    if (activeNode) activeNode.classList.remove("active");
    activeNode = railRegion.querySelector(`.tsr-node[data-receipt-index="${index}"]`);
    if (activeNode) activeNode.classList.add("active");

    inspectBody.textContent = "";
    const totals = totalsOf(receipt);
    const kv = (label, value) => el("div", { className: "kv" }, [el("b", {}, label), el("span", {}, value)]);
    inspectBody.append(
      el("div", { className: "kv" }, [
        el("b", {}, "stage"),
        el("span", {}, [stageNameOf(receipt), " ", el("span", { className: "hash" }, SHORT(outputHashOf(receipt)))]),
      ]),
      kv("kind", receipt.kind ?? "?"),
      kv("created", receipt.created_at ?? "?"),
      kv("rows out", String(totals.row_count ?? "?")),
    );
    if (receipt.kind === "transform_receipt") {
      inspectBody.append(
        kv("code file", receipt.transform?.code_file ?? "?"),
        kv("code hash", SHORT(receipt.transform?.code_hash)),
      );
    }
    if (receipt.signature?.key_fingerprint) {
      inspectBody.append(kv("signed by", receipt.signature.key_fingerprint));
    }
    inspectBody.append(
      el("details", {}, [
        el("summary", {}, "raw receipt JSON"),
        el("pre", {}, JSON.stringify(receipt, null, 2)),
      ])
    );
    inspectDrawer.open = true;
    inspectDrawer.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // --- region 5b: event log ---
  function appendLog(result, durationMs) {
    const stamp = (result.verifiedAt ?? new Date().toISOString()).slice(11, 19);
    const entry = el("div", { className: "entry" });
    const headLine = `${stamp}Z $ verify (${durationMs}ms)\n`;
    entry.appendChild(el("span", { className: "t-faint" }, headLine));
    let text = headLine;
    for (const [cls, line] of cliLines(result)) {
      entry.appendChild(el("span", { className: cls }, line + "\n"));
      text += line + "\n";
    }
    logEntries.prepend(entry);
    transcript.unshift(text);
  }

  // --- region 5c: chain of custody (additive, never feeds the verdict) ---
  async function renderCustody(result) {
    custodyBody.textContent = "";
    if (result.state === "unverifiable" || !result.chain) {
      custodyBody.appendChild(el("span", { className: "hint" }, "No verified chain to bind a timeline to."));
      return;
    }
    let timeline;
    try {
      const resp = await fetch(timelineUrl, { cache: "no-store" });
      if (!resp.ok) {
        custodyBody.appendChild(el("span", { className: "hint" }, "No timeline.json published beside this chain."));
        return; // no timeline published; nothing to show, verdict unaffected
      }
      timeline = await resp.json();
    } catch {
      custodyBody.appendChild(el("span", { className: "hint" }, "No timeline.json published beside this chain."));
      return; // timeline is optional; its absence is not a verdict signal
    }
    if (destroyed) return;
    const files = result.chain.receipts || [];
    const tail = files.length ? (result.chain.receipt_hashes || {})[files[files.length - 1]] : "";
    // Treat absent/empty the same on both sides so legacy chains that record no
    // receipt_hashes (tail undefined, timeline chain_tail "") are not falsely
    // flagged as mismatched.
    if (!timeline || timeline.kind !== "timeline" || (timeline.chain_tail || "") !== (tail || "")) {
      custodyBody.appendChild(
        el("div", { className: "tsr-custody-warn" }, "⚠ timeline.json does not match this chain; not shown")
      );
      return;
    }
    // The chain_tail binding proves the timeline belongs to this chain; the
    // signature proves its bytes (including annotation reasons/authors) are
    // unaltered. A signed-but-invalid timeline is tampered, so reject it. An
    // unsigned timeline's structure is chain-derived and safe to show, but its
    // annotation text is not verifiable, so it is withheld rather than rendered
    // as authoritative provenance.
    let signed = false;
    if (timeline.signature && result.chain.public_key) {
      try {
        signed = await verifySignature(timeline, result.chain.public_key);
      } catch {
        signed = false;
      }
    }
    if (destroyed) return;
    if (timeline.signature && !signed) {
      custodyBody.appendChild(
        el("div", { className: "tsr-custody-warn" }, "⚠ timeline.json signature does not verify; not shown")
      );
      return;
    }
    const entries = timeline.entries || [];
    const pending = timeline.pending || [];
    // Counts live only here, inside the opened drawer — never in a collapsed
    // header or the verdict strip.
    custodyBody.appendChild(el("div", { className: "tsr-custody-count" },
      `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` +
      (pending.length ? ` · ${pending.length} awaiting review` : "")));
    const list = el("div", { className: "tsr-custody-list" });
    for (const entry of entries) {
      const isImport = entry.kind === "import";
      list.appendChild(el("div", { className: "c-row" }, [
        el("span", { className: "c-mark" }, isImport ? "⬚ import" : "▶ change"),
        el("span", { className: "c-stage" }, entry.stage || "?"),
        el("span", { className: "c-meta" },
          isImport
            ? `origin: ${entry.origin || "(none)"}`
            : `Δrows ${entry.row_delta ?? "?"} · code ${SHORT(entry.code_hash)}`),
        el("span", { className: "c-when" }, (entry.created_at || "").slice(0, 19)),
      ]));
      const annotations = entry.annotations || [];
      if (!signed && annotations.length) {
        list.appendChild(el("div", { className: "c-ann" }, [
          el("span", { className: "c-author" }, "(annotations hidden: timeline.json is unsigned)"),
        ]));
        continue;
      }
      for (const ann of annotations) {
        list.appendChild(el("div", { className: `c-ann${ann.superseded ? " c-superseded" : ""}` }, [
          el("span", { className: "c-reason" }, "💬 " + (ann.reason || "")),
          ann.author
            ? el("span", { className: "c-author" }, `self-declared author: ${ann.author} (unverified)`)
            : null,
          ann.superseded ? el("span", { className: "c-author" }, "(superseded)") : null,
        ]));
      }
    }
    custodyBody.appendChild(list);

    // Withheld watch changes awaiting human review. ADDITIVE, like the rest of
    // this layer: it never feeds the verdict. The summary is sanitized server
    // side (source id, when, a caveat COUNT, the event hash) — no candidate
    // data or value-bearing caveat text leaks to a remote viewer.
    if (pending.length) {
      custodyBody.appendChild(
        el("div", { className: "tsr-custody-head2" }, "Awaiting review · withheld changes")
      );
      const plist = el("div", { className: "tsr-custody-list" });
      for (const p of pending) {
        plist.appendChild(el("div", { className: "c-row" }, [
          el("span", { className: "c-mark c-pending" }, "⏸ pending"),
          el("span", { className: "c-stage" }, p.source_id || "?"),
          el("span", { className: "c-meta" },
            `${p.caveat_count || 0} caveat(s) · needs a signed human reason`),
          el("span", { className: "c-when" }, (p.created_at || "").slice(0, 19)),
        ]));
      }
      custodyBody.appendChild(plist);
    }
  }

  // --- region 6: footer / export ---
  function renderExport() {
    exportBar.textContent = "";
    const r = current.result;
    const state = displayState();
    taglineSlot.textContent = state === "green" ? VOCAB.directives.green : "";
    const doc = current.doc;
    const chainBroken = r && r.state === "red";

    if (!r || (!doc && !chainBroken)) {
      exportBar.appendChild(el("span", { className: "xnote" },
        doc ? "Export unavailable: verification did not complete." :
          "Export unavailable: no attested table published."));
      return;
    }

    const bundleOk = current.attested && (r.state === "green" || r.state === "yellow");
    const evidenceMode = chainBroken;
    const typeName = `tsr-xtype-${uid}`;
    const bundleRadio = el("input", {
      type: "radio",
      name: typeName,
      value: "bundle",
      checked: bundleOk || evidenceMode,
      disabled: !bundleOk && !evidenceMode,
    });
    const rowsRadio = el("input", {
      type: "radio",
      name: typeName,
      value: "rows",
      checked: !bundleOk && !evidenceMode,
      disabled: !doc,
    });
    const timelineBox = el("input", { type: "checkbox" });
    const transcriptBox = el("input", { type: "checkbox" });
    const fmt = el("select", {}, Object.keys(EXPORT_EXT).map((f) => el("option", { value: f }, f)));
    const btn = el("button", { type: "button" }, "Download");
    const note = el("div", { className: "xnote" });

    exportBar.append(
      el("span", { className: "xlabel" }, "Take your data"),
      el("label", {}, [bundleRadio, evidenceMode ? "Evidence bundle" : "Verified bundle"]),
      el("label", {}, [rowsRadio, "Rows only"]),
      el("label", {}, [timelineBox, "include timeline.json"]),
      el("label", {}, [transcriptBox, "include verification transcript"]),
      fmt,
      btn,
      note,
    );

    function updateNote() {
      note.className = "xnote";
      if (rowsRadio.checked) {
        note.textContent = "Rows only: no chain or receipts. A recipient can't verify this file.";
      } else if (evidenceMode) {
        note.className = "xnote warn";
        note.textContent =
          "Evidence bundle: chain.json + receipts + the verification transcript, to send to your analyst. " +
          "A recipient will see the red light at the same link.";
      } else if (r.state === "yellow") {
        note.className = "xnote warn";
        note.textContent = "The chain has caveats; a recipient will see a yellow light.";
      } else if (!bundleOk) {
        note.className = "xnote warn";
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
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Preparing…";
      try {
        if (rowsOnly) {
          if (!doc) throw new Error("no table document");
          triggerDownload(`data-rows-only.${ext}`,
            new TextEncoder().encode(serializeDoc(doc, fmt.value)), "application/octet-stream");
        } else {
          const base = new URL(chainUrl, window.location.href);
          const chainBytes = new Uint8Array(await (await fetch(base)).arrayBuffer());
          const chainDoc = JSON.parse(new TextDecoder().decode(chainBytes));
          const entries = [
            { name: "README.md", bytes: new TextEncoder().encode(evidenceMode ? EVIDENCE_README : BUNDLE_README) },
            { name: "chain.json", bytes: chainBytes },
          ];
          if (!evidenceMode && doc) {
            entries.splice(1, 0, {
              name: `data.${ext}`,
              bytes: new TextEncoder().encode(serializeDoc(doc, fmt.value)),
            });
          }
          for (const name of chainDoc.receipts || []) {
            const bytes = new Uint8Array(await (await fetch(new URL(name, base))).arrayBuffer());
            entries.push({ name, bytes });
          }
          if (timelineBox.checked) {
            try {
              const resp = await fetch(timelineUrl, { cache: "no-store" });
              if (resp.ok) entries.push({ name: "timeline.json", bytes: new Uint8Array(await resp.arrayBuffer()) });
            } catch { /* optional layer: skip silently */ }
          }
          if (transcriptBox.checked || evidenceMode) {
            entries.push({
              name: "verification-transcript.txt",
              bytes: new TextEncoder().encode(transcript.join("\n")),
            });
          }
          triggerDownload(evidenceMode ? "evidence-bundle.zip" : "data-verified.zip",
            makeStoredZip(entries), "application/zip");
        }
      } catch (_e) {
        note.className = "xnote warn";
        note.textContent = "Could not build the download. Try again.";
      } finally {
        btn.textContent = label;
        btn.disabled = false;
      }
    });
  }

  // --- open(): scroll/expand hints, verdict-gated by the caller ---
  function open(target) {
    const state = displayState();
    if (target === "break") {
      if (state !== "red") return false; // a #break hash on a green chain is ignored
      const card = headline.querySelector("#tsr-break");
      if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
      return Boolean(card);
    }
    if (target === "rail") {
      setRailExpanded(true);
      const severed = railRegion.querySelector(".tsr-link.broken");
      (severed || railRegion).scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    }
    if (target === "custody") {
      custodyDrawer.open = true;
      custodyDrawer.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return true;
    }
    if (target === "log") {
      logDrawer.open = true;
      logDrawer.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return true;
    }
    if (target === "auto") {
      if (state === "red") return open("break");
      if (state === "red-stale") {
        const band = headline.querySelector("#tsr-stale");
        if (band) band.scrollIntoView({ block: "start", behavior: "smooth" });
        return Boolean(band);
      }
      if (state === "yellow") {
        const card = headline.querySelector("#tsr-caveat-0");
        if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
        return Boolean(card);
      }
      return false; // green/grey: nothing demands attention
    }
    const [kind, arg] = String(target).split(":", 2);
    if (kind === "inspector" && arg !== undefined) {
      const receipts = current.result?.receipts || [];
      const index = /^\d+$/.test(arg)
        ? Number(arg)
        : receipts.findIndex((rr) => stageNameOf(rr) === arg);
      if (index >= 0 && index < receipts.length) {
        openInspector(index);
        return true;
      }
      return false;
    }
    if (kind === "caveat" && arg !== undefined) {
      if (state !== "yellow") return false;
      const card = headline.querySelector(`#tsr-caveat-${CSS.escape(arg)}`);
      if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
      return Boolean(card);
    }
    if (kind === "column" && arg !== undefined) {
      return scrollToColumn(arg);
    }
    return false;
  }

  // Deep links are hints only, page density only, and honored only when this
  // document's own fresh verification agrees with the state they imply. The
  // values are matched against rendered ids/receipts — never injected as HTML.
  function applyDeepLink() {
    let target = opts.focus || null;
    if (density === "page" && !target) {
      try {
        const hash = decodeURIComponent(window.location.hash.slice(1));
        if (hash) {
          target = hash.includes("=") ? hash.replace("=", ":") : hash;
        } else if (new URLSearchParams(window.location.search).get("focus") === "auto") {
          target = "auto";
        }
      } catch (_e) {
        target = null;
      }
    }
    if (target) open(target);
  }

  // --- the verification loop ---
  async function runVerify({ bustMemo } = {}) {
    if (bustMemo) invalidateVerification(chainUrl);
    const started = performance.now();
    const result = await verifyReceipts(chainUrl, pubKeyHex, { warnDrift: opts.warnDrift });
    const durationMs = Math.round(performance.now() - started);
    if (destroyed) return result;

    // Fetch and attest the published table (independent of the chain verdict:
    // the room renders the honest combination of both).
    let doc = null;
    let tableState = "missing";
    let tableHash = null;
    try {
      const fetched = await fetch(resolvedTableUrl());
      if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
      doc = await fetched.json();
      if (!Array.isArray(doc.headers) || !Array.isArray(doc.rows)) throw new Error("not a table document");
    } catch (_e) {
      doc = null;
    }
    if (destroyed) return result;

    let attested = false;
    if (doc && (result.state === "green" || result.state === "yellow") && result.receipts?.length) {
      // Attestation only means something against a chain that verifies: a
      // byte-match to the tail of a broken chain is a hollow claim, so at red
      // the emitted attested is always false.
      try {
        tableHash = await sha256Hex(
          new TextEncoder().encode(canonicalize({ headers: doc.headers, rows: doc.rows }))
        );
        const finalReceipt = result.receipts[result.receipts.length - 1];
        attested = tableHash === outputHashOf(finalReceipt);
        tableState = attested ? "attested" : "stale";
      } catch (_e) {
        tableState = "unhashable";
      }
    } else if (doc) {
      tableState = "unverified"; // rows loaded but nothing sound to attest them against
    }
    if (destroyed) return result;

    current = { result, doc, attested, tableState, tableHash };

    renderStrip();
    renderHeadline();
    renderRail();
    renderTablePlane();
    appendLog(result, durationMs);
    renderExport();
    emitState();
    // Additive layer, after the verdict has already rendered from chain.json.
    renderCustody(result);

    if (firstRender) {
      firstRender = false;
      applyDeepLink();
    }
    return result;
  }

  const uid = (mountSignalRoom._seq = (mountSignalRoom._seq || 0) + 1);

  reverify.addEventListener("click", () => runVerify({ bustMemo: true }));
  const ready = runVerify();
  if (opts.watch) {
    // Watch ticks use the shared memo (TTL 250ms < the 1000ms floor, so every
    // tick is a fresh run) and, per the no-yank rule, never scroll or focus.
    timer = setInterval(() => runVerify(), Math.max(1000, Number(opts.watch) || 0));
  }

  return {
    el: root,
    ready,
    refresh: () => runVerify({ bustMemo: true }),
    getState: () => displayState(),
    open,
    destroy() {
      destroyed = true;
      if (timer) clearInterval(timer);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

// ---------------------------------------------------------------------------
// <tamper-signal-room>: the room as a custom element, the parallel of
// <tamper-signal> for the light. Importing this module registers the element,
// so one tag works in plain HTML, React (via JSX, see room.d.ts), Vue,
// Svelte, Angular, or anything else that renders DOM.
//
//   <script type="module" src="/badge/room.js"></script>
//   <tamper-signal-room chain="/receipts/chain.json"></tamper-signal-room>
//
// Attributes (all but `chain` optional):
//   chain       URL of chain.json (required; nothing mounts without it)
//   table       URL of table.json (defaults to table.json beside the chain)
//   timeline    URL of timeline.json (defaults to timeline.json beside chain)
//   pub-key     trusted public key hex (space or comma separated for rotation)
//   watch       re-verify every N milliseconds (min 1000)
//   warn-drift  present = flag control-totals movement across links
//   strict      present = emit state with strict:true for host gating
//   max-rows    rows rendered before "show all" (default 500)
//   focus       deep-link target applied after first render
//   preset      room | table | console
//   density     embedded (default) | page
// ---------------------------------------------------------------------------

const ROOM_ATTRS = [
  "chain", "table", "timeline", "pub-key", "watch", "warn-drift",
  "strict", "max-rows", "focus", "preset", "density",
];

// SSR/Node safety: the element class only means anything where HTMLElement
// exists; elsewhere the module must still import (mountSignalRoom works with
// any DOM-alike the host provides).
const RoomBase = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

class TamperSignalRoomElement extends RoomBase {
  static get observedAttributes() {
    return ROOM_ATTRS;
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

  // The mount handle, for hosts that want refresh()/open()/getState().
  get room() {
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
    const pubKeyAttr = this.getAttribute("pub-key");
    const pubKey = pubKeyAttr ? pubKeyAttr.split(/[\s,]+/).filter(Boolean) : undefined;
    const watch = Number(this.getAttribute("watch"));
    const maxRows = Number(this.getAttribute("max-rows"));
    this._handle = mountSignalRoom(this, chain, pubKey, {
      tableUrl: this.getAttribute("table") || undefined,
      timelineUrl: this.getAttribute("timeline") || undefined,
      watch: Number.isFinite(watch) && watch > 0 ? watch : undefined,
      warnDrift: this.hasAttribute("warn-drift"),
      strict: this.hasAttribute("strict"),
      maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : undefined,
      focus: this.getAttribute("focus") || undefined,
      preset: this.getAttribute("preset") || undefined,
      density: this.getAttribute("density") || undefined,
    });
  }
}

if (typeof customElements !== "undefined" && !customElements.get("tamper-signal-room")) {
  customElements.define("tamper-signal-room", TamperSignalRoomElement);
}

export { TamperSignalRoomElement };
