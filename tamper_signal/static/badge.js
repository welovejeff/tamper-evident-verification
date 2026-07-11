// Tamper Signal: the standalone receipt verification badge. No build step,
// no framework.
//
// This file is also the browser verification core for the inline status light
// (light.js): verifyReceipts(chainUrl, pubKeyHex) runs the whole pipeline
// (fetch, signatures, hash links, caveats) and returns a structured result;
// the render layers differ.
//
// renderReceiptBadge(containerEl, chainUrl, pubKeyHex)
//   Fetches chain.json and every receipt, re-verifies all signatures with Web
//   Crypto Ed25519, re-checks all hash links (receipt N input == receipt N-1
//   output), and renders a collapsed green/yellow/red badge that expands to
//   per-stage detail. Yellow means the chain verifies, with caveats (coverage
//   gap in the receipt numbering, or signatures that only verify under the
//   chain's embedded key rather than the caller-supplied trusted key). The
//   separate amber state ("could not load" / "unsupported browser") is a
//   capability fallback, not a verdict: it says nothing about the chain.
//   The browser does NOT re-canonicalize xlsx; it only re-links hashes.
//
// pubKeyHex is optional; when omitted the key embedded in chain.json is used.

export const SHORT = (h) => (h && h.length > 10 ? `${h.slice(0, 4)}...${h.slice(-2)}` : h || "(none)");

// --- The canonical verdict vocabulary, shared by every surface. ---
// words/verdicts are copied VERBATIM from light.js (WORDS/VERDICTS, which stays
// byte-untouched); node/test/vocab.test.js asserts the two literal tables never
// drift. redStale is the room's verdict for a table.json that no longer hashes
// to the final receipt (the chain itself verifies). Directives are the one
// plain sentence each verdict earns in the room's strip.
export const VOCAB = {
  words: {
    checking: "CHECKING",
    green: "VERIFIED",
    yellow: "CAVEAT",
    red: "BROKEN",
    unverifiable: "UNVERIFIED",
  },
  verdicts: {
    checking: "VERIFYING",
    green: "CHAIN VERIFIED",
    yellow: "VERIFIABLE WITH CAVEATS",
    red: "CHAIN BROKEN",
    unverifiable: "COULD NOT VERIFY",
  },
  redStale: "NOT THE ATTESTED DATA",
  directives: {
    checking: "Re-verifying in your browser.",
    green: "The light is green, the data is clean.",
    yellow: "Verifies, with caveats. A human should look.",
    red: "Do not present numbers fed by this pipeline.",
    redStale: "Treat these rows as unattested until the export re-runs.",
    unverifiable: "This says nothing about the data either way.",
  },
  caveatJoiner: " · ",
};

// --- The dark-instrument palette, declared once. ---
// Every surface consumes these as CSS custom properties (the room injects them
// under --ts-*); the hex values match the private --lr-* block in light.js,
// which stays byte-untouched.
export const TOKENS =
  "--ts-bg:#0b0f14;--ts-panel:#11161d;--ts-border:#1f2937;--ts-chrome:#161d26;" +
  "--ts-text:#e5e7eb;--ts-dim:#8b98a5;--ts-faint:#3d4854;--ts-row:#18202b;" +
  "--ts-green:#34d399;--ts-red:#f87171;--ts-amber:#fbbf24;--ts-cyan:#67e8f9";

// Host-page columns whose totals moved between two stages' control totals.
// Row/column count changes have no single column to point at, so only
// numeric_sums and null_counts participate. Single source for the diff that
// light.js (changedColumns) and the old table.js (brokenColumns) each carried
// privately; light.js keeps its untouched copy.
export function changedColumns(up, down) {
  const cols = new Set();
  for (const key of ["numeric_sums", "null_counts"]) {
    const a = (up || {})[key] || {};
    const b = (down || {})[key] || {};
    for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[c] !== b[c]) cols.add(c);
    }
  }
  return cols;
}

