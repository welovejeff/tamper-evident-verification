#!/usr/bin/env node
// The JavaScript CLI for Tamper Signal. Mirrors the Python `receipts` CLI
// (which owns the short name); this binary installs as `tamper-signal`.
//
//   tamper-signal keygen --out keys/
//   tamper-signal ingest export.csv --origin "..." --key keys/signing.key --out receipts/
//   tamper-signal verify receipts/chain.json [--pub keys/signing.pub] [--data current.csv] [--warn-drift]
//   tamper-signal export receipts/chain.json --data current.csv [--out receipts/table.json]
//
// Exit codes are the traffic light: 0 green, 1 red, 2 yellow.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import process from "node:process";

import { canonicalDocument, canonicalJsonBytes, semanticHash } from "./canonical.js";
import { archiveRunSnapshot, chainTailHash, loadSnapshots, runSource, runStages } from "./history.js";
import { generateKeys, loadPrivateKey, loadPublicKeyHex, publicHexFromPrivate } from "./keys.js";
import { loadRecords } from "./load.js";
import {
  SOURCE_RECEIPT_NAME,
  outputHashOf,
  readChain,
  readReceipt,
  receiptFileHashes,
  stageNameOf,
  totalsOf,
  verifyChain,
} from "./receipts.js";
import { controlTotals, groupedNumericColumns, structuredTotalsDelta } from "./totals.js";
import { ingestFile } from "./wrapper.js";

const USAGE = `usage: tamper-signal <command>

commands:
  keygen --out keys/                         generate an Ed25519 signing keypair
  ingest <file> --origin "..." [--key keys/signing.key] [--out receipts/]
                [--band 5%] [--settle 72h] [--bucket-column <name>]
                                             create a signed source manifest
                                             (.csv, .tsv, .json, .ndjson);
                                             --band/--settle/--bucket-column
                                             sign a tolerance declaration into
                                             the manifest (band default 0.05,
                                             settle default 72h)
  verify <chain.json> [--pub key.pub ...] [--data <file>] [--warn-drift] [--json]
                                             verify a chain (exit 0 green, 1 red, 2 yellow)
  diff [A] [B] [--chain receipts/] [--json]  compare two runs: per-stage
                                             code-hash changes and totals
                                             deltas. A/B are chain directories
                                             or run-snapshot files; zero args
                                             compares the current chain to the
                                             latest differing archived
                                             snapshot; one arg compares that
                                             run to the current chain.
                                             Read-only; exit 0 with or without
                                             differences
  export <chain.json> --data <file> [--out receipts/table.json]
                                             write the canonical table document
                                             (refuses unless --data matches the
                                             final receipt)
`;

function cmdKeygen(args) {
  const { values } = parseArgs({ args, options: { out: { type: "string", default: "keys/" } } });
  const { privatePath, publicPath } = generateKeys(values.out);
  console.log(`Public key written to ${publicPath}`);
  console.error(`Private key written to ${privatePath}. Do not commit it.`);
  return 0;
}

function cmdIngest(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      origin: { type: "string", default: "" },
      key: { type: "string", default: "keys/signing.key" },
      out: { type: "string", default: "receipts/" },
      band: { type: "string" },
      settle: { type: "string" },
      "bucket-column": { type: "string" },
    },
  });
  const file = positionals[0];
  if (!file) {
    console.error("ingest: missing source file");
    return 1;
  }
  if (process.env.TAMPER_SIGNAL_KEY) {
    // The env var silently outranks --key; say so where it matters.
    console.error("Signing with TAMPER_SIGNAL_KEY from the environment (overrides --key)");
  }
  // ingestFile resets the chain to a fresh source manifest; the same call is
  // the programmatic entry point and the foundation of rebuildChain. Invalid
  // tolerance values and a non-qualifying --bucket-column throw before
  // anything is written; surface them as a clean error and exit 1.
  let manifest;
  let records;
  try {
    ({ manifest, records } = ingestFile({
      file,
      declaredOrigin: values.origin,
      chainDir: values.out,
      keyPath: values.key,
      band: values.band ?? null,
      settle: values.settle ?? null,
      bucketColumn: values["bucket-column"] ?? null,
    }));
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  const totals = manifest.control_totals;
  console.log(`Ingested ${basename(file)}`);
  console.log(`  evidence_hash ${manifest.source.evidence_hash}`);
  console.log(`  semantic_hash ${manifest.semantic_hash}`);
  console.log(`  rows ${totals.row_count}, columns ${totals.column_count}`);
  if (manifest.tolerance) {
    const t = manifest.tolerance;
    const extra = t.bucket_column ? `, bucket_column ${t.bucket_column}` : "";
    console.log(
      `  tolerance band ${t.band}, settle_hours ${t.settle_hours}${extra} (signed into the manifest)`
    );
  }
  console.log(`  source manifest -> ${values.out.replace(/\/?$/, "/")}${SOURCE_RECEIPT_NAME}`);

  // Surface columns that look numeric but were excluded from numeric_sums
  // because their values are comma/space-grouped. Left silent, a
  // data-receipt-column on these can never flag a change (see issue #21).
  const grouped = groupedNumericColumns(records);
  if (grouped.length) {
    console.error("");
    for (const { column, example } of grouped) {
      console.error(`  warning: column "${column}" looks numeric (e.g. "${example}") but is missing from numeric_sums.`);
    }
    console.error("  Grouped numbers don't parse as plain decimals, so these columns are left out of the control totals'");
    console.error("  numeric_sums -- a data-receipt-column on them can never flag a change. Add a normalize step that");
    console.error("  strips the separators before ingest. Only plain decimals (no thousands grouping) are summed.");
  }
  return 0;
}

