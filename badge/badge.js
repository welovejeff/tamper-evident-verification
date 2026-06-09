// Standalone lineage verification badge. No build step, no framework.
//
// renderLineageBadge(containerEl, chainUrl, pubKeyHex)
//   Fetches chain.json and every receipt, re-verifies all signatures with Web
//   Crypto Ed25519, re-checks all hash links (receipt N input == receipt N-1
//   output), and renders a collapsed green/red badge that expands to per-stage
//   detail. The browser does NOT re-canonicalize xlsx; it only re-links hashes.
//
// pubKeyHex is optional; when omitted the key embedded in chain.json is used.

const SHORT = (h) => (h && h.length > 10 ? `${h.slice(0, 4)}...${h.slice(-2)}` : h || "(none)");

// --- Canonical JSON, byte-identical to lineage/canonical.py's JCS output. ---
// Leaves are strings, integers, booleans, or null (no floats). Object keys are
// sorted; strings use JSON.stringify, whose escaping matches the Python side.
function canonicalize(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value); // integers only by construction
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
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// --- Hash accessors mirroring lineage/receipts.py. ---
const outputHashOf = (r) =>
  r.kind === "source_manifest" ? r.semantic_hash : r.output_semantic_hash;
const inputHashOf = (r) => (r.kind === "source_manifest" ? null : r.input_semantic_hash);
const totalsOf = (r) =>
  r.kind === "source_manifest" ? r.control_totals : r.output_control_totals;
const stageNameOf = (r) => (r.kind === "source_manifest" ? "source" : r.transform.name);

// --- Minimal totals delta, mirroring lineage/totals.py for the red expand. ---
function totalsDelta(up, down) {
  const lines = [];
  if (up.row_count !== down.row_count) {
    const d = down.row_count - up.row_count;
    lines.push(`row_count ${up.row_count} -> ${down.row_count} (${d >= 0 ? "+" : ""}${d})`);
  }
  const us = up.numeric_sums || {};
  const ds = down.numeric_sums || {};
  for (const col of new Set([...Object.keys(us), ...Object.keys(ds)])) {
    if (us[col] !== ds[col]) lines.push(`${col} ${us[col] ?? "(added)"} -> ${ds[col] ?? "(removed)"}`);
  }
  return lines;
}

async function ed25519Available() {
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

async function verifySignature(receipt, pubKeyHex) {
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

async function loadChain(chainUrl) {
  const base = new URL(chainUrl, window.location.href);
  const chain = await (await fetch(base)).json();
  const receipts = [];
  for (const name of chain.receipts) {
    const url = new URL(name, base);
    receipts.push(await (await fetch(url)).json());
  }
  return { chain, receipts };
}

function evaluate(receipts) {
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

  let chain, receipts;
  try {
    ({ chain, receipts } = await loadChain(chainUrl));
  } catch (e) {
    badge.classList.add("lb-amber");
    mark.textContent = "!";
    label.textContent = "could not load chain";
    return;
  }

  const keyHex = pubKeyHex || chain.public_key;

  if (!(await ed25519Available())) {
    badge.classList.add("lb-amber");
    mark.textContent = "!";
    label.textContent = "verification unsupported in this browser";
    return;
  }

  // Re-verify every signature first.
  let signaturesOk = true;
  for (const r of receipts) {
    try {
      if (!(await verifySignature(r, keyHex))) signaturesOk = false;
    } catch (_e) {
      signaturesOk = false;
    }
  }

  const linkResult = evaluate(receipts);
  const source = receipts.find((r) => r.kind === "source_manifest");
  const origin = (source && source.source.declared_origin) || "source";
  const finalRows = totalsOf(receipts[receipts.length - 1]).row_count;
  const transforms = receipts.filter((r) => r.kind === "transform_receipt").length;

  if (signaturesOk && linkResult.ok) {
    badge.classList.add("lb-green");
    mark.textContent = "✓";
    label.textContent =
      `Verified · ${origin} · ${Number(finalRows).toLocaleString()} rows · ` +
      `${transforms} transform${transforms === 1 ? "" : "s"} · chain intact`;
    body.appendChild(renderDetail(receipts));
    return;
  }

  badge.classList.add("lb-red");
  mark.textContent = "✗";
  if (!signaturesOk) {
    label.textContent = "Signature invalid";
  } else {
    label.textContent = `Chain broken at ${linkResult.brokenStage}`;
  }
  body.appendChild(renderDetail(receipts));
  if (linkResult.ok === false && linkResult.delta && linkResult.delta.length) {
    body.appendChild(
      el("div", { className: "lb-delta" }, "Totals delta vs upstream: " + linkResult.delta.join(", "))
    );
  }
}