// --- Canonical JSON, byte-identical to tamper_signal/canonical.py's JCS output. ---
// Leaves are strings, integers, booleans, or null (no floats). Object keys are
// sorted; strings use JSON.stringify, whose escaping matches the Python side.
export function canonicalize(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    // Python's JCS only serializes integers (floats/NaN/Infinity raise). Match
    // that so the badge never shows green for a receipt Python would refuse.
    if (!Number.isSafeInteger(value)) throw new Error("non-integer number leaf");
    return String(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
  }
  throw new Error("cannot canonicalize " + t);
}

function receiptBody(receipt) {
  const body = {};
  for (const k of Object.keys(receipt)) if (k !== "signature") body[k] = receipt[k];
  return body;
}

function hexToBytes(hex) {
  // Reject malformed hex (odd length / non-hex chars) so the browser fails
  // closed exactly like Python's bytes.fromhex, instead of silently coercing
  // NaN to 0 and accepting a signature/key that Python would reject.
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// --- Hash accessors mirroring tamper_signal/receipts.py. ---
export const outputHashOf = (r) =>
  r.kind === "source_manifest" ? r.semantic_hash : r.output_semantic_hash;
export const inputHashOf = (r) => (r.kind === "source_manifest" ? null : r.input_semantic_hash);
export const totalsOf = (r) =>
  r.kind === "source_manifest" ? r.control_totals : r.output_control_totals;
export const stageNameOf = (r) => (r.kind === "source_manifest" ? "source" : r.transform.name);

// --- Totals delta, mirroring tamper_signal/totals.py for the red expand. Reports
// row_count, column_count, numeric_sums and null_counts, with sorted (so
// deterministic) column ordering to stay consistent with the CLI verifier. The
// numeric diff is shown as before -> after (no Decimal arithmetic in-browser).
const sortedUnion = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

export function totalsDelta(up, down) {
  const lines = [];
  if (up.row_count !== down.row_count) {
    const d = down.row_count - up.row_count;
    lines.push(`row_count ${up.row_count} -> ${down.row_count} (${d >= 0 ? "+" : ""}${d})`);
  }
  if (up.column_count !== down.column_count) {
    const d = down.column_count - up.column_count;
    lines.push(`column_count ${up.column_count} -> ${down.column_count} (${d >= 0 ? "+" : ""}${d})`);
  }
  const us = up.numeric_sums || {};
  const ds = down.numeric_sums || {};
  for (const col of sortedUnion(us, ds)) {
    if (us[col] !== ds[col]) lines.push(`${col} ${us[col] ?? "(added)"} -> ${ds[col] ?? "(removed)"}`);
  }
  const un = up.null_counts || {};
  const dn = down.null_counts || {};
  for (const col of sortedUnion(un, dn)) {
    const before = un[col] ?? 0;
    const after = dn[col] ?? 0;
    if (before !== after) {
      const d = after - before;
      lines.push(`null_counts[${col}] ${before} -> ${after} (${d >= 0 ? "+" : ""}${d})`);
    }
  }
  return lines;
}

export async function ed25519Available() {
  if (!window.crypto || !crypto.subtle) return false;
  try {
    await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "Ed25519" }, false, [
      "verify",
    ]);
    return true;
  } catch (_e) {
    return false;
  }
}

export async function verifySignature(receipt, pubKeyHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(pubKeyHex),
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const message = new TextEncoder().encode(canonicalize(receiptBody(receipt)));
  const sig = hexToBytes(receipt.signature.value);
  return crypto.subtle.verify({ name: "Ed25519" }, key, sig, message);
}