function cmdVerify(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      pub: { type: "string", multiple: true },
      data: { type: "string" },
      "warn-drift": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const chainPath = positionals[0];
  if (!chainPath) {
    console.error("verify: missing path to chain.json");
    return 1;
  }
  const chain = readChain(chainPath);
  const chainDir = dirname(chainPath);
  let receipts;
  try {
    receipts = (chain.receipts ?? []).map((name) => readReceipt(chainDir, name));
  } catch (err) {
    console.error(`Cannot load chain: ${err.message}`);
    return 1;
  }

  const chainKey = chain.public_key;
  const publicHex = values.pub?.length ? values.pub.map(loadPublicKeyHex) : chainKey;
  if (Array.isArray(publicHex)) {
    // An empty key file must not silently shrink the trusted set: the
    // filtered-out key would fall back to the chain-embedded key instead.
    const empty = values.pub.filter((path, i) => !publicHex[i]);
    if (empty.length) {
      console.error(`Empty public key file passed to --pub: ${empty.join(", ")}`);
      return 1;
    }
  }
  if (!publicHex || (Array.isArray(publicHex) && !publicHex.length)) {
    console.error("No public key: pass --pub or embed one in chain.json");
    return 1;
  }

  let dataHash = null;
  let dataTotals = null;
  if (values.data) {
    const records = loadRecords(values.data);
    dataHash = semanticHash(records);
    dataTotals = controlTotals(records);
  }

  // Chains that record receipt hashes get them enforced; older chains skip.
  const recordedHashes =
    chain.receipt_hashes && typeof chain.receipt_hashes === "object" ? chain.receipt_hashes : null;
  const actualHashes = recordedHashes ? receiptFileHashes(chainDir, chain.receipts ?? []) : null;

  const result = verifyChain(receipts, publicHex, dataHash, dataTotals, {
    chainPublicHex: chainKey,
    receiptNames: chain.receipts ?? [],
    warnDrift: values["warn-drift"],
    recordedHashes,
    actualHashes,
  });
  const code = { green: 0, red: 1, yellow: 2 }[result.verdict];
  if (values.json) {
    // Same payload shape as the Python CLI's verify --json (AGENTS.md step 5).
    const payload = {
      verdict: result.verdict,
      exit_code: code,
      spec_version: chain.spec_version ?? null,
      receipts: receipts.length,
      transforms: receipts.filter((r) => r.kind === "transform_receipt").length,
      stages: receipts.map(stageNameOf),
      final_row_count: receipts.length ? (totalsOf(receipts[receipts.length - 1]).row_count ?? null) : null,
      caveats: result.caveats,
      broken_link: result.brokenLinkDetail,
      data_mismatch: result.dataMismatch,
      receipt_mismatch: result.receiptMismatch,
      report: result.lines,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const line of result.lines) console.log(line);
  }
  // Archive the run snapshot AFTER the final exit code settled: a red run
  // never poisons history. Notices go to stderr ONLY, so the --json stdout
  // payload stays untouched; archiving can never change verdict or exit code.
  if (code !== 1) {
    const notice = (message) => console.error(message);
    let privateKey = null;
    try {
      privateKey = resolveSnapshotKey();
    } catch (err) {
      notice(`could not load a signing key for the run snapshot: ${err.message}`);
    }
    try {
      const trusted = (Array.isArray(publicHex) ? publicHex : [publicHex]).concat([chainKey]).filter(Boolean);
      // Snapshots this machine signs must count as valid on the next run
      // even when the signing key differs from the chain key, or the
      // idempotence check would re-write a snapshot on every verify.
      if (privateKey !== null) trusted.push(publicHexFromPrivate(privateKey));
      archiveRunSnapshot(chainDir, chain, receipts, { privateKey, trustedKeys: trusted, onNotice: notice });
    } catch (err) {
      notice(`could not archive run snapshot: ${err.message}`);
    }
  }
  return code;
}

