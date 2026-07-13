// The Signal Room's emission contract and per-verdict shape, driven against
// the committed fixture chains under a minimal DOM stub. The contract is
// preserved exactly from the old table.js and promoted to room level: detail
// {state, attested, strict} where state is the CHAIN verdict and attested the
// byte-identity boolean — red-stale emits its chain state with
// attested:false, and the documented host gate
// `strict && (state === "red" || !attested)` keeps working unchanged.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { evidenceHash, semanticHash } from "../canonical.js";
import { generateKeys, loadPrivateKey, publicHexFromPrivate } from "../keys.js";
import { loadCsv } from "../load.js";
import {
  SOURCE_RECEIPT_NAME,
  buildSourceManifest,
  buildTransformReceipt,
  writeChain,
  writeReceipt,
} from "../receipts.js";
import { installDom } from "./domstub.js";

installDom();

const { ed25519Available, invalidateVerification, VOCAB } = await import("../../badge/badge.js");
const { mountSignalRoom } = await import("../../badge/room.js");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chains = (name) => join(repoRoot, "examples", "chains", name);

function serve(dir) {
  invalidateVerification();
  globalThis.fetch = async (url) => {
    const name = decodeURIComponent(String(url).split("?")[0].split("/").pop());
    let buf;
    try {
      buf = readFileSync(join(dir, name));
    } catch (_e) {
      return { ok: false, status: 404, json: async () => { throw new Error("404"); } };
    }
    return {
      ok: true,
      json: async () => JSON.parse(buf.toString("utf-8")),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
}

async function mountAndSettle(dir, opts = {}) {
  serve(dir);
  const { body } = installDom();
  const states = [];
  const events = [];
  body.addEventListener("tamper-signal:state", (e) => events.push(e.detail));
  const container = document.createElement("div");
  body.appendChild(container);
  const handle = mountSignalRoom(container, "chain.json", {
    strict: true,
    onState: (detail) => states.push(detail),
    ...opts,
  });
  await handle.ready;
  return { handle, container, states, events, body };
}

const available = await ed25519Available();

test("intact chain + attested table: green, attested, boss-quiet", { skip: !available }, async () => {
  const { handle, states, events } = await mountAndSettle(chains("intact"));
  assert.deepEqual(states.at(-1), { state: "green", attested: true, strict: true });
  assert.deepEqual(events.at(-1), states.at(-1)); // the bubbling event carries the same detail
  assert.equal(handle.getState(), "green");
  const root = handle.el;
  assert.equal(root.dataset.state, "green");
  assert.match(root.textContent, new RegExp(VOCAB.verdicts.green));
  // Green earns silence: no headline band, drawers closed, tagline shown.
  assert.equal(root.querySelector(".tsr-break"), null);
  assert.equal(root.querySelector(".tsr-caveat"), null);
  assert.match(root.textContent, /The light is green, the data is clean\./);
  handle.destroy();
});

test("stale table: chain state emitted with attested:false, strip says NOT THE ATTESTED DATA", { skip: !available }, async () => {
  const { handle, states } = await mountAndSettle(chains("intact"), {
    tableUrl: "table-tampered.json",
  });
  // The chain verdict is green; the byte-identity boolean is what gates.
  assert.deepEqual(states.at(-1), { state: "green", attested: false, strict: true });
  assert.equal(handle.getState(), "red-stale");
  const root = handle.el;
  assert.match(root.textContent, /NOT THE ATTESTED DATA/);
  assert.match(root.textContent, /the chain verifies; the published table does not match its tail/);
  // Never the severed-link grammar for a build-behind state.
  assert.ok(!root.textContent.includes("⚡"), "red-stale must not wear the severed-link glyph");
  handle.destroy();
});

test("tampered fixture (rewritten receipt): red with the reason card", { skip: !available }, async () => {
  const { handle, states } = await mountAndSettle(chains("tampered"));
  // attested is ALWAYS false at red: a byte-match against the tail of a
  // broken chain is a hollow claim.
  assert.deepEqual(states.at(-1), { state: "red", attested: false, strict: true });
  assert.equal(handle.getState(), "red");
  const root = handle.el;
  assert.match(root.textContent, new RegExp(VOCAB.verdicts.red));
  assert.match(root.textContent, /receipt file mismatch/);
  handle.destroy();
});

// A genuine severed link: both receipts validly signed and hash-recorded, but
// the transform's declared input is not the source's output.
function buildLinkBrokenChainDir() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-room-break-"));
  const keys = join(dir, "keys");
  const chainDir = join(dir, "receipts");
  generateKeys(keys);
  const privateKey = loadPrivateKey(join(keys, "signing.key"));
  const publicHex = publicHexFromPrivate(privateKey);
  const csv = "date,campaign_name,spend_usd\n2026-05-01,a,10.50\n2026-05-02,b,20.00\n";
  const csvPath = join(dir, "export.csv");
  writeFileSync(csvPath, csv);
  const records = loadCsv(csvPath);
  const manifest = buildSourceManifest({
    filename: "export.csv",
    evidenceHash: evidenceHash(Buffer.from(csv)),
    byteSize: csv.length,
    declaredOrigin: "room break test",
    semanticHash: semanticHash(records),
    records,
    privateKey,
  });
  writeReceipt(chainDir, SOURCE_RECEIPT_NAME, manifest);
  const dropped = records.slice(0, 1); // rows silently dropped between stages
  const transform = buildTransformReceipt({
    name: "transform_clean",
    codeHash: "c".repeat(64),
    codeFile: "clean.js",
    inputSemanticHash: semanticHash(dropped), // != the source's output hash
    outputSemanticHash: semanticHash(dropped),
    outputRecords: dropped,
    privateKey,
  });
  writeReceipt(chainDir, "001_transform_clean.json", transform);
  writeChain(chainDir, [SOURCE_RECEIPT_NAME, "001_transform_clean.json"], publicHex);
  return chainDir;
}

test("severed link: break exhibit leads with business numbers, rail severed", { skip: !available }, async () => {
  const { handle, states } = await mountAndSettle(buildLinkBrokenChainDir());
  assert.deepEqual(states.at(-1), { state: "red", attested: false, strict: true });
  const root = handle.el;
  const exhibit = root.querySelector("#tsr-break");
  assert.notEqual(exhibit, null);
  assert.match(exhibit.textContent, /break at link 0 -> 1/);
  assert.match(exhibit.textContent, /expected/);
  assert.match(exhibit.textContent, /found/);
  assert.match(exhibit.textContent, /rows/); // the business-numbers grid
  // The rail auto-expands with the severed-link grammar at the break.
  assert.notEqual(root.querySelector(".tsr-link.broken"), null);
  assert.ok(root.textContent.includes("⚡"));
  assert.equal(handle.open("break"), true); // verdict-gated hint agrees
  handle.destroy();
});

test("coverage gap: yellow, located caveat card, ghost node in the rail", { skip: !available }, async () => {
  const { handle, states } = await mountAndSettle(chains("gap"));
  assert.equal(states.at(-1).state, "yellow");
  assert.equal(handle.getState(), "yellow");
  const root = handle.el;
  const caveat = root.querySelector(".tsr-caveat");
  assert.notEqual(caveat, null);
  assert.match(caveat.textContent, /coverage gap/);
  handle.open("rail");
  assert.notEqual(root.querySelector(".tsr-node.ghost"), null);
  handle.destroy();
});

test("missing table.json is not a verdict: chain renders, plane shows the grey slab", { skip: !available }, async () => {
  const { handle, states } = await mountAndSettle(chains("intact"), {
    tableUrl: "no-such-table.json",
  });
  assert.deepEqual(states.at(-1), { state: "green", attested: false, strict: true });
  assert.equal(handle.getState(), "green"); // absence is not tampering
  const root = handle.el;
  assert.match(root.textContent, /NO ATTESTED TABLE PUBLISHED/);
  assert.match(root.textContent, new RegExp(VOCAB.verdicts.green));
  handle.destroy();
});

test("deep links are verdict-gated: a break hint on a green chain is ignored", { skip: !available }, async () => {
  const { handle } = await mountAndSettle(chains("intact"));
  assert.equal(handle.open("break"), false);
  assert.equal(handle.open("custody"), true); // drawers open regardless of verdict
  handle.destroy();
});
