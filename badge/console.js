// The verification console: devtools-for-data. The inline light answers "is
// it fine?"; this window answers "where, exactly, and by how much?" Design
// reference: designs/02-debug-window.html, notes in designs/02-NOTES.md.
//
// mountReceiptConsole(containerEl, chainUrl, opts?)
//   Runs the same in-browser verification as the badge/signal/table
//   (verifyReceipts in badge.js) and renders:
//   - the lamp: state-coded motion (slow breathing green, brisk yellow,
//     sharp double-blink red; none under prefers-reduced-motion)
//   - the pipeline: one card per receipt, links carrying the hash they
//     proved; a break severs the link and pins a break card at the break
//     with expected/found chips and the totals delta; a coverage-gap caveat
//     renders as a dashed amber link to a ghost node at the gap's position
//   - the inspector: click a card for its receipt (kv + raw JSON)
//   - the event log: one entry per verify run, mirroring the CLI verifier
//   - the chain of custody: the published timeline.json (imports, changes,
//     signed reasons + self-declared authors) as an ADDITIVE layer that never
//     feeds the verdict — the lamp comes solely from chain.json (R16)
//
//   opts: pubKey (trusted key hex), watch (re-verify every N ms), warnDrift,
//         timeline (timeline.json URL; defaults to timeline.json beside chain)
//   Returns { el, ready, refresh(), destroy() }.