// The private key snapshots sign with, or null for unsigned snapshots. Same
// precedence as ingest: TAMPER_SIGNAL_KEY from the environment wins, else the
// default keys/signing.key when it exists. Verify takes no --key flag
// (verification needs no private key), so an absent key just means the
// snapshot is written unsigned.
function resolveSnapshotKey() {
  const defaultKey = "keys/signing.key";
  if (!process.env.TAMPER_SIGNAL_KEY && !existsSync(defaultKey)) return null;
  return loadPrivateKey(defaultKey);
}

// --- diff -------------------------------------------------------------------
// Mirrors the Python `receipts diff` (tamper_signal/cli.py cmd_diff): compare
// two runs and report per-stage code-hash changes plus a structured totals
// delta including date ranges. Read-only; exit 0 with or without differences,
// 1 on usage/load errors. ASCII output only.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Normalize a --chain value: accept a chain dir or a chain.json path.
const chainDirOf = (ref) => (basename(ref) === "chain.json" ? dirname(ref) : ref);

// Adapter: a live chain directory in the snapshot's diff shape. Throws with a
// clean message on any load failure (treated as a usage error, exit 1).
function diffSideFromChainDir(chainDir, ref) {
  const chainPath = join(chainDir, "chain.json");
  if (!existsSync(chainPath)) throw new Error(`no chain.json in ${chainDir || "."}`);
  let chain;
  try {
    chain = readChain(chainPath);
  } catch (err) {
    throw new Error(`cannot read ${chainPath}: ${err.message}`);
  }
  if (!isObject(chain)) throw new Error(`${chainPath} is not a chain file`);
  const receipts = (chain.receipts ?? []).map((name) => readReceipt(chainDir, name));
  let tail = null;
  try {
    tail = chainTailHash(chainDir, chain);
  } catch {
    // A chain with no receipts still diffs (it just cannot anchor the
    // default-mode "differs from current tail" selection).
  }
  return {
    ref,
    created_at: null,
    source: runSource(receipts),
    stages: runStages(receipts),
    tail,
    unsigned: false,
    publicKey: typeof chain.public_key === "string" ? chain.public_key : null,
  };
}

// Adapter: an archived run snapshot in the diff shape.
function diffSideFromSnapshot(snapshot, ref, signed = null) {
  const isSigned = signed ?? isObject(snapshot.signature);
  return {
    ref,
    created_at: typeof snapshot.created_at === "string" ? snapshot.created_at : null,
    source: isObject(snapshot.source) ? snapshot.source : {},
    stages: Array.isArray(snapshot.stages) ? snapshot.stages : [],
    tail: snapshot.chain_tail_hash ?? null,
    unsigned: !isSigned,
    publicKey: null,
  };
}

// Load one explicit diff argument: a chain directory, a chain.json path, or a
// run-snapshot file. Throws on anything unloadable.
function loadDiffSide(ref) {
  let stats = null;
  try {
    stats = statSync(ref);
  } catch {
    throw new Error(`no such file or directory: ${ref}`);
  }
  if (stats.isDirectory()) return diffSideFromChainDir(ref, ref);
  let payload;
  try {
    payload = JSON.parse(readFileSync(ref, "utf-8"));
  } catch (err) {
    throw new Error(`cannot read ${ref}: ${err.message}`);
  }
  if (isObject(payload) && payload.kind === "run_snapshot") return diffSideFromSnapshot(payload, ref);
  if (isObject(payload) && Array.isArray(payload.receipts)) return diffSideFromChainDir(dirname(ref), ref);
  throw new Error(`${ref} is neither a chain directory, a chain.json, nor a run snapshot`);
}

const signedInt = (n) => `${n >= 0 ? "+" : ""}${n}`;