// chain.receipts is attacker-controlled, so receipt names are restricted to a
// bare filename next to chain.json (matching how they are generated and the
// Python read_receipt guard). This blocks absolute URLs and ../ traversal that
// could make the viewer's browser fetch arbitrary / cross-origin resources.
const SAFE_RECEIPT_NAME = /^[A-Za-z0-9._-]+$/;

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadChain(chainUrl) {
  const base = new URL(chainUrl, window.location.href);
  const chain = await (await fetch(base)).json();
  // Newer chains record each receipt file's sha256; enforcing it here mirrors
  // the CLI verifiers, so an anchored chain.json transitively witnesses the
  // receipt contents. Older chains (no receipt_hashes) skip the check.
  const recorded =
    chain.receipt_hashes && typeof chain.receipt_hashes === "object" ? chain.receipt_hashes : null;
  const canHash = Boolean(recorded && globalThis.crypto && crypto.subtle);
  const receipts = [];
  const receiptMismatches = [];
  for (const name of chain.receipts || []) {
    if (typeof name !== "string" || !SAFE_RECEIPT_NAME.test(name)) {
      throw new Error("unsafe receipt name in chain: " + name);
    }
    const url = new URL(name, base);
    // Fetch raw bytes so the receipt hashes exactly as it sits on disk, then
    // parse the same bytes.
    const buf = await (await fetch(url)).arrayBuffer();
    if (canHash && (await sha256Hex(buf)) !== recorded[name]) receiptMismatches.push(name);
    receipts.push(JSON.parse(new TextDecoder().decode(buf)));
  }
  return { chain, receipts, receiptMismatches };
}

// Gaps in the generated NNN_ receipt numbering, mirroring tamper_signal/receipts.py's
// _coverage_gaps. Hand-named receipt sets (no numeric prefix) opt out.
export function coverageGaps(receiptNames) {
  const indices = [];
  for (const name of receiptNames) {
    const prefix = String(name).split("_", 1)[0];
    if (!/^[0-9]{3}$/.test(prefix)) return [];
    indices.push(parseInt(prefix, 10));
  }
  const gaps = [];
  if (indices.length && indices[0] !== 0) {
    gaps.push(`chain starts at ${String(indices[0]).padStart(3, "0")}, not 000`);
  }
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) {
      const a = String(indices[i - 1]).padStart(3, "0");
      const b = String(indices[i]).padStart(3, "0");
      gaps.push(`numbering jumps ${a} -> ${b}`);
    }
  }
  return gaps;
}

// Signature pass mirroring tamper_signal/receipts.py: every receipt is checked
// against the trusted key; one that fails there but verifies under the key
// embedded in chain.json means the chain is internally consistent but vouched
// for by a key the caller does not trust (yellow), not broken (red).
export async function checkSignatures(receipts, trustedKeyHex, chainKeyHex) {
  // trustedKeyHex may be a single key or a list (key rotation). This inlines
  // _as_trusted_keys (tamper_signal/receipts.py) / asTrustedKeys
  // (node/receipts.js); update all three in lockstep.
  const trusted = (Array.isArray(trustedKeyHex) ? trustedKeyHex : [trustedKeyHex]).filter(Boolean);
  let valid = true;
  let unrecognized = false;
  const useFallback = chainKeyHex && !trusted.includes(chainKeyHex);
  for (const r of receipts) {
    let ok = false;
    for (const key of trusted) {
      try {
        if (await verifySignature(r, key)) { ok = true; break; }
      } catch (_e) { /* malformed key or signature: try the next */ }
    }
    if (ok) continue;
    if (useFallback) {
      let chainOk = false;
      try {
        chainOk = await verifySignature(r, chainKeyHex);
      } catch (_e) {
        chainOk = false;
      }
      if (chainOk) {
        unrecognized = true;
        continue;
      }
    }
    valid = false;
  }
  return { valid, unrecognized };
}