import {
  verifyReceipts,
  verifySignature,
  SHORT,
  outputHashOf,
  inputHashOf,
  totalsOf,
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

function injectConsoleStyles() {
  if (document.getElementById("tamper-console-styles")) return;
  const css = `
  .tc{--bg:#0b0f14;--panel:#11161d;--border:#1f2937;--chrome:#161d26;--text:#e5e7eb;
    --dim:#8b98a5;--faint:#3d4854;--row:#18202b;--green:#34d399;--red:#f87171;
    --amber:#fbbf24;--cyan:#67e8f9;
    font-family:ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Code',monospace;
    background:var(--bg);border:1px solid var(--border);border-radius:12px;
    color:var(--text);overflow:hidden;font-size:12px}
  .tc .tc-head{display:flex;align-items:center;gap:12px;background:var(--chrome);
    border-bottom:1px solid var(--border);padding:12px 16px}
  .tc .tc-lamp{width:16px;height:16px;border-radius:50%;flex:none;background:var(--faint)}
  .tc[data-state="green"] .tc-lamp{background:var(--green);box-shadow:0 0 10px 1px rgba(52,211,153,0.7);
    animation:tc-breathe 4s ease-in-out infinite}
  .tc[data-state="yellow"] .tc-lamp{background:var(--amber);box-shadow:0 0 10px 1px rgba(251,191,36,0.7);
    animation:tc-breathe 1.6s ease-in-out infinite}
  .tc[data-state="red"] .tc-lamp{background:var(--red);box-shadow:0 0 10px 1px rgba(248,113,113,0.7);
    animation:tc-blink 1.8s steps(1) infinite}
  @keyframes tc-breathe{0%,100%{opacity:1}50%{opacity:0.55}}
  @keyframes tc-blink{0%,12%,24%{opacity:1}6%,18%{opacity:0.25}30%,100%{opacity:1}}
  @media (prefers-reduced-motion: reduce){.tc .tc-lamp{animation:none !important}}
  .tc .tc-title{color:var(--dim);letter-spacing:1.2px;font-size:11px}
  .tc .tc-verdict{font-weight:700}
  .tc[data-state="green"] .tc-verdict{color:var(--green)}
  .tc[data-state="yellow"] .tc-verdict{color:var(--amber)}
  .tc[data-state="red"] .tc-verdict{color:var(--red)}
  .tc[data-state="unverifiable"] .tc-verdict{color:var(--dim)}
  .tc .tc-time{margin-left:auto;color:var(--faint);font-size:10px}
  .tc .tc-reverify{font:10px inherit;font-family:inherit;color:var(--cyan);background:none;
    border:1px solid var(--border);border-radius:6px;padding:5px 10px;cursor:pointer}
  .tc .tc-reverify:hover{border-color:var(--faint)}
  .tc .tc-caveats{padding:8px 16px;font-size:11px;color:var(--amber);
    border-bottom:1px solid var(--border);background:rgba(251,191,36,0.06)}
  .tc .tc-rail-wrap{padding:18px 16px 6px;overflow-x:auto}
  .tc .tc-rail{display:flex;align-items:flex-start;gap:0;min-width:max-content}
  .tc .tc-node{border:1px solid var(--border);border-radius:10px;background:var(--panel);
    padding:10px 12px;min-width:148px;cursor:pointer}
  .tc .tc-node:hover{border-color:var(--faint)}
  .tc .tc-node.tc-active{border-color:var(--cyan)}
  .tc .tc-node.tc-ghost{border-style:dashed;border-color:rgba(251,191,36,0.55);
    color:var(--amber);cursor:default;background:rgba(251,191,36,0.04)}
  .tc .tc-node .n-name{font-weight:700;font-size:12px}
  .tc .tc-node .n-kind{color:var(--faint);font-size:9px;letter-spacing:0.6px;text-transform:uppercase}
  .tc .tc-node .n-row{color:var(--dim);font-size:10.5px;margin-top:5px}
  .tc .tc-node .hash{color:var(--cyan)}
  .tc .tc-node .ok{color:var(--green)}
  .tc .tc-link{display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:0 4px;min-width:96px;align-self:stretch}
  .tc .tc-link .l-line{font-size:11px;white-space:nowrap;color:var(--green)}
  .tc .tc-link .l-hash{font-size:9.5px;color:var(--faint);margin-top:2px}
  .tc .tc-link.tc-broken .l-line{color:var(--red);font-weight:700}
  .tc .tc-link.tc-gap .l-line{color:var(--amber)}
  .tc .tc-break{margin:10px 16px 4px;border:1px solid rgba(248,113,113,0.4);
    background:rgba(180,35,24,0.10);border-radius:9px;padding:10px 14px;font-size:11px}
  .tc .tc-break h4{margin:0 0 6px;color:var(--red);font-size:11px}
  .tc .tc-break .kv{display:flex;gap:10px;padding:1px 0}
  .tc .tc-break .kv b{color:var(--faint);font-weight:400;width:70px;flex:none}
  .tc .tc-break .bad{color:var(--red)}
  .tc .tc-break .hash{color:var(--cyan)}
  .tc .tc-break .delta{margin-top:6px;color:var(--red)}
  .tc .tc-inspect{margin:10px 16px;border:1px solid var(--border);border-radius:9px;
    background:var(--panel);padding:10px 14px;font-size:11px;display:none}
  .tc .tc-inspect.open{display:block}
  .tc .tc-inspect .kv{display:flex;gap:10px;padding:1px 0}
  .tc .tc-inspect .kv b{color:var(--faint);font-weight:400;width:92px;flex:none}
  .tc .tc-inspect .hash{color:var(--cyan)}
  .tc .tc-inspect summary{cursor:pointer;color:var(--faint);font-size:10px;margin-top:6px}
  .tc .tc-inspect pre{margin:8px 0 0;padding:10px;background:var(--bg);
    border:1px solid var(--border);border-radius:7px;font-size:10px;line-height:1.5;
    overflow:auto;max-height:240px}
  .tc .tc-log{border-top:1px solid var(--border);background:#07090d;
    padding:10px 16px;max-height:170px;overflow-y:auto}
  .tc .tc-log .l-head{color:var(--faint);font-size:9.5px;letter-spacing:1px;margin-bottom:6px}
  .tc .tc-log .entry{font-size:10.5px;line-height:1.7;color:var(--dim);white-space:pre-wrap}
  .tc .tc-log .t-green{color:var(--green)}
  .tc .tc-log .t-amber{color:var(--amber)}
  .tc .tc-log .t-red{color:var(--red)}
  .tc .tc-log .t-faint{color:var(--faint)}
  .tc .tc-custody{border-top:1px solid var(--border);background:var(--panel);padding:12px 16px}
  .tc .tc-custody-head{color:var(--dim);letter-spacing:1px;font-size:10px;margin-bottom:8px;text-transform:uppercase}
  .tc .tc-custody-warn{color:var(--amber);font-size:11px}
  .tc .tc-custody-list .c-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;
    padding:6px 0;border-top:1px solid var(--row)}
  .tc .tc-custody-list .c-mark{color:var(--cyan);font-size:10px;min-width:64px}
  .tc .tc-custody-list .c-stage{font-weight:700}
  .tc .tc-custody-list .c-meta{color:var(--dim);font-size:10.5px}
  .tc .tc-custody-list .c-when{margin-left:auto;color:var(--faint);font-size:10px}
  .tc .tc-custody-list .c-ann{padding:3px 0 5px 64px;font-size:11px;color:var(--text)}
  .tc .tc-custody-list .c-ann.c-superseded{opacity:0.55;text-decoration:line-through}
  .tc .tc-custody-list .c-ann .c-author{margin-left:10px;color:var(--faint);font-size:10px}`;
  document.head.appendChild(el("style", { id: "tamper-console-styles", textContent: css }));
}

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

// Mirror the CLI verifier's report shape for the event log.
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

export function mountReceiptConsole(containerEl, chainUrl, opts) {
  opts = opts || {};
  injectConsoleStyles();

  const lamp = el("span", { className: "tc-lamp" });
  const verdictEl = el("span", { className: "tc-verdict" }, "VERIFYING");
  const time = el("span", { className: "tc-time" });
  const reverify = el("button", { className: "tc-reverify", type: "button" }, "re-verify");
  const head = el("div", { className: "tc-head" }, [
    lamp,
    el("span", { className: "tc-title" }, "TAMPER SIGNAL · CONSOLE"),
    verdictEl,
    time,
    reverify,
  ]);
  const caveatStrip = el("div");
  const railWrap = el("div", { className: "tc-rail-wrap" });
  const breakSlot = el("div");
  const inspect = el("div", { className: "tc-inspect" });
  const logEntries = el("div");
  const log = el("div", { className: "tc-log" }, [
    el("div", { className: "l-head" }, "EVENT LOG · mirrors `receipts verify`"),
    logEntries,
  ]);
  const custody = el("div", { className: "tc-custody" });
  const root = el("div", { className: "tc" }, [head, caveatStrip, railWrap, breakSlot, inspect, custody, log]);
  root.dataset.state = "unverifiable";
  containerEl.appendChild(root);

  let destroyed = false;
  let timer = null;
  let activeNode = null;

  function inspectReceipt(receipt, card) {
    if (activeNode) activeNode.classList.remove("tc-active");
    activeNode = card;
    card.classList.add("tc-active");
    inspect.textContent = "";
    inspect.classList.add("open");
    const totals = totalsOf(receipt);
    const kv = (label, value) => el("div", { className: "kv" }, [el("b", {}, label), el("span", {}, value)]);
    inspect.append(
      el("div", { className: "kv" }, [
        el("b", {}, "stage"),
        el("span", {}, [stageNameOf(receipt), " ", el("span", { className: "hash" }, SHORT(outputHashOf(receipt)))]),
      ]),
      kv("kind", receipt.kind ?? "?"),
      kv("created", receipt.created_at ?? "?"),
      kv("rows out", String(totals.row_count ?? "?")),
    );
    if (receipt.kind === "transform_receipt") {
      inspect.append(
        kv("code file", receipt.transform?.code_file ?? "?"),
        kv("code hash", SHORT(receipt.transform?.code_hash)),
      );
    }
    if (receipt.signature?.key_fingerprint) {
      inspect.append(kv("signed by", receipt.signature.key_fingerprint));
    }
    inspect.append(
      el("details", {}, [
        el("summary", {}, "raw receipt JSON"),
        el("pre", {}, JSON.stringify(receipt, null, 2)),
      ])
    );
  }

  function render(result, durationMs) {
    root.dataset.state = result.state;
    verdictEl.textContent = {
      green: "GREEN · ALL LINKS VERIFIED",
      yellow: "YELLOW · VERIFIED WITH CAVEATS",
      red: "RED · CHAIN BROKEN",
      unverifiable: "UNVERIFIED",
    }[result.state];
    if (result.verifiedAt) {
      time.textContent = `verified ${result.verifiedAt.slice(11, 19)}Z`;
    }

    // Caveat strip (yellow only; gaps are also drawn on the rail).
    caveatStrip.textContent = "";
    if (result.state === "yellow") {
      caveatStrip.appendChild(
        el("div", { className: "tc-caveats" }, "⚠ " + result.caveats.join(" · "))
      );
    }

    // Pipeline rail.
    railWrap.textContent = "";
    breakSlot.textContent = "";
    inspect.classList.remove("open");
    activeNode = null;
    if (result.state !== "unverifiable" && result.receipts?.length) {
      const rail = el("div", { className: "tc-rail" });
      const gaps = gapPositions(result);
      const lr = result.linkResult;
      result.receipts.forEach((receipt, i) => {
        if (i > 0) {
          const broken = lr && lr.ok === false && lr.brokenAt === i;
          const link = el("div", { className: `tc-link${broken ? " tc-broken" : ""}` }, [
            el("span", { className: "l-line" }, broken ? "──✗⚡✗──" : "───▶"),
            el("span", { className: "l-hash" },
              broken ? "link severed" : `carries ${SHORT(inputHashOf(receipt))}`),
          ]);
          rail.appendChild(link);
        }
        const totals = totalsOf(receipt);
        const card = el("div", { className: "tc-node" }, [
          el("div", { className: "n-kind" }, receipt.kind === "source_manifest" ? "source" : "transform"),
          el("div", { className: "n-name" }, stageNameOf(receipt)),
          el("div", { className: "n-row" }, [
            "out ", el("span", { className: "hash" }, SHORT(outputHashOf(receipt))),
          ]),
          el("div", { className: "n-row" }, [
            `rows ${totals.row_count ?? "?"} · sig `,
            el("span", { className: "ok" }, result.signaturesValid ? "✓" : "?"),
          ]),
        ]);
        card.addEventListener("click", () => inspectReceipt(receipt, card));
        rail.appendChild(card);

        if (gaps.has(i)) {
          rail.appendChild(el("div", { className: "tc-link tc-gap" }, [
            el("span", { className: "l-line" }, "┄┄?┄┄"),
            el("span", { className: "l-hash" }, "coverage gap"),
          ]));
          rail.appendChild(el("div", { className: "tc-node tc-ghost" }, [
            el("div", { className: "n-kind" }, "missing"),
            el("div", { className: "n-name" }, "no receipt emitted"),
            el("div", { className: "n-row" }, gaps.get(i)),
          ]));
        }
      });
      railWrap.appendChild(rail);

      // Break card pinned at the break.
      if (lr && lr.ok === false) {
        breakSlot.appendChild(el("div", { className: "tc-break" }, [
          el("h4", {}, `✗ break at link ${lr.brokenAt - 1} -> ${lr.brokenAt} (${lr.brokenStage})`),
          el("div", { className: "kv" }, [
            el("b", {}, "expected"),
            el("span", {}, [el("span", { className: "hash" }, SHORT(lr.expected)),
              ` (output of ${stageNameOf(result.receipts[lr.brokenAt - 1])}, signed)`]),
          ]),
          el("div", { className: "kv" }, [
            el("b", {}, "found"),
            el("span", { className: "bad" }, SHORT(lr.found)),
          ]),
          lr.delta?.length
            ? el("div", { className: "delta" }, `totals delta vs upstream: ${lr.delta.join(" · ")}`)
            : null,
        ]));
      }
    }

    // Event log entry, newest first.
    const stamp = (result.verifiedAt ?? new Date().toISOString()).slice(11, 19);
    const entry = el("div", { className: "entry" });
    entry.appendChild(el("span", { className: "t-faint" }, `${stamp}Z $ verify (${durationMs}ms)\n`));
    for (const [cls, text] of cliLines(result)) {
      entry.appendChild(el("span", { className: cls }, text + "\n"));
    }
    logEntries.prepend(entry);
  }

  const timelineUrl =
    opts.timeline || new URL("timeline.json", new URL(chainUrl, window.location.href)).href;

  // The chain-of-custody timeline. ADDITIVE: it never feeds the verdict above
  // (R16). It fetches the published timeline.json and renders it only when the
  // document is bound to the chain we just verified (chain_tail must match the
  // verified chain's tail receipt hash), so a timeline.json from another chain
  // is rejected rather than rendered as authoritative provenance.
  async function renderCustody(result) {
    custody.textContent = "";
    if (result.state === "unverifiable" || !result.chain) return;
    let timeline;
    try {
      const resp = await fetch(timelineUrl, { cache: "no-store" });
      if (!resp.ok) return; // no timeline published; nothing to show, verdict unaffected
      timeline = await resp.json();
    } catch {
      return; // timeline is optional; its absence is not a verdict signal
    }
    if (destroyed) return;
    const files = result.chain.receipts || [];
    const tail = files.length ? (result.chain.receipt_hashes || {})[files[files.length - 1]] : "";
    custody.appendChild(el("div", { className: "tc-custody-head" }, "CHAIN OF CUSTODY · provenance"));
    // Treat absent/empty the same on both sides so legacy chains that record no
    // receipt_hashes (tail undefined, timeline chain_tail "") are not falsely
    // flagged as mismatched.
    if (!timeline || timeline.kind !== "timeline" || (timeline.chain_tail || "") !== (tail || "")) {
      custody.appendChild(
        el("div", { className: "tc-custody-warn" }, "⚠ timeline.json does not match this chain; not shown")
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
      custody.appendChild(
        el("div", { className: "tc-custody-warn" }, "⚠ timeline.json signature does not verify; not shown")
      );
      return;
    }
    const list = el("div", { className: "tc-custody-list" });
    for (const entry of timeline.entries || []) {
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
    custody.appendChild(list);
  }

  async function refresh() {
    const started = performance.now();
    const result = await verifyReceipts(chainUrl, opts.pubKey, { warnDrift: opts.warnDrift });
    if (destroyed) return result;
    render(result, Math.round(performance.now() - started));
    // Additive layer, after the verdict has already rendered from chain.json.
    await renderCustody(result);
    return result;
  }

  reverify.addEventListener("click", refresh);
  const ready = refresh();
  if (opts.watch) timer = setInterval(refresh, Math.max(1000, Number(opts.watch) || 0));

  return {
    el: root,
    ready,
    refresh,
    destroy() {
      destroyed = true;
      if (timer) clearInterval(timer);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
