// Express/Connect attach helper: serve the receipts directory and the browser
// surfaces in one call. Framework-free internally (plain (req, res, next)
// handlers), so it also works with Connect, Polka, or bare http routers that
// accept middleware.
//
//   import express from "express";
//   import { tamperSignal } from "tamper-signal/express";
//
//   const app = express();
//   const signal = tamperSignal(app, { receiptsDir: "receipts/" });
//   // serve signal.snippet once in your layout, or add the script tag by hand
//
// The npm package ships the browser files; they are served from the package
// itself, side by side, so their relative imports resolve.

import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_NAMES = ["badge.js", "light.js", "element.js", "table.js"];
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

export function signalSnippet(chainUrl = "/receipts/chain.json", { assetsPrefix = "/tamper-signal", selector = "header" } = {}) {
  return (
    `<script type="module">` +
    `import { mountTamperSignal } from "${assetsPrefix}/light.js"; ` +
    `mountTamperSignal(document.querySelector(${JSON.stringify(selector)}) ?? document.body, ${JSON.stringify(chainUrl)});` +
    `</script>`
  );
}

export function tamperSignal(app, {
  receiptsDir = "receipts/",
  urlPrefix = "/receipts",
  assetsPrefix = "/tamper-signal",
  selector = "header",
} = {}) {
  app.use(urlPrefix, receiptsMiddleware({ receiptsDir }));
  app.use(assetsPrefix, assetsMiddleware());
  const chainUrl = `${urlPrefix}/chain.json`;
  return {
    chainUrl,
    assetsPrefix,
    snippet: signalSnippet(chainUrl, { assetsPrefix, selector }),
  };
}