export function evaluate(receipts) {
  // Returns {ok, brokenAt, brokenStage, delta}. Signatures checked separately.
  for (let i = 1; i < receipts.length; i++) {
    const expected = outputHashOf(receipts[i - 1]);
    const found = inputHashOf(receipts[i]);
    if (found !== expected) {
      return {
        ok: false,
        brokenAt: i,
        brokenStage: stageNameOf(receipts[i]),
        expected,
        found,
        delta: totalsDelta(totalsOf(receipts[i - 1]), totalsOf(receipts[i])),
      };
    }
  }
  return { ok: true };
}

// The whole browser verification pipeline as one call, shared by the badge and
// the inline status light. Returns a structured result:
//
//   state          "green" | "yellow" | "red" | "unverifiable"
//   reason         short human phrase for red / unverifiable states
//   caveats        yellow caveat strings (empty for green)
//   linkResult     evaluate() output ({ok} or {ok:false, brokenAt, ...})
//   signaturesValid, chain, receipts, origin, finalRows, transforms, verifiedAt
//
// "unverifiable" is the capability fallback (fetch failed, no Web Crypto
// Ed25519): it says nothing about the chain and must never be conflated with
// the yellow verdict. opts.warnDrift adds a caveat for any control-totals
// movement across intact links (off by default: filters and aggregations
// legitimately move totals).
//
// Calls coalesce: concurrent calls with the same (chain URL, trusted keyset,
// warnDrift) share one in-flight run, and a completed result is reused for
// 250ms — hard below the 1000ms minimum watch interval — so a light and a room
// on the same page fetch the chain and run Ed25519 once per refresh cycle, not
// twice. Different trusted keysets NEVER share a result. The memo lives only in
// memory; invalidateVerification() busts it synchronously (the room's re-verify
// button calls it so "re-verify" always means a fresh run).
const VERIFY_MEMO_TTL_MS = 250;
const verifyMemo = new Map();

function verifyMemoKey(chainUrl, pubKeyHex, opts) {
  let resolved;
  try {
    resolved = new URL(chainUrl, window.location.href).href;
  } catch (_e) {
    resolved = String(chainUrl);
  }
  const keys = (Array.isArray(pubKeyHex) ? [...pubKeyHex] : [pubKeyHex]).filter(Boolean).sort();
  return `${resolved} ${JSON.stringify(keys)} ${Boolean(opts && opts.warnDrift)}`;
}

export function invalidateVerification(chainUrl) {
  if (chainUrl == null) {
    verifyMemo.clear();
    return;
  }
  let resolved;
  try {
    resolved = new URL(chainUrl, window.location.href).href;
  } catch (_e) {
    resolved = String(chainUrl);
  }
  for (const key of [...verifyMemo.keys()]) {
    if (key.startsWith(resolved + " ")) verifyMemo.delete(key);
  }
}

export function verifyReceipts(chainUrl, pubKeyHex, opts = {}) {
  const key = verifyMemoKey(chainUrl, pubKeyHex, opts);
  const hit = verifyMemo.get(key);
  if (hit && (hit.settledAt === null || Date.now() - hit.settledAt <= VERIFY_MEMO_TTL_MS)) {
    return hit.promise;
  }
  const entry = { promise: null, settledAt: null };
  entry.promise = verifyReceiptsUncached(chainUrl, pubKeyHex, opts).then(
    (result) => {
      entry.settledAt = Date.now();
      return result;
    },
    (err) => {
      // Never memoize a rejection (the pipeline itself resolves "unverifiable"
      // rather than rejecting; this guards unexpected throws).
      if (verifyMemo.get(key) === entry) verifyMemo.delete(key);
      throw err;
    }
  );
  verifyMemo.set(key, entry);
  return entry.promise;
}

