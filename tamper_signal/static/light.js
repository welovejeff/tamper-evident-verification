// The inline status light: a small dark instrument that mounts in a host
// dashboard's header and attests the receipt chain behind the page. Built on
// the same verification core as the badge (verifyReceipts in badge.js): Web
// Crypto Ed25519 signatures, hash-link walk, yellow caveats. Only the
// rendering layer differs. No build step, no framework.
//
// mountTamperSignal(hostEl, chainUrl, pubKeyHex?, opts?)
//   pubKeyHex: a trusted key hex, or an array of them (key rotation).
//   Same argument contract as renderReceiptBadge, with the light appended to
//   hostEl rather than replacing its contents. Returns a handle:
//   { el, ready, refresh(), destroy(), getState(), setOpen(open) }.
//   `ready` resolves with the first verification result; setOpen() opens or
//   closes the popover programmatically (demo pages use it to present the
//   verdict without waiting for a click).
//
//   opts:
//     watch        re-verify every N ms and pulse on state transitions
//     warnDrift    flag any control-totals movement across links as a caveat
//     receiptsHref href for the popover's "view receipts" link (default: chainUrl)
//     surface      the HOST page's surface: "light" (default) or "dark". The
//                  pill should be the one foreign object on the page, so on a
//                  "dark" host it inverts to a light pill. Pick this to match
//                  what you see -- "dark" on a dark dashboard.
//     invert       boolean shortcut for surface: "dark".
//     theme        DEPRECATED pill-colour prop. theme: "light" == surface:
//                  "dark" (a light pill, for a dark host). Prefer `surface`;
//                  the name invited the opposite of what you want.
//
// States: checking (boot), green, yellow, red, and unverifiable (fetch failed
// or no Web Crypto Ed25519). Unverifiable is a capability fallback, not a
// verdict: it says nothing about the chain and never wears the yellow color.
//
// In the red state the light also reaches into the host page: any element
// carrying data-receipt-column="<column>" whose column appears in the broken
// link's totals delta is outlined and tagged "tamper signal: unverified value".
// Mapping DOM nodes to chain columns is the host author's one manual step.

import { verifyReceipts, SHORT, totalsOf, stageNameOf, outputHashOf } from "./badge.js";

// Whether to render the inverted (light) pill, for a dark host page. `surface`
// describes the host ("light" | "dark"); `invert` is its boolean shortcut;
// `theme: "light"` is the deprecated pill-colour prop kept working for
// back-compat. Exported so it can be unit-tested without a DOM.
export function shouldInvertPill({ surface, invert, theme } = {}) {
  if (surface === "dark") return true;
  if (surface === "light") return false;
  if (invert === true) return true;
  return theme === "light"; // legacy alias
}

let uid = 0;

const WORDS = {
  checking: "CHECKING",
  green: "VERIFIED",
  yellow: "CAVEAT",
  red: "BROKEN",
  unverifiable: "UNVERIFIED",
};

