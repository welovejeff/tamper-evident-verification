// Express/Connect attach helper: serve the receipts directory, the browser
// surfaces, and the Signal Room in one call. Framework-free internally (plain
// (req, res, next) handlers), so it also works with Connect, Polka, or bare
// http routers that accept middleware.
//
//   import express from "express";
//   import { tamperSignal } from "tamper-signal/express";
//
//   const app = express();
//   const signal = tamperSignal(app, { receiptsDir: "receipts/" });
//   // serve signal.snippet once in your layout, or add the script tag by hand
//
// One call serves three things: the receipts directory, the browser assets,
// and the room page at `${assetsPrefix}/receipts` — and the returned snippet
// pre-wires the light's receiptsHref to that page. You structurally cannot
// ship the light without a live room behind it. Opt out with { room: false }
// (not recommended; the light will link to raw JSON).
//
// The npm package ships the browser files; they are served from the package
// itself, side by side, so their relative imports resolve.

import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_NAMES = ["badge.js", "light.js", "element.js", "table.js", "console.js", "room.js"];
const ASSET_DIR = fileURLToPath(new URL("../badge/", import.meta.url));

const TYPES = { ".json": "application/json", ".js": "text/javascript", ".pub": "text/plain" };

function send(res, path) {
  const ext = path.slice(path.lastIndexOf("."));
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  createReadStream(path).pipe(res);
}

// Middleware serving one directory, confined: no traversal, files only.
export function receiptsMiddleware({ receiptsDir = "receipts/" } = {}) {
  const base = resolve(receiptsDir);
  return function tamperSignalReceipts(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const name = decodeURIComponent(req.url.split("?")[0].replace(/^\/+/, ""));
    const target = resolve(base, name);
    // Confine to the directory and its direct files (receipts are flat).
    if (!name || target !== join(base, basename(name)) || !existsSync(target) || !statSync(target).isFile()) {
      return next();
    }
    send(res, target);
  };
}

// Middleware serving the bundled browser assets from the npm package.
export function assetsMiddleware() {
  return function tamperSignalAssets(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const name = decodeURIComponent(req.url.split("?")[0].replace(/^\/+/, ""));
    if (!ASSET_NAMES.includes(name)) return next();
    send(res, join(ASSET_DIR, name));
  };
}

// The attach-level verification policy (trusted keys, warn-drift) must reach
// EVERY mount the helper emits, or the pill and the room could disagree about
// the same chain (and their verifyReceipts calls would stop coalescing).
function trustedKeys(pubKey) {
  if (!pubKey) return undefined;
  return Array.isArray(pubKey) ? pubKey : [pubKey];
}

export function signalSnippet(
  chainUrl = "/receipts/chain.json",
  { assetsPrefix = "/tamper-signal", selector = "header", receiptsHref, pubKey, warnDrift = false } = {},
) {
  const keys = trustedKeys(pubKey);
  const optPairs = [];
  if (receiptsHref) optPairs.push(`receiptsHref: ${JSON.stringify(receiptsHref)}`);
  if (warnDrift) optPairs.push("warnDrift: true");
  let extra = "";
  if (keys || optPairs.length) {
    extra = `, ${keys ? JSON.stringify(keys) : "undefined"}`;
    if (optPairs.length) extra += `, { ${optPairs.join(", ")} }`;
  }
  return (
    `<script type="module">` +
    `import { mountTamperSignal } from "${assetsPrefix}/light.js"; ` +
    `mountTamperSignal(document.querySelector(${JSON.stringify(selector)}) ?? document.body, ${JSON.stringify(chainUrl)}${extra});` +
    `</script>`
  );
}

