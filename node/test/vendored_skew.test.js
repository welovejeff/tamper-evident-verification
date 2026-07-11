// Vendored-skew safety: the table.js/console.js shims dynamic-import room.js
// so a five-file vendored directory (pre-2.1) that gains the new shims but
// not room.js fails LOUDLY with the re-run-assets panel — never a silent
// half-render, never a static import error that takes the module down. And
// the new badge.js keeps every export the old vendored surfaces import, so an
// old directory beside a new badge.js still resolves.

import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { installDom } from "./domstub.js";

installDom();

const badgeDir = new URL("../../badge/", import.meta.url);

// A vendored dir in a real project sits under a package that declares ESM;
// Node 18 has no module-syntax detection, so a bare .js copy in a tmp dir
// would parse as CommonJS without this.
function vendorDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
  return dir;
}

test("table.js shim without room.js renders the loud panel and emits unverifiable", async () => {
  const dir = vendorDir("tamper-signal-skew-");
  copyFileSync(new URL("table.js", badgeDir), join(dir, "table.js"));
  // Deliberately NO room.js beside it.
  const { mountReceiptTable } = await import(pathToFileURL(join(dir, "table.js")).href);

  const { body } = installDom();
  const container = document.createElement("div");
  body.appendChild(container);
  const states = [];
  const handle = mountReceiptTable(container, "chain.json", {
    strict: true,
    onState: (detail) => states.push(detail),
  });
  await handle.ready;
  assert.match(container.textContent, /room\.js is missing/);
  assert.match(container.textContent, /tamper-signal assets/);
  assert.deepEqual(states.at(-1), { state: "unverifiable", attested: false, strict: true });
  handle.destroy();
});

test("console.js shim without room.js renders the loud panel", async () => {
  const dir = vendorDir("tamper-signal-skew-c-");
  copyFileSync(new URL("console.js", badgeDir), join(dir, "console.js"));
  const { mountReceiptConsole } = await import(pathToFileURL(join(dir, "console.js")).href);

  const { body } = installDom();
  const container = document.createElement("div");
  body.appendChild(container);
  const handle = mountReceiptConsole(container, "chain.json");
  await handle.ready;
  assert.match(container.textContent, /room\.js is missing/);
  handle.destroy();
});

test("new badge.js keeps every export the old vendored surfaces import", async () => {
  const badge = await import("../../badge/badge.js");
  // The union of the old light.js/table.js/console.js import lists.
  for (const name of [
    "verifyReceipts", "verifySignature", "canonicalize", "SHORT", "totalsOf",
    "stageNameOf", "outputHashOf", "inputHashOf", "totalsDelta", "loadChain",
    "coverageGaps", "checkSignatures", "evaluate", "ed25519Available",
    // 2.1 additions the room and shims rely on:
    "VOCAB", "TOKENS", "el", "changedColumns", "invalidateVerification",
  ]) {
    assert.ok(name in badge, `badge.js no longer exports ${name}`);
  }
});