const VERDICTS = {
  checking: "VERIFYING",
  green: "CHAIN VERIFIED",
  yellow: "VERIFIABLE WITH CAVEATS",
  red: "CHAIN BROKEN",
  unverifiable: "COULD NOT VERIFY",
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function injectLightStyles() {
  if (document.getElementById("tamper-signal-styles")) return;
  const css = `
  .lr-light{position:relative;display:inline-block;margin-left:14px;
    font-family:ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Code',monospace;
    --lr-bg:#0b0f14;--lr-panel:#11161d;--lr-border:#1f2937;--lr-chrome:#161d26;
    --lr-text:#e5e7eb;--lr-dim:#8b98a5;--lr-faint:#3d4854;--lr-row:#18202b;
    --lr-green:#34d399;--lr-red:#f87171;--lr-amber:#fbbf24;--lr-cyan:#67e8f9}
  .lr-light[data-theme="light"]{--lr-bg:#ffffff;--lr-panel:#ffffff;--lr-border:#d0d5dd;
    --lr-chrome:#f2f4f7;--lr-text:#1d2939;--lr-dim:#5c6470;--lr-faint:#98a2b3;--lr-row:#eef0f4;
    --lr-green:#067647;--lr-red:#b42318;--lr-amber:#b54708;--lr-cyan:#0e7090}
  .lr-light .lr-pill{display:inline-flex;align-items:center;gap:8px;
    border:1px solid var(--lr-border);background:var(--lr-bg);color:var(--lr-text);
    border-radius:999px;padding:6px 12px 6px 9px;font:11px/1 inherit;font-family:inherit;
    letter-spacing:0.3px;cursor:pointer;white-space:nowrap;
    transition:border-color 0.15s,transform 0.1s}
  .lr-light .lr-pill:hover{border-color:var(--lr-faint)}
  .lr-light .lr-pill:active{transform:translateY(1px)}
  .lr-light .lr-pill:focus-visible{outline:2px solid var(--lr-cyan);outline-offset:2px}
  .lr-light .lr-caret{color:var(--lr-faint);font-size:9px;transition:transform 0.15s}
  .lr-light .lr-pill[aria-expanded="true"] .lr-caret{transform:rotate(90deg)}
  .lr-light .lr-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--lr-faint)}
  .lr-light .lr-word{font-weight:700}
  .lr-light .lr-sub{color:var(--lr-dim)}
  /* the seal never wraps; on narrow hosts the sub-label drops out instead */
  @media (max-width: 920px){ .lr-light .lr-sub{display:none} }
  .lr-light[data-state="green"] .lr-dot{background:var(--lr-green);box-shadow:0 0 6px 0 rgba(52,211,153,0.7)}
  .lr-light[data-state="yellow"] .lr-dot{background:var(--lr-amber);box-shadow:0 0 6px 0 rgba(251,191,36,0.7)}
  .lr-light[data-state="red"] .lr-dot{background:var(--lr-red);box-shadow:0 0 6px 0 rgba(248,113,113,0.7)}
  .lr-light[data-state="green"] .lr-word{color:var(--lr-green)}
  .lr-light[data-state="yellow"] .lr-word{color:var(--lr-amber)}
  .lr-light[data-state="red"] .lr-word{color:var(--lr-red)}
  .lr-light[data-state="checking"] .lr-word,.lr-light[data-state="unverifiable"] .lr-word{color:var(--lr-dim)}
  @keyframes lr-pulse{0%{box-shadow:0 0 0 0 var(--lr-pulse)}70%{box-shadow:0 0 0 9px transparent}
    100%{box-shadow:0 0 0 0 transparent}}
  .lr-light .lr-dot.lr-pulsing{animation:lr-pulse 0.9s ease-out 2}
  .lr-light[data-state="green"] .lr-dot.lr-pulsing{--lr-pulse:rgba(52,211,153,0.55)}
  .lr-light[data-state="yellow"] .lr-dot.lr-pulsing{--lr-pulse:rgba(251,191,36,0.55)}
  .lr-light[data-state="red"] .lr-dot.lr-pulsing{--lr-pulse:rgba(248,113,113,0.55)}
  @media (prefers-reduced-motion: reduce){.lr-light .lr-dot.lr-pulsing{animation:none}}
  .lr-light .lr-pop{position:absolute;top:calc(100% + 10px);right:0;width:372px;max-width:90vw;
    background:var(--lr-panel);border:1px solid var(--lr-border);border-radius:10px;
    color:var(--lr-text);font:12px/1.55 inherit;font-family:inherit;text-align:left;
    box-shadow:0 16px 48px rgba(4,8,14,0.45);z-index:2147483000;display:none}
  .lr-light .lr-pop.lr-open{display:block}
  /* On narrow screens the pill can sit anywhere in a wrapped header, so an
     anchored popover clips at the viewport edge; pin it as a bottom sheet. */
  @media (max-width: 600px){
    .lr-light .lr-pop{position:fixed;left:10px;right:10px;top:auto;bottom:14px;
      width:auto;max-width:none}
    .lr-light .lr-pop::before{display:none}
  }
  .lr-light .lr-pop-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;background:var(--lr-chrome);
    border-bottom:1px solid var(--lr-border);border-radius:10px 10px 0 0;padding:9px 14px;font-size:11px}
  .lr-light .lr-wordmark{color:var(--lr-dim);letter-spacing:1px}
  .lr-light .lr-verdict{font-weight:700}
  .lr-light[data-state="green"] .lr-verdict{color:var(--lr-green)}
  .lr-light[data-state="yellow"] .lr-verdict{color:var(--lr-amber)}
  .lr-light[data-state="red"] .lr-verdict{color:var(--lr-red)}
  .lr-light .lr-pop-head time{margin-left:auto;color:var(--lr-faint);font-size:10px}
  .lr-light .lr-pop-body{padding:12px 14px 14px}
  .lr-light .lr-pop-body p{margin:0 0 10px;color:var(--lr-dim);font-family:inherit}
  .lr-light .lr-pop-body p strong{color:var(--lr-text);font-weight:700}
  .lr-light .lr-chain{width:100%;border-collapse:collapse;margin:2px 0 4px}
  .lr-light .lr-chain th{text-align:left;font-weight:400;font-size:10px;color:var(--lr-faint);
    padding:0 8px 5px 0;border-bottom:1px solid var(--lr-border)}
  .lr-light .lr-chain td{padding:5px 8px 5px 0;border-bottom:1px solid var(--lr-row);font-size:11px}
  .lr-light .lr-chain tr:last-child td{border-bottom:0}
  .lr-light .lr-hash{color:var(--lr-cyan)}
  .lr-light .lr-ok{color:var(--lr-green)}
  .lr-light .lr-warn{color:var(--lr-amber)}
  .lr-light .lr-bad{color:var(--lr-red)}
  .lr-light .lr-mut{color:var(--lr-dim)}
  .lr-light .lr-kv{margin:8px 0 2px}
  .lr-light .lr-kv div{display:flex;gap:10px;padding:2px 0}
  .lr-light .lr-kv dt{color:var(--lr-faint);width:76px;flex:none}
  .lr-light .lr-kv dd{margin:0;overflow-wrap:anywhere}
  .lr-light .lr-delta{margin-top:9px;border:1px solid rgba(248,113,113,0.35);
    background:rgba(180,35,24,0.12);border-radius:7px;padding:8px 10px;color:var(--lr-red);font-size:11px}
  .lr-light .lr-gap{margin-top:9px;border:1px dashed rgba(251,191,36,0.45);
    background:rgba(251,191,36,0.07);border-radius:7px;padding:8px 10px;color:var(--lr-amber);font-size:11px}
  .lr-light .lr-pop-foot{display:flex;align-items:center;gap:10px;border-top:1px solid var(--lr-border);
    padding:8px 14px;font-size:10px;color:var(--lr-faint)}
  .lr-light .lr-pop-foot a{margin-left:auto;color:var(--lr-cyan);text-decoration:none}
  .lr-light .lr-pop-foot a:hover{text-decoration:underline}
  .lr-light .lr-pop-foot a:focus-visible{outline:2px solid var(--lr-cyan);outline-offset:2px;border-radius:3px}
  .lr-light .lr-tagline{color:var(--lr-green)}
  .lr-suspect{box-shadow:0 0 0 2px #f87171,0 0 0 5px rgba(248,113,113,0.18) !important}
  .lr-suspect-tag{font:10px/1 ui-monospace,'SF Mono',Menlo,monospace;color:#f87171;margin-top:6px}`;
  document.head.appendChild(el("style", { id: "tamper-signal-styles", textContent: css }));
}

// Host-page columns whose totals moved across the broken link. Used to flag
// [data-receipt-column] elements; row/column count changes have no single
// column to point at, so only numeric_sums and null_counts participate.
function changedColumns(up, down) {
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

// Per-stage table for the green/yellow popovers; the sig column is honest
// because these states only render after every signature has verified.
function chainTable(receipts) {
  const rows = receipts.map((r) =>
    el("tr", {}, [
      el("td", {}, stageNameOf(r)),
      el("td", {}, [el("span", { className: "lr-hash" }, SHORT(outputHashOf(r)))]),
      el("td", {}, String(totalsOf(r).row_count ?? "")),
      el("td", { className: "lr-ok" }, "✓"),
    ])
  );
  return el("table", { className: "lr-chain" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "stage"),
      el("th", {}, "output hash"),
      el("th", {}, "rows"),
      el("th", {}, "sig"),
    ])),
    el("tbody", {}, rows),
  ]);
}