async function verifyReceiptsUncached(chainUrl, pubKeyHex, opts = {}) {
  const verifiedAt = new Date().toISOString();
  let chain, receipts, receiptMismatches;
  try {
    ({ chain, receipts, receiptMismatches } = await loadChain(chainUrl));
  } catch (_e) {
    return { state: "unverifiable", reason: "could not load chain", caveats: [], verifiedAt };
  }
  if (!(await ed25519Available())) {
    return {
      state: "unverifiable",
      reason: "verification unsupported in this browser",
      caveats: [],
      chain,
      receipts,
      verifiedAt,
    };
  }

  const summary = {
    chain,
    receipts,
    verifiedAt,
    origin: "source",
    finalRows: undefined,
    transforms: 0,
    signaturesValid: true,
    linkResult: { ok: true },
    caveats: [],
  };
  if (!receipts.length) {
    return { ...summary, state: "red", reason: "chain empty" };
  }
  const source = receipts.find((r) => r.kind === "source_manifest");
  summary.origin = (source && source.source.declared_origin) || "source";
  summary.finalRows = totalsOf(receipts[receipts.length - 1]).row_count;
  summary.transforms = receipts.filter((r) => r.kind === "transform_receipt").length;

  if (receiptMismatches && receiptMismatches.length) {
    return {
      ...summary,
      state: "red",
      reason: `receipt file mismatch at ${receiptMismatches.join(", ")}`,
    };
  }

  const trustedKey = pubKeyHex || chain.public_key;
  const sigResult = await checkSignatures(receipts, trustedKey, chain.public_key);
  summary.signaturesValid = sigResult.valid;
  summary.linkResult = evaluate(receipts);

  if (!sigResult.valid) {
    return { ...summary, state: "red", reason: "signature invalid" };
  }
  if (!summary.linkResult.ok) {
    return {
      ...summary,
      state: "red",
      reason: `chain broken at ${summary.linkResult.brokenStage}`,
    };
  }

  // Chain verifies. Collect yellow caveats; none means green.
  if (sigResult.unrecognized) {
    summary.caveats.push(
      "unrecognized signing key: receipts verify under the chain's embedded key, " +
        "not the key this page trusts"
    );
  }
  for (const gap of coverageGaps(chain.receipts || [])) {
    summary.caveats.push(
      `coverage gap: receipt ${gap}; a stage may have run without leaving a receipt`
    );
  }
  if (opts.warnDrift) {
    for (let i = 1; i < receipts.length; i++) {
      const delta = totalsDelta(totalsOf(receipts[i - 1]), totalsOf(receipts[i]));
      if (delta.length) {
        summary.caveats.push(
          `totals drift at ${stageNameOf(receipts[i])}: ${delta.join(", ")}`
        );
      }
    }
  }
  return { ...summary, state: summary.caveats.length ? "yellow" : "green" };
}

// Tiny DOM builder shared by the render layers (null children are skipped, so
// callers can express conditional nodes inline). Exported for room.js.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function injectStyles() {
  if (document.getElementById("receipt-badge-styles")) return;
  const css = `
  .receipt-badge{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    font-size:14px;border:1px solid #d0d5dd;border-radius:8px;max-width:640px;background:#fff;color:#1d2939}
  .receipt-badge .lb-head{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;
    user-select:none}
  .receipt-badge .lb-mark{font-weight:700}
  .receipt-badge.lb-green{border-color:#abefc6}
  .receipt-badge.lb-green .lb-mark{color:#067647}
  .receipt-badge.lb-red{border-color:#fda29b}
  .receipt-badge.lb-red .lb-mark{color:#b42318}
  .receipt-badge.lb-grey{border-color:#d0d5dd}
  .receipt-badge.lb-grey .lb-mark{color:#5c6470}
  .receipt-badge.lb-yellow{border-color:#fedf89}
  .receipt-badge.lb-yellow .lb-mark{color:#b54708}
  .receipt-badge .lb-caveats{margin-top:8px;color:#b54708;font-size:13px}
  .receipt-badge .lb-body{border-top:1px solid #eaecf0;padding:10px 14px;display:none}
  .receipt-badge.lb-open .lb-body{display:block}
  .receipt-badge table{border-collapse:collapse;width:100%;font-size:13px}
  .receipt-badge th,.receipt-badge td{text-align:left;padding:6px 8px;border-bottom:1px solid #f2f4f7}
  .receipt-badge th{color:#475467;font-weight:600}
  .receipt-badge code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#475467}
  .receipt-badge .lb-delta{margin-top:8px;color:#b42318;font-size:13px}
  .receipt-badge .lb-caret{margin-left:auto;color:#98a2b3}`;
  document.head.appendChild(el("style", { id: "receipt-badge-styles", textContent: css }));
}