// Human lines (ASCII only) for one stage's structured totals delta.
function renderStageDelta(delta) {
  const lines = [];
  for (const key of ["row_count", "column_count"]) {
    const entry = delta[key];
    if (entry) {
      const suffix = "delta" in entry ? ` (${signedInt(entry.delta)})` : "";
      lines.push(`${key} ${entry.before} -> ${entry.after}${suffix}`);
    }
  }
  for (const [column, entry] of Object.entries(delta.numeric_sums ?? {})) {
    const before = entry.before !== null ? entry.before : "(added)";
    const after = entry.after !== null ? entry.after : "(removed)";
    const suffix = "delta" in entry ? ` (${entry.delta})` : "";
    lines.push(`${column} ${before} -> ${after}${suffix}`);
  }
  for (const [column, entry] of Object.entries(delta.null_counts ?? {})) {
    const suffix = "delta" in entry ? ` (${signedInt(entry.delta)})` : "";
    lines.push(`null_counts[${column}] ${entry.before} -> ${entry.after}${suffix}`);
  }
  const range = (value) => (isObject(value) ? `${value.min}..${value.max}` : "(none)");
  for (const [column, entry] of Object.entries(delta.date_ranges ?? {})) {
    lines.push(`date_ranges[${column}] ${range(entry.before)} -> ${range(entry.after)}`);
  }
  if (delta.period_buckets_changed?.length) {
    lines.push(`period_buckets changed: ${delta.period_buckets_changed.join(", ")}`);
  }
  return lines;
}

function cmdDiff(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      chain: { type: "string", default: "receipts/" },
      json: { type: "boolean", default: false },
    },
  });
  if (positionals.length > 2) {
    console.error("diff takes at most two runs (chain directories or snapshot files)");
    return 1;
  }

  const chainDir = chainDirOf(values.chain);
  let sideA;
  let sideB;
  try {
    if (positionals.length === 2) {
      sideA = loadDiffSide(positionals[0]);
      sideB = loadDiffSide(positionals[1]);
    } else if (positionals.length === 1) {
      // One arg: that run (the "before") vs the current chain.
      sideA = loadDiffSide(positionals[0]);
      sideB = diffSideFromChainDir(chainDir, chainDir);
    } else {
      // Zero args (hardened default): current chain vs the most recent valid
      // snapshot whose tail DIFFERS from the current chain's, so a freshly
      // archived snapshot of this very run never self-compares.
      sideB = diffSideFromChainDir(chainDir, chainDir);
      const trusted = sideB.publicKey ? [sideB.publicKey] : [];
      const items = loadSnapshots(chainDir, {
        trustedKeys: trusted,
        onNotice: (message) => console.error(message),
      });
      const prior = items.find((item) => item.snapshot.chain_tail_hash !== sideB.tail) ?? null;
      if (prior === null) {
        console.log("no prior run archived to compare against");
        return 0;
      }
      sideA = diffSideFromSnapshot(prior.snapshot, prior.path, prior.signed);
    }
  } catch (err) {
    console.error(`diff: ${err.message}`);
    return 1;
  }

  const sourceA = sideA.source;
  const sourceB = sideB.source;
  const identityMismatch =
    sourceA.filename !== sourceB.filename ||
    JSON.stringify(sourceA.columns ?? null) !== JSON.stringify(sourceB.columns ?? null);

  // Stage alignment is BY NAME, order-independent; the first receipt wins a
  // duplicated name. Output order: A's stages, then B-only stages appended.
  const firstByName = (stages) => {
    const map = new Map();
    for (const stage of stages) {
      if (isObject(stage) && !map.has(stage.name)) map.set(stage.name, stage);
    }
    return map;
  };
  const stagesA = firstByName(sideA.stages);
  const stagesB = firstByName(sideB.stages);
  const order = [];
  const seen = new Set();
  for (const stage of [...sideA.stages, ...sideB.stages]) {
    if (isObject(stage) && !seen.has(stage.name)) {
      seen.add(stage.name);
      order.push(stage.name);
    }
  }

  const stageRows = [];
  for (const name of order) {
    const stageA = stagesA.get(name) ?? null;
    const stageB = stagesB.get(name) ?? null;
    if (stageA !== null && stageB !== null) {
      const codeBefore = typeof stageA.code_hash === "string" ? stageA.code_hash : "";
      const codeAfter = typeof stageB.code_hash === "string" ? stageB.code_hash : "";
      const codeChanged = codeBefore !== codeAfter;
      const totalsA = isObject(stageA.totals) ? stageA.totals : {};
      const totalsB = isObject(stageB.totals) ? stageB.totals : {};
      const row = {
        name,
        status: "matched",
        code_changed: codeChanged,
        totals: structuredTotalsDelta(totalsA, totalsB),
      };
      if (codeChanged) {
        row.code_hash = { before8: codeBefore.slice(0, 8), after8: codeAfter.slice(0, 8) };
        const codeFile = stageB.code_file || stageA.code_file;
        if (typeof codeFile === "string" && codeFile) row.code_file = codeFile;
      }
      stageRows.push(row);
    } else {
      stageRows.push({
        name,
        status: stageA !== null ? "removed" : "added",
        code_changed: false,
        totals: null,
      });
    }
  }

  if (values.json) {
    const payload = {
      a: { ref: sideA.ref, created_at: sideA.created_at, unsigned: sideA.unsigned },
      b: { ref: sideB.ref, created_at: sideB.created_at, unsigned: sideB.unsigned },
      stages: stageRows,
      identity_mismatch: identityMismatch,
    };
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  for (const side of [sideA, sideB]) {
    if (side.unsigned) {
      console.log(`note: snapshot ${basename(side.ref)} is unsigned; weaker evidence`);
    }
  }
  if (identityMismatch) {
    const nameA = sourceA.filename || "(unknown)";
    const nameB = sourceB.filename || "(unknown)";
    console.log(`note: sources differ (${nameA} vs ${nameB}); comparing anyway`);
  }
  console.log(`a: ${sideA.ref}${sideA.created_at ? ` (created ${sideA.created_at})` : ""}`);
  console.log(`b: ${sideB.ref}${sideB.created_at ? ` (created ${sideB.created_at})` : ""}`);

  let anyDifference = false;
  for (const row of stageRows) {
    if (row.status !== "matched") {
      anyDifference = true;
      console.log(`stage ${row.name}: ${row.status}`);
      continue;
    }
    const lines = [];
    if (row.code_changed) {
      const where = row.code_file ? ` (${row.code_file})` : "";
      lines.push(
        `code_hash ${row.code_hash.before8 || "(none)"} -> ${row.code_hash.after8 || "(none)"}${where}`
      );
    }
    lines.push(...renderStageDelta(row.totals));
    if (lines.length) {
      anyDifference = true;
      console.log(`stage ${row.name}`);
      for (const line of lines) console.log(`  ${line}`);
    }
  }
  if (!anyDifference) console.log("no differences");
  return 0;
}