export function roomSnippet(
  chainUrl = "/receipts/chain.json",
  { assetsPrefix = "/tamper-signal", selector = "#tamper-signal-room", strict = false, pubKey, warnDrift = false } = {},
) {
  // An inline embedded-density room, for hosts that render their own Data tab.
  const keys = trustedKeys(pubKey);
  return (
    `<script type="module">` +
    `import { mountSignalRoom } from "${assetsPrefix}/room.js"; ` +
    `mountSignalRoom(document.querySelector(${JSON.stringify(selector)}) ?? document.body, ${JSON.stringify(chainUrl)}, ` +
    `${keys ? JSON.stringify(keys) : "undefined"}, ` +
    `{ strict: ${JSON.stringify(Boolean(strict))}, warnDrift: ${JSON.stringify(Boolean(warnDrift))} });` +
    `</script>`
  );
}

export function consoleSnippet(
  chainUrl = "/receipts/chain.json",
  { assetsPrefix = "/tamper-signal", selector = "#tamper-signal-console" } = {},
) {
  // Deprecated alias: the console is a preset of the room since 2.1.
  return (
    `<script type="module">` +
    `import { mountReceiptConsole } from "${assetsPrefix}/console.js"; ` +
    `mountReceiptConsole(document.querySelector(${JSON.stringify(selector)}) ?? document.body, ${JSON.stringify(chainUrl)});` +
    `</script>`
  );
}

export function roomPage(
  chainUrl = "/receipts/chain.json",
  { assetsPrefix = "/tamper-signal", preset = "room", strict = false, pubKey, warnDrift = false } = {},
) {
  // The served room honors ?focus=auto and hash deep links itself (page
  // density); the attach-level options are baked in so the light snippet and
  // this page can never disagree about keys or drift.
  const keys = pubKey ? (Array.isArray(pubKey) ? pubKey : [pubKey]) : undefined;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tamper Signal room</title>
<style>body{margin:0;background:#07090d;padding:24px}</style></head>
<body><div id="room"></div>
<script type="module">
import { mountSignalRoom } from "${assetsPrefix}/room.js";
mountSignalRoom(document.getElementById("room"), ${JSON.stringify(chainUrl)}, ${JSON.stringify(keys)}, {
  density: "page",
  preset: ${JSON.stringify(preset)},
  strict: ${JSON.stringify(Boolean(strict))},
  warnDrift: ${JSON.stringify(Boolean(warnDrift))},
});
</script></body></html>
`;
}

export function consolePage(chainUrl = "/receipts/chain.json", { assetsPrefix = "/tamper-signal" } = {}) {
  // Deprecated alias: the console route serves the room with its rail open.
  return roomPage(chainUrl, { assetsPrefix, preset: "console" });
}

export function tamperSignal(app, {
  receiptsDir = "receipts/",
  urlPrefix = "/receipts",
  assetsPrefix = "/tamper-signal",
  selector = "header",
  room = true,
  strict = false,
  pubKey,
  warnDrift = false,
} = {}) {
  const chainUrl = `${urlPrefix}/chain.json`;
  const roomUrl = `${assetsPrefix}/receipts`;
  app.use(urlPrefix, receiptsMiddleware({ receiptsDir }));
  if (room) {
    app.use(assetsPrefix, function tamperSignalRoom(req, res, next) {
      const name = decodeURIComponent(req.url.split("?")[0].replace(/^\/+/, ""));
      if ((req.method !== "GET" && req.method !== "HEAD") || (name !== "receipts" && name !== "console")) {
        return next();
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(roomPage(chainUrl, {
        assetsPrefix,
        preset: name === "console" ? "console" : "room",
        strict,
        pubKey,
        warnDrift,
      }));
    });
  }
  app.use(assetsPrefix, assetsMiddleware());
  const receiptsHref = room ? `${roomUrl}?focus=auto` : undefined;
  return {
    chainUrl,
    assetsPrefix,
    roomUrl,
    consoleUrl: `${assetsPrefix}/console`,
    roomSnippet: roomSnippet(chainUrl, { assetsPrefix, strict, pubKey, warnDrift }),
    consoleSnippet: consoleSnippet(chainUrl, { assetsPrefix }),
    snippet: signalSnippet(chainUrl, { assetsPrefix, selector, receiptsHref, pubKey, warnDrift }),
  };
}