function shortCaveatTag(caveats) {
  const first = caveats[0] || "";
  if (first.startsWith("coverage gap")) return "coverage gap";
  if (first.startsWith("unrecognized signing key")) return "unknown key";
  if (first.startsWith("totals drift")) return "totals drift";
  return "see details";
}

export function mountTamperSignal(hostEl, chainUrl, pubKeyHex, opts) {
  // Allow mountTamperSignal(el, url, {watch: ...}) without a key argument.
  // Arrays are trusted keysets (rotation), not options.
  if (pubKeyHex && typeof pubKeyHex === "object" && !Array.isArray(pubKeyHex)) {
    opts = pubKeyHex;
    pubKeyHex = undefined;
  }
  opts = opts || {};
  injectLightStyles();

  const id = `lr-light-${++uid}`;
  const dot = el("span", { className: "lr-dot" });
  dot.setAttribute("aria-hidden", "true");
  const word = el("span", { className: "lr-word" });
  const sub = el("span", { className: "lr-sub" });
  const text = el("span", {}, [word, sub]);
  text.setAttribute("aria-live", "polite");
  const caret = el("span", { className: "lr-caret", textContent: "▸" });
  caret.setAttribute("aria-hidden", "true");
  const pill = el("button", { className: "lr-pill", type: "button" }, [dot, text, caret]);
  pill.setAttribute("aria-expanded", "false");
  pill.setAttribute("aria-controls", `${id}-pop`);
  pill.setAttribute("aria-label", "Tamper Signal verification status");

  const verdict = el("span", { className: "lr-verdict" });
  const time = el("time", {});
  const popHead = el("div", { className: "lr-pop-head" }, [
    el("span", { className: "lr-wordmark" }, "TAMPER SIGNAL"),
    verdict,
    time,
  ]);
  const popBody = el("div", { className: "lr-pop-body" });
  const footNote = el("span", {});
  const footLink = el("a", {
    href: opts.receiptsHref || chainUrl,
    textContent: "view receipts →",
  });
  const popFoot = el("div", { className: "lr-pop-foot" }, [footNote, footLink]);
  const pop = el("div", { className: "lr-pop", id: `${id}-pop` }, [popHead, popBody, popFoot]);
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Tamper Signal verification detail");

  const root = el("span", { className: "lr-light", id }, [pill, pop]);
  root.dataset.state = "checking";
  if (shouldInvertPill(opts)) root.dataset.theme = "light";
  hostEl.appendChild(root);

  // --- popover open/close ---
  function setOpen(open) {
    pop.classList.toggle("lr-open", open);
    pill.setAttribute("aria-expanded", String(open));
  }
  pill.addEventListener("click", () => setOpen(!pop.classList.contains("lr-open")));
  function onKeydown(e) {
    if (e.key === "Escape" && pop.classList.contains("lr-open")) {
      setOpen(false);
      pill.focus();
    }
  }
  function onClickAway(e) {
    if (pop.classList.contains("lr-open") && !root.contains(e.target)) setOpen(false);
  }
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onClickAway);

  function pulse() {
    dot.classList.remove("lr-pulsing");
    void dot.offsetWidth; // restart the animation
    dot.classList.add("lr-pulsing");
  }
  dot.addEventListener("animationend", () => dot.classList.remove("lr-pulsing"));

  // --- host metric flagging (red state) ---
  let flagged = [];
  function clearFlags() {
    for (const { node, tag } of flagged) {
      node.classList.remove("lr-suspect");
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
    }
    flagged = [];
  }
  function flagSuspects(result) {
    clearFlags();
    const { linkResult, receipts } = result;
    if (!linkResult || linkResult.ok !== false || linkResult.brokenAt == null) return;
    const cols = changedColumns(
      totalsOf(receipts[linkResult.brokenAt - 1]),
      totalsOf(receipts[linkResult.brokenAt])
    );
    if (!cols.size) return;
    for (const node of document.querySelectorAll("[data-receipt-column]")) {
      if (!cols.has(node.getAttribute("data-receipt-column"))) continue;
      node.classList.add("lr-suspect");
      const tag = el("div", { className: "lr-suspect-tag" }, "⚠ tamper signal: unverified value");
      node.appendChild(tag);
      flagged.push({ node, tag });
    }
  }

  // --- state rendering ---
  let state = "checking";
  function setChrome(name, subText, footSpec) {
    root.dataset.state = name;
    word.textContent = WORDS[name];
    sub.textContent = subText ? ` · ${subText}` : "";
    verdict.textContent = VERDICTS[name];
    footNote.textContent = footSpec.text;
    footNote.className = footSpec.tagline ? "lr-tagline" : "";
  }

  function render(result) {
    const prev = state;
    state = result.state;
    popBody.textContent = "";
    if (result.verifiedAt) {
      time.dateTime = result.verifiedAt;
      time.textContent = `verified ${result.verifiedAt.slice(11, 19)}Z`;
    }

    if (state === "unverifiable") {
      setChrome("unverifiable", result.reason, { text: "capability fallback, not a verdict" });
      popBody.appendChild(
        el("p", {}, [
          el("strong", {}, "The light could not check this chain: "),
          `${result.reason}. This says nothing about the data either way.`,
        ])
      );
      clearFlags();
      return;
    }

    const { receipts, origin, finalRows, transforms, linkResult, caveats } = result;
    const stats =
      `${receipts.length} receipt${receipts.length === 1 ? "" : "s"} · ` +
      `${transforms} transform${transforms === 1 ? "" : "s"}`;

    if (state === "green") {
      setChrome("green", "chain intact", {
        text: "The light is green, the data is clean.",
        tagline: true,
      });
      popBody.appendChild(
        el("p", {}, [
          el("strong", {}, `${stats} · signatures valid.`),
          ` Every hash link from ${origin} to this page re-verified in your browser.`,
        ])
      );
      popBody.appendChild(chainTable(receipts));
    } else if (state === "yellow") {
      setChrome("yellow", shortCaveatTag(caveats), { text: "a human should look" });
      popBody.appendChild(
        el("p", {}, [
          el("strong", {}, "Chain verifies, with caveats."),
          " Here's what we couldn't check.",
        ])
      );
      popBody.appendChild(chainTable(receipts));
      for (const caveat of caveats) {
        popBody.appendChild(el("div", { className: "lr-gap" }, `⚠ ${caveat}`));
      }
    } else {
      // red
      const broken = linkResult && linkResult.ok === false;
      setChrome("red", broken ? `hash mismatch at ${linkResult.brokenStage}` : result.reason, {
        text: "do not trust totals fed by this stage",
      });
      if (broken) {
        popBody.appendChild(
          el("p", {}, [
            el("strong", {}, `Hash mismatch at link ${linkResult.brokenAt - 1} -> ${linkResult.brokenAt}.`),
            ` The declared input of ${linkResult.brokenStage} is not the verified output of ` +
              `${stageNameOf(receipts[linkResult.brokenAt - 1])}. Data changed between these stages.`,
          ])
        );
        const kv = el("dl", { className: "lr-kv" }, [
          el("div", {}, [el("dt", {}, "broken at"), el("dd", { className: "lr-bad" }, linkResult.brokenStage)]),
          el("div", {}, [
            el("dt", {}, "expected"),
            el("dd", {}, [
              el("span", { className: "lr-hash" }, SHORT(linkResult.expected)),
              el("span", { className: "lr-mut" }, ` (output of ${stageNameOf(receipts[linkResult.brokenAt - 1])}, signed)`),
            ]),
          ]),
          el("div", {}, [
            el("dt", {}, "found"),
            el("dd", {}, [el("span", { className: "lr-bad" }, SHORT(linkResult.found))]),
          ]),
        ]);
        popBody.appendChild(kv);
        if (linkResult.delta && linkResult.delta.length) {
          popBody.appendChild(
            el("div", { className: "lr-delta" }, `totals delta vs upstream: ${linkResult.delta.join(" · ")}`)
          );
        }
      } else {
        popBody.appendChild(
          el("p", {}, [
            el("strong", {}, `${result.reason.charAt(0).toUpperCase()}${result.reason.slice(1)}.`),
            " The chain cannot be trusted as signed.",
          ])
        );
      }
    }

    flagSuspects(result);
    if (prev !== state) pulse();
  }

  // --- verification loop ---
  let timer = null;
  let destroyed = false;
  async function refresh() {
    const result = await verifyReceipts(chainUrl, pubKeyHex, { warnDrift: opts.warnDrift });
    if (!destroyed) render(result);
    return result;
  }

  setChrome("checking", "verifying", { text: "re-verifying in your browser" });
  popBody.appendChild(el("p", {}, "Fetching the receipt chain and re-verifying every signature and hash link."));
  const ready = refresh();

  if (opts.watch) {
    timer = setInterval(refresh, Math.max(1000, Number(opts.watch) || 0));
  }

  return {
    el: root,
    ready,
    refresh,
    getState: () => state,
    setOpen,
    destroy() {
      destroyed = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onClickAway);
      clearFlags();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