function renderDetail(receipts) {
  const rows = receipts.map((r) =>
    el("tr", {}, [
      el("td", {}, stageNameOf(r)),
      el("td", {}, r.created_at || ""),
      el("td", {}, [el("code", {}, SHORT(outputHashOf(r)))]),
      el("td", {}, String(totalsOf(r).row_count ?? "")),
    ])
  );
  return el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "stage"),
      el("th", {}, "timestamp"),
      el("th", {}, "output hash"),
      el("th", {}, "rows"),
    ])),
    el("tbody", {}, rows),
  ]);
}

let warnedBadgeDeprecated = false;

export async function renderReceiptBadge(containerEl, chainUrl, pubKeyHex) {
  if (!warnedBadgeDeprecated) {
    warnedBadgeDeprecated = true;
    console.warn(
      "renderReceiptBadge is deprecated and will be removed in 3.0: mount the signal " +
        "light (tamper-signal/light) with the room behind it (tamper-signal/room) instead."
    );
  }
  injectStyles();
  containerEl.innerHTML = "";
  const badge = el("div", { className: "receipt-badge" });
  const mark = el("span", { className: "lb-mark" });
  const label = el("span", { className: "lb-label" });
  const caret = el("span", { className: "lb-caret", textContent: "▸" });
  const head = el("div", { className: "lb-head" }, [mark, label, caret]);
  const body = el("div", { className: "lb-body" });
  badge.appendChild(head);
  badge.appendChild(body);
  containerEl.appendChild(badge);

  head.addEventListener("click", () => {
    badge.classList.toggle("lb-open");
    caret.textContent = badge.classList.contains("lb-open") ? "▾" : "▸";
  });

  const result = await verifyReceipts(chainUrl, pubKeyHex);
  const { receipts, origin, finalRows, transforms, linkResult, caveats } = result;

  if (result.state === "unverifiable") {
    // Grey, never amber: the capability fallback says nothing about the chain
    // and must not wear the yellow verdict's color.
    badge.classList.add("lb-grey");
    mark.textContent = "!";
    label.textContent = result.reason;
    return;
  }

  if (result.state === "green") {
    badge.classList.add("lb-green");
    mark.textContent = "✓";
    label.textContent =
      `Verified · ${origin} · ${Number(finalRows).toLocaleString()} rows · ` +
      `${transforms} transform${transforms === 1 ? "" : "s"} · chain intact`;
    body.appendChild(renderDetail(receipts));
    return;
  }

  if (result.state === "yellow") {
    badge.classList.add("lb-yellow");
    mark.textContent = "⚠";
    label.textContent =
      `Verified, with caveats · ${origin} · ${Number(finalRows).toLocaleString()} rows · ` +
      `${caveats.length} caveat${caveats.length === 1 ? "" : "s"}`;
    body.appendChild(renderDetail(receipts));
    body.appendChild(
      el("div", { className: "lb-caveats" }, "A human should look: " + caveats.join("; "))
    );
    return;
  }

  badge.classList.add("lb-red");
  mark.textContent = "✗";
  label.textContent = result.reason.charAt(0).toUpperCase() + result.reason.slice(1);
  body.appendChild(renderDetail(receipts));
  if (linkResult.ok === false && linkResult.delta && linkResult.delta.length) {
    body.appendChild(
      el("div", { className: "lb-delta" }, "Totals delta vs upstream: " + linkResult.delta.join(", "))
    );
  }
}