function cmdExport(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      data: { type: "string" },
      out: { type: "string" },
    },
  });
  const chainPath = positionals[0];
  if (!chainPath) {
    console.error("export: missing path to chain.json");
    return 1;
  }
  if (!values.data) {
    console.error("export: missing --data <file> (the verified records to write as table.json)");
    return 1;
  }
  const chain = readChain(chainPath);
  const chainDir = dirname(chainPath);
  let receipts;
  try {
    receipts = (chain.receipts ?? []).map((name) => readReceipt(chainDir, name));
  } catch (err) {
    console.error(`Cannot load chain: ${err.message}`);
    return 1;
  }
  if (!receipts.length) {
    console.error("Chain is empty; nothing to export against.");
    return 1;
  }

  // Refuse to export data that does not descend from the chain: the Data tab
  // only ever shows attested data, so a mismatched export is a lie waiting to
  // render. Mirrors the Python `receipts export`.
  const records = loadRecords(values.data);
  const document = canonicalDocument(records);
  // Hash the document we already built rather than re-canonicalizing the
  // records (semanticHash would repeat the sort); the bytes are identical.
  const dataHash = createHash("sha256").update(canonicalJsonBytes(document)).digest("hex");
  const expected = outputHashOf(receipts[receipts.length - 1]);
  if (dataHash !== expected) {
    console.error("✗ Refusing to export: the data does not match the final receipt.");
    console.error(`  expected output hash ${expected}`);
    console.error(`  found    data hash   ${dataHash}`);
    console.error("  The Data tab only shows attested data. Re-run the pipeline or fix --data.");
    return 1;
  }

  const outPath = values.out || join(chainDir, "table.json");
  writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n");
  console.log(`Exported verified table: ${outPath}`);
  console.log(`  rows ${document.rows.length}, columns ${document.headers.length}`);
  console.log(`  semantic_hash ${dataHash} (matches final receipt)`);
  return 0;
}

const [, , command, ...rest] = process.argv;
const commands = { keygen: cmdKeygen, ingest: cmdIngest, verify: cmdVerify, diff: cmdDiff, export: cmdExport };
if (!command || !(command in commands)) {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
process.exit(commands[command](rest));
