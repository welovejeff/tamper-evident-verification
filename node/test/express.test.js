// The Express attach helper, exercised framework-free with mock req/res.

import assert from "node:assert/strict";
import { test } from "node:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assetsMiddleware, receiptsMiddleware, signalSnippet, tamperSignal } from "../express.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const intactDir = join(repoRoot, "examples", "chains", "intact");

function run(middleware, url) {
  return new Promise((resolve) => {
    const chunks = [];
    let nexted = false;
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      write(c) { chunks.push(c); },
      end(c) { if (c) chunks.push(c); resolve({ res: this, body: Buffer.concat(chunks.map(Buffer.from)).toString(), nexted }); },
      emit() {},
      on() {},
      once() {},
      removeListener() {},
    };
    middleware({ method: "GET", url }, res, () => { nexted = true; resolve({ res, body: "", nexted: true }); });
  });
}

test("receiptsMiddleware serves chain.json with no-store", async () => {
  const { res, body, nexted } = await run(receiptsMiddleware({ receiptsDir: intactDir }), "/chain.json");
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/json");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.ok(JSON.parse(body).receipts.length >= 1);
});

test("receiptsMiddleware refuses traversal and missing files", async () => {
  assert.equal((await run(receiptsMiddleware({ receiptsDir: intactDir }), "/../../package.json")).nexted, true);
  assert.equal((await run(receiptsMiddleware({ receiptsDir: intactDir }), "/nope.json")).nexted, true);
});

test("receiptsMiddleware never serves history/ snapshots (flat files only)", async () => {
  // The fixture dir carries a real history/ snapshot; the middleware's
  // flat-file confinement must keep it unpublished (U4: serve excludes
  // history in both stacks).
  const parityDir = join(repoRoot, "tests", "fixtures", "snapshot-parity");
  const { readdirSync } = await import("node:fs");
  const [snapshotName] = readdirSync(join(parityDir, "history"));
  const middleware = receiptsMiddleware({ receiptsDir: parityDir });
  assert.equal((await run(middleware, `/history/${snapshotName}`)).nexted, true);
  assert.equal((await run(middleware, "/history/")).nexted, true);
  // The flat receipt files still serve.
  assert.equal((await run(middleware, "/chain.json")).res.statusCode, 200);
});

test("assetsMiddleware serves only the bundled surfaces", async () => {
  const { res, body } = await run(assetsMiddleware(), "/light.js");
  assert.equal(res.statusCode, 200);
  assert.match(body, /mountTamperSignal/);
  assert.equal((await run(assetsMiddleware(), "/evil.js")).nexted, true);
});

test("tamperSignal wires an app and returns the snippet", () => {
  const uses = [];
  const app = { use: (prefix, fn) => uses.push([prefix, fn.name]) };
  const handle = tamperSignal(app, { receiptsDir: intactDir });
  assert.deepEqual(uses.map(([p]) => p), ["/receipts", "/tamper-signal", "/tamper-signal"]);
  assert.equal(handle.chainUrl, "/receipts/chain.json");
  assert.match(handle.snippet, /mountTamperSignal/);
  assert.match(signalSnippet(), /light\.js/);
});

test("tamperSignal serves the console page", async () => {
  const handlers = [];
  const app = { use: (prefix, fn) => handlers.push([prefix, fn]) };
  const handle = tamperSignal(app, { receiptsDir: intactDir });
  assert.equal(handle.consoleUrl, "/tamper-signal/console");
  const consoleHandler = handlers.find(([p, f]) => p === "/tamper-signal" && f.name === "tamperSignalConsole")[1];
  const { res, body } = await run(consoleHandler, "/console");
  assert.equal(res.statusCode, 200);
  assert.match(body, /mountReceiptConsole/);
});
