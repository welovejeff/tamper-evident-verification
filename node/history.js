// Run snapshots: the durable memory of CLI-verified runs. The Node port of
// tamper_signal/history.py; snapshot bodies are byte-identical across stacks
// (same canonicalization, same key semantics, same created_at format), so a
// snapshot written by either CLI loads and verifies in the other.
//
// Every CLI verify with a non-red final verdict archives a compact run
// snapshot to `<chain dir>/history/`. Snapshots are content-addressed (the
// filename is the sha256 of the body's canonical JCS bytes) and signed when a
// private key is available, written unsigned otherwise. History is honestly
// weaker evidence than the chain: snapshots sit outside chain.json's
// receipt_hashes and anchoring.
//
// Programmatic note: verifyChain stays side-effect-free by design. API users
// who want run history call writeRunSnapshot (or archiveRunSnapshot)
// explicitly; only the CLI verify and rebuildChain write snapshots for you.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { canonicalJsonBytes, codePointCompare } from "./canonical.js";
import {
  SPEC_VERSION,
  nowIso,
  receiptFileHashes,
  signBody,
  stageNameOf,
  totalsOf,
  verifySignature,
} from "./receipts.js";

export const HISTORY_DIRNAME = "history";

// A snapshot whose created_at is further in the future than this many seconds
// (relative to the reading clock) is treated as unverifiable and skipped.
export const FUTURE_SKEW_SECONDS = 300;

const noNotice = () => {};

function snapshotBody(snapshot) {
  const body = {};
  for (const k of Object.keys(snapshot)) if (k !== "signature") body[k] = snapshot[k];
  return body;
}

// sha256 hex of the snapshot body's canonical bytes (the filename stem).
export function snapshotBodyHash(snapshot) {
  return createHash("sha256").update(canonicalJsonBytes(snapshotBody(snapshot))).digest("hex");
}

// The sha256 already recorded in chain.json for the LAST receipt file. This
// is the snapshot's link back to the run it describes: the same hash
// chain.json records under receipt_hashes (sha256 of the receipt file's raw
// bytes). Chains written before receipt hashes were recorded fall back to
// computing the identical hash from the file on disk.
export function chainTailHash(chainDir, chain) {
  const names = chain !== null && typeof chain === "object" && Array.isArray(chain.receipts) ? chain.receipts : [];
  if (!names.length) throw new Error("chain.json lists no receipts");
  const last = names[names.length - 1];
  if (typeof last !== "string") throw new Error("chain.json receipt entries are not filenames");
  const recorded = chain.receipt_hashes;
  if (recorded !== null && typeof recorded === "object" && typeof recorded[last] === "string") {
    return recorded[last];
  }
  return receiptFileHashes(chainDir, [last])[last];
}

// Sorted normalized column names visible in the source control totals.
// Control totals do not record a full column list, so this is the union of
// the column-keyed maps (numeric_sums, date_ranges, null_counts) plus the
// bucket column, which can otherwise be absent from all three (an ISO-string
// date column is neither numeric nor a typed-date range).
function sourceColumns(totals) {
  const names = new Set();
  for (const key of ["numeric_sums", "date_ranges", "null_counts"]) {
    const value = totals[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const k of Object.keys(value)) names.add(String(k));
    }
  }
  if (typeof totals.bucket_column === "string") names.add(totals.bucket_column);
  return [...names].sort(codePointCompare);
}

const strAt = (receipt, keys, fallback) => {
  let cur = receipt;
  for (const key of keys) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !(key in cur)) return fallback;
    cur = cur[key];
  }
  return typeof cur === "string" ? cur : fallback;
};

// Per-stage identity and totals in the snapshot's stage shape. Shared by
// buildRunSnapshot and `tamper-signal diff`'s chain-dir adapter so a live
// chain and an archived snapshot always compare in the same shape:
// [{name, kind, code_hash?, code_file?, totals}]. Mirrors history.py
// run_stages byte-for-byte.
export function runStages(receipts) {
  return receipts.map((receipt) => {
    const kind = receipt !== null && typeof receipt === "object" && typeof receipt.kind === "string" ? receipt.kind : null;
    const stage = {
      name: stageNameOf(receipt),
      kind,
      totals: totalsOf(receipt),
    };
    if (kind === "transform_receipt") {
      const codeHash = strAt(receipt, ["transform", "code_hash"], "");
      if (codeHash) stage.code_hash = codeHash;
      const codeFile = strAt(receipt, ["transform", "code_file"], "");
      if (codeFile) stage.code_file = codeFile;
    }
    return stage;
  });
}

// Source identity in the snapshot's source shape (filename, origin, columns).
// Mirrors history.py run_source.
export function runSource(receipts) {
  const source = receipts.length ? receipts[0] : {};
  return {
    filename: strAt(source, ["source", "filename"], ""),
    declared_origin: strAt(source, ["source", "declared_origin"], ""),
    columns: sourceColumns(totalsOf(source)),
  };
}

// Build a run snapshot body from a verified chain; sign it when keyed.
// `chainDir` is only needed for chains that record no receipt_hashes (the
// tail hash is then computed from the last receipt file). `createdAt` exists
// for tests and fixtures; production callers take the clock. Mirrors
// tamper_signal/history.py build_run_snapshot byte-for-byte for the body.
export function buildRunSnapshot(receipts, chain, { privateKey = null, chainDir = null, createdAt = null } = {}) {
  const source = receipts.length ? receipts[0] : {};

  const body = {
    kind: "run_snapshot",
    spec_version: SPEC_VERSION,
    created_at: createdAt ?? nowIso(),
    chain_tail_hash: chainTailHash(chainDir ?? ".", chain),
    source: runSource(receipts),
    stages: runStages(receipts),
  };
  const tolerance = source !== null && typeof source === "object" ? source.tolerance : undefined;
  if (tolerance !== null && typeof tolerance === "object" && !Array.isArray(tolerance)) {
    // DISPLAY-ONLY copy. Cross-run judgment (U6) reads the band from the
    // SIGNED source manifest in the chain, never from this snapshot copy: an
    // unsigned snapshot must not be able to relax a declared band.
    body.tolerance = tolerance;
  }
  return privateKey !== null ? signBody(body, privateKey) : body;
}

