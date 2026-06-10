// Standalone lineage verification badge. No build step, no framework.
//
// This file is also the browser verification core for the inline status light
// (light.js): verifyLineage(chainUrl, pubKeyHex) runs the whole pipeline
// (fetch, signatures, hash links, caveats) and returns a structured result;
// the render layers differ.
//
// renderLineageBadge(containerEl, chainUrl, pubKeyHex)
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

// --- Canonical JSON, byte-identical to lineage/canonical.py's JCS output. ---
// Leaves are strings, integers, booleans, or null (no floats). Object keys are
// sorted; strings use JSON.stringify, whose escaping matches the Python side.
function canonicalize(value) {
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

// --- Hash accessors mirroring lineage/receipts.py. ---
export const outputHashOf = (r) =>
  r.kind === "source_manifest" ? r.semantic_hash : r.output_semantic_hash;
export const inputHashOf = (r) => (r.kind === "source_manifest" ? null : r.input_semantic_hash);
export const totalsOf = (r) =>
  r.kind === "source_manifest" ? r.control_totals : r.output_control_totals;
export const stageNameOf = (r) => (r.kind === "source_manifest" ? "source" : r.transform.name);

// --- Totals delta, mirroring lineage/totals.py for the red expand. Reports
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

export async function loadChain(chainUrl) {
  const base = new URL(chainUrl, window.location.href);
  const chain = await (await fetch(base)).json();
  const receipts = [];
  for (const name of chain.receipts || []) {
    if (typeof name !== "string" || !SAFE_RECEIPT_NAME.test(name)) {
      throw new Error("unsafe receipt name in chain: " + name);
    }
    const url = new URL(name, base);
    receipts.push(await (await fetch(url)).json());
  }
  return { chain, receipts };
}

// Gaps in the generated NNN_ receipt numbering, mirroring lineage/receipts.py's
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

// Signature pass mirroring lineage/receipts.py: every receipt is checked
// against the trusted key; one that fails there but verifies under the key
// embedded in chain.json means the chain is internally consistent but vouched
// for by a key the caller does not trust (yellow), not broken (red).
export async function checkSignatures(receipts, trustedKeyHex, chainKeyHex) {
  let valid = true;
  let unrecognized = false;
  const useFallback = chainKeyHex && chainKeyHex !== trustedKeyHex;
  for (const r of receipts) {
    let ok = false;
    try {
      ok = await verifySignature(r, trustedKeyHex);
    } catch (_e) {
      ok = false;
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
export async function verifyLineage(chainUrl, pubKeyHex, opts = {}) {
  const verifiedAt = new Date().toISOString();
  let chain, receipts;
  try {
    ({ chain, receipts } = await loadChain(chainUrl));
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

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function injectStyles() {
  if (document.getElementById("lineage-badge-styles")) return;
  const css = `
  .lineage-badge{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    font-size:14px;border:1px solid #d0d5dd;border-radius:8px;max-width:640px;background:#fff;color:#1d2939}
  .lineage-badge .lb-head{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;
    user-select:none}
  .lineage-badge .lb-mark{font-weight:700}
  .lineage-badge.lb-green{border-color:#abefc6}
  .lineage-badge.lb-green .lb-mark{color:#067647}
  .lineage-badge.lb-red{border-color:#fda29b}
  .lineage-badge.lb-red .lb-mark{color:#b42318}
  .lineage-badge.lb-amber{border-color:#fedf89}
  .lineage-badge.lb-amber .lb-mark{color:#b54708}
  .lineage-badge.lb-yellow{border-color:#fedf89}
  .lineage-badge.lb-yellow .lb-mark{color:#b54708}
  .lineage-badge .lb-caveats{margin-top:8px;color:#b54708;font-size:13px}
  .lineage-badge .lb-body{border-top:1px solid #eaecf0;padding:10px 14px;display:none}
  .lineage-badge.lb-open .lb-body{display:block}
  .lineage-badge table{border-collapse:collapse;width:100%;font-size:13px}
  .lineage-badge th,.lineage-badge td{text-align:left;padding:6px 8px;border-bottom:1px solid #f2f4f7}
  .lineage-badge th{color:#475467;font-weight:600}
  .lineage-badge code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#475467}
  .lineage-badge .lb-delta{margin-top:8px;color:#b42318;font-size:13px}
  .lineage-badge .lb-caret{margin-left:auto;color:#98a2b3}`;
  document.head.appendChild(el("style", { id: "lineage-badge-styles", textContent: css }));
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

export async function renderLineageBadge(containerEl, chainUrl, pubKeyHex) {
  injectStyles();
  containerEl.innerHTML = "";
  const badge = el("div", { className: "lineage-badge" });
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

  const result = await verifyLineage(chainUrl, pubKeyHex);
  const { receipts, origin, finalRows, transforms, linkResult, caveats } = result;

  if (result.state === "unverifiable") {
    badge.classList.add("lb-amber");
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