// Write a snapshot to <chainDir>/history/<body-hash>.json; return the path.
// Content-addressed: concurrent writers of the same run produce the same
// filename, and an existing file is left untouched (duplicate writes are
// harmless by construction).
export function writeRunSnapshot(chainDir, snapshot) {
  const history = join(chainDir, HISTORY_DIRNAME);
  mkdirSync(history, { recursive: true });
  const path = join(history, `${snapshotBodyHash(snapshot)}.json`);
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  return path;
}

function parseCreatedAt(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

// Load and validate run snapshots, newest first. Returns one item per usable
// snapshot: { filename, path, snapshot, created_at, body_hash, signed,
// verified }. `verified` is true only for signed snapshots whose signature
// verifies under one of `trustedKeys` (callers include the chain's embedded
// key); unsigned snapshots are usable but marked weaker.
//
// Defensive by contract: garbage JSON, non-snapshot files, unverifiable
// signatures, future timestamps, and paths that resolve outside the history
// directory are skipped with a notice. Never throws for bad content.
export function loadSnapshots(chainDir, { trustedKeys = [], now = null, onNotice = null } = {}) {
  const notice = onNotice ?? noNotice;
  const history = join(chainDir, HISTORY_DIRNAME);
  if (!existsSync(history)) return [];
  let base;
  let names;
  try {
    base = realpathSync(history);
    names = readdirSync(history).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const nowMs = now ?? Date.now();
  const horizon = nowMs + FUTURE_SKEW_SECONDS * 1000;
  const keys = trustedKeys.filter((k) => typeof k === "string" && k);

  const items = [];
  for (const name of names) {
    // Mirror readReceipt's confinement: a symlink placed in history/ must
    // not make the scanner read outside it.
    let resolved;
    try {
      resolved = realpathSync(join(history, name));
    } catch {
      notice(`run history: skipping unreadable snapshot ${name}`);
      continue;
    }
    if (dirname(resolved) !== base) {
      notice(`run history: skipping ${name}: resolves outside the history directory`);
      continue;
    }
    let snapshot;
    try {
      snapshot = JSON.parse(readFileSync(resolved, "utf-8"));
    } catch (err) {
      notice(`run history: skipping unreadable snapshot ${name}: ${err.message}`);
      continue;
    }
    if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.kind !== "run_snapshot") {
      notice(`run history: skipping ${name}: not a run snapshot`);
      continue;
    }
    const createdMs = parseCreatedAt(snapshot.created_at);
    if (createdMs === null) {
      notice(`run history: skipping ${name}: missing or malformed created_at`);
      continue;
    }
    if (createdMs > horizon) {
      notice(`run history: skipping ${name}: created_at ${snapshot.created_at} is in the future`);
      continue;
    }
    let bodyHash;
    try {
      bodyHash = snapshotBodyHash(snapshot);
    } catch {
      notice(`run history: skipping ${name}: body does not canonicalize`);
      continue;
    }
    const signed = snapshot.signature !== null && typeof snapshot.signature === "object";
    let verified = false;
    if (signed) {
      verified = keys.some((key) => verifySignature(snapshot, key));
      if (!verified) {
        notice(`run history: skipping ${name}: signature does not verify under any trusted key`);
        continue;
      }
    }
    items.push({
      filename: name,
      path: resolved,
      snapshot,
      created_at: snapshot.created_at,
      body_hash: bodyHash,
      signed,
      verified,
    });
  }

  // Newest first; equal created_at ties break on the body hash so both
  // stacks (and concurrent runs) agree on which snapshot is "latest".
  items.sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    if (a.body_hash !== b.body_hash) return a.body_hash < b.body_hash ? 1 : -1;
    return 0;
  });
  return items;
}

// The newest snapshot that passes validation, or null.
export function latestSnapshot(chainDir, options = {}) {
  const items = loadSnapshots(chainDir, options);
  return items.length ? items[0] : null;
}

// True when any usable snapshot records this chain tail hash.
export function historyHasTail(chainDir, tailHash, { trustedKeys = [] } = {}) {
  return loadSnapshots(chainDir, { trustedKeys }).some(
    (item) => item.snapshot.chain_tail_hash === tailHash
  );
}

// Build and write a run snapshot unless the latest one already covers it.
// Returns the written (or pre-existing) path, or null when the latest valid
// snapshot already records the same chain tail hash (re-verifying an
// unchanged run is a no-op). Throws on build/write failure; CLI callers
// catch everything and degrade to a stderr notice.
export function archiveRunSnapshot(chainDir, chain, receipts, { privateKey = null, trustedKeys = [], onNotice = null } = {}) {
  const tail = chainTailHash(chainDir, chain);
  const latest = latestSnapshot(chainDir, { trustedKeys, onNotice });
  if (latest !== null && latest.snapshot.chain_tail_hash === tail) return null;
  const snapshot = buildRunSnapshot(receipts, chain, { privateKey, chainDir });
  return writeRunSnapshot(chainDir, snapshot);
}
