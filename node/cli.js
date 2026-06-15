#!/usr/bin/env node
// The JavaScript CLI for Tamper Signal. Mirrors the Python `receipts` CLI
// (which owns the short name); this binary installs as `tamper-signal`.
//
//   tamper-signal keygen --out keys/
//   tamper-signal ingest export.csv --origin "..." --key keys/signing.key --out receipts/
//   tamper-signal verify receipts/chain.json [--pub keys/signing.pub] [--data current.csv] [--warn-drift]
//   tamper-signal export receipts/chain.json --data current.csv [--out receipts/table.json] [--bundle]
//
// Exit codes are the traffic light: 0 green, 1 red, 2 yellow.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import process from "node:process";

import { canonicalDocument, canonicalJsonBytes, semanticHash } from "./canonical.js";
import {
  LOG_GRANULARITIES,
  archiveRunSnapshot,
  chainTailHash,
  historyHasTail,
  judgeCrossRun,
  loadSnapshots,
  periodKey,
  runSource,
  runStages,
} from "./history.js";
import { decimalToPlainString, parseDecimal } from "./canonical.js";
import { generateKeys, loadPrivateKey, loadPublicKeyHex, publicHexFromPrivate } from "./keys.js";
import { loadRecords } from "./load.js";
import { makeStoredZip } from "./zip.js";
import {
  CHAIN_FILENAME,
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
import { UntrustedSignerError, appendPeriod, ingestFile } from "./wrapper.js";

const USAGE = `usage: tamper-signal <command>

commands:
  keygen --out keys/                         generate an Ed25519 signing keypair
  ingest <file> --origin "..." [--key keys/signing.key] [--out receipts/]
                [--band 5%] [--settle 72h] [--bucket-column <name>]
                [--as replace|period] [--pub key.pub ...]
                                             create a signed source manifest
                                             (.csv, .tsv, .json, .ndjson);
                                             --band/--settle/--bucket-column
                                             sign a tolerance declaration into
                                             the manifest (band default 0.05,
                                             settle default 72h). --as replace
                                             (default) re-signs a fresh chain
                                             (prior chain archived); --as period
                                             continues run history under a
                                             trusted signer (--pub to trust a
                                             key other than the chain's)
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
  log [--chain receipts/] [--granularity day|week|month|quarter]
      [--metric <name> ...] [--pub key.pub ...] [--json]
                                             render archived run history as a
                                             per-metric trend across runs. One
                                             row per period (same-period runs
                                             collapse last-wins); each metric
                                             shows its value and the delta vs
                                             the previous row. Read-only; exit 0
  export <chain.json> --data <file> [--out receipts/table.json] [--bundle]
                                             write the canonical table document
                                             (refuses unless --data matches the
                                             final receipt); --bundle writes a
                                             verified zip (data + chain.json +
                                             receipts) for offline re-verification
`;

function cmdKeygen(args) {
  const { values } = parseArgs({ args, options: { out: { type: "string", default: "keys/" } } });
  const { privatePath, publicPath } = generateKeys(values.out);
  console.log(`Public key written to ${publicPath}`);
  console.error(`Private key written to ${privatePath}. Do not commit it.`);
  return 0;
}

// True when ingest is about to reset a chain whose run never reached history
// (no snapshot records the outgoing chain's tail hash): the totals of that run
// are about to become unrecoverable. Never throws (a malformed old chain reads
// as never-snapshotted, since it certainly was never snapshotted as-is).
// Computed from the OUTGOING chain BEFORE ingestFile overwrites it; the caller
// emits the warning only after ingest validation passes, to mirror Python
// _warn_if_unsnapshotted_reset (which warns after the manifest builds, so an
// invalid --bucket-column exits 1 with no warning).
function isUnsnapshottedReset(chainDir) {
  const chainPath = join(chainDir, CHAIN_FILENAME);
  if (!existsSync(chainPath)) return false;
  try {
    const oldChain = readChain(chainPath);
    const tail = chainTailHash(chainDir, oldChain);
    const key = oldChain.public_key;
    const keys = typeof key === "string" && key ? [key] : [];
    return !historyHasTail(chainDir, tail, { trustedKeys: keys });
  } catch {
    return true; // a chain we cannot read was never archived as-is
  }
}

// Before a replace reset, copy the prior chain.json and its receipts into
// <chainDir>/archive/<tail>/ so the prior chain is preserved, not silently
// overwritten (R9). Content-addressed by the prior chain tail; idempotent and
// collision-free. Best-effort: never throws, never blocks ingest.
function archivePriorChain(chainDir) {
  const chainPath = join(chainDir, CHAIN_FILENAME);
  if (!existsSync(chainPath)) return;
  let chain;
  let tail;
  try {
    chain = readChain(chainPath);
    tail = chainTailHash(chainDir, chain);
  } catch {
    return;
  }
  const dest = join(chainDir, "archive", tail);
  if (existsSync(dest)) return;
  try {
    mkdirSync(dest, { recursive: true });
    copyFileSync(chainPath, join(dest, CHAIN_FILENAME));
    for (const name of chain.receipts ?? []) {
      const src = join(chainDir, name);
      if (existsSync(src)) copyFileSync(src, join(dest, name));
    }
  } catch {
    // best-effort audit trail; ingest proceeds regardless
  }
}

// `ingest --as period`: continue the chain's run history under a trusted signer.
function cmdIngestPeriod(values, file) {
  // Like replace, compute the unsnapshotted-reset condition and preserve the
  // prior chain before appendPeriod's ingest overwrites chain.json. A refused
  // untrusted import leaves the prior chain untouched, so the archive is an
  // idempotent no-op in that case.
  const unsnapshottedReset = isUnsnapshottedReset(values.out);
  archivePriorChain(values.out);

  const trusted = (values.pub ?? []).map((p) => loadPublicKeyHex(p)).filter(Boolean);
  let result;
  try {
    result = appendPeriod({
      file,
      declaredOrigin: values.origin,
      chainDir: values.out,
      keyPath: values.key,
      trustedPubHexes: trusted,
      band: values.band ?? null,
      settle: values.settle ?? null,
      bucketColumn: values["bucket-column"] ?? null,
    });
  } catch (err) {
    if (err instanceof UntrustedSignerError) {
      console.error(`✗ Refusing to append a period: ${err.message}`);
      return 1;
    }
    console.error(err.message);
    return 1;
  }
  if (unsnapshottedReset) {
    console.error("warning: previous run was never verified; its totals will not enter history");
  }
  const totals = result.manifest.control_totals;
  console.log(`Imported next period: ${result.manifest.source.filename}`);
  console.log(`  evidence_hash ${result.manifest.source.evidence_hash}`);
  console.log(`  semantic_hash ${result.manifest.semantic_hash}`);
  console.log(`  rows ${totals.row_count}, columns ${totals.column_count}`);
  const grouped = groupedNumericColumns(result.records);
  if (grouped.length) {
    console.error("");
    for (const { column, example } of grouped) {
      console.error(`  warning: column "${column}" looks numeric (e.g. "${example}") but is missing from numeric_sums.`);
    }
    console.error("  Grouped numbers don't parse as plain decimals, so these columns are left out of the control totals'");
    console.error("  numeric_sums -- a data-receipt-column on them can never flag a change. Add a normalize step that");
    console.error("  strips the separators before ingest. Only plain decimals (no thousands grouping) are summed.");
  }
  if (result.caveats.length) {
    console.log("  the light is yellow, a human should look:");
    for (const caveat of result.caveats) console.log(`    - ${caveat}`);
    return 2;
  }
  console.log(
    result.compared
      ? "  in band against the prior run (the light stays green)"
      : "  recorded as the first period (no prior run to compare)",
  );
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
      as: { type: "string", default: "replace" },
      pub: { type: "string", multiple: true, default: [] },
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
  if ((values.as ?? "replace") === "period") return cmdIngestPeriod(values, file);
  // Compute the unsnapshotted-reset condition from the OUTGOING chain before
  // ingestFile overwrites chain.json; emit the warning only after ingest
  // validation passes (below), so an invalid flag exits 1 with no warning.
  const unsnapshottedReset = isUnsnapshottedReset(values.out);
  // Preserve the prior chain before the reset overwrites it (R9).
  archivePriorChain(values.out);
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
  if (unsnapshottedReset) {
    console.error("warning: previous run was never verified; its totals will not enter history");
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
  // Cross-run judgment (U6) runs AFTER the within-run verdict and BEFORE
  // exit-code finalization: a red verify never judges, and judgment caveats
  // are yellow, never red (R12). It lives in the CLI layer so verifyChain
  // stays pure and the browser verifier untouched.
  let judgment = { caveats: [], details: [], notices: [], breached: {} };
  if (result.verdict !== "red") {
    const trustedForHistory = (Array.isArray(publicHex) ? publicHex : [publicHex]).concat([chainKey]);
    judgment = judgeAfterVerify(chainDir, chain, receipts, trustedForHistory);
    if (judgment.caveats.length) foldJudgment(result, judgment.caveats);
    for (const line of judgment.notices) console.error(line);
  }
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
      // Additive (R18): typed cross-run detail. Always present, [] when
      // judgment found nothing or never ran, so consumers can rely on the
      // key. Mirrors the Python payload byte-for-byte.
      caveat_details: judgment.details,
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
      archiveRunSnapshot(chainDir, chain, receipts, {
        privateKey,
        trustedKeys: trusted,
        onNotice: notice,
        breached: Object.keys(judgment.breached).length ? judgment.breached : null,
      });
    } catch (err) {
      notice(`could not archive run snapshot: ${err.message}`);
    }
  }
  return code;
}

// Run cross-run judgment for a non-red verify; never throws. Returns
// judgeCrossRun's shape ({caveats, details, notices, breached}). With no
// tolerance declaration in the source manifest this is a no-op with zero
// output (AE13: verification stays exact and silent). Any failure degrades
// to an empty judgment with a notice, never a verdict change. Mirrors
// _judge_after_verify in tamper_signal/cli.py.
function judgeAfterVerify(chainDir, chain, receipts, trustedKeys) {
  const empty = { caveats: [], details: [], notices: [], breached: {} };
  const source = receipts.length ? receipts[0] : null;
  const tolerance = source !== null && typeof source === "object" ? source.tolerance : null;
  if (tolerance === null || typeof tolerance !== "object" || Array.isArray(tolerance)) return empty;
  const notices = [];
  try {
    let privateKey = null;
    try {
      privateKey = resolveSnapshotKey();
    } catch {
      privateKey = null; // judging without the machine key is fine
    }
    const keys = trustedKeys.filter(Boolean);
    if (privateKey !== null) keys.push(publicHexFromPrivate(privateKey));
    const items = loadSnapshots(chainDir, { trustedKeys: keys, onNotice: (m) => notices.push(m) });
    const judgment = judgeCrossRun(receipts, chain, items.map((item) => item.snapshot));
    judgment.notices = notices.concat(judgment.notices);
    return judgment;
  } catch (err) {
    return { ...empty, notices: notices.concat([`cross-run judgment skipped: ${err.message}`]) };
  }
}

// Fold judgment caveats into a verify result so the verdict, summary lines,
// and exit mapping work untouched. A green report becomes the standard
// yellow report; a yellow report gains the new caveat lines before its
// closing "A human should look." line (existing machinery, never
// duplicated). Mirrors _fold_judgment_caveats in tamper_signal/cli.py.
function foldJudgment(result, caveats) {
  const newLines = caveats.map((caveat) => `  - ${caveat}`);
  if (result.caveats.length) {
    result.lines.splice(result.lines.length - 1, 0, ...newLines);
  } else {
    const header = result.lines.length ? result.lines[result.lines.length - 1] : "";
    const prefix = "✓ CHAIN INTACT: ";
    const summary = header.startsWith(prefix) ? header.slice(prefix.length) : header;
    if (result.lines.length) {
      result.lines[result.lines.length - 1] = `⚠ CHAIN VERIFIES, WITH CAVEATS: ${summary}`;
    }
    result.lines.push(...newLines, "  A human should look.");
  }
  result.caveats.push(...caveats);
  result.verdict = "yellow";
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

// --- log --------------------------------------------------------------------
// Mirrors the Python `receipts log` (tamper_signal/cli.py cmd_log): render
// archived run history as a per-metric trend across runs at day/week/month/
// quarter granularity. Read-only; exit 0 (1 only on a bad --granularity).
// ASCII output only. Collapse and period keys agree byte-for-byte with Python.

// The last stage's totals in a snapshot (the FINAL stage `log` trends).
function finalStageTotals(snapshot) {
  const stages = snapshot.stages;
  if (Array.isArray(stages)) {
    for (let i = stages.length - 1; i >= 0; i--) {
      const stage = stages[i];
      if (isObject(stage)) return isObject(stage.totals) ? stage.totals : {};
    }
  }
  return {};
}

// A metric's display string from final-stage totals, or null when absent.
// Metric ids: "row_count" or a numeric_sums column name.
function logMetricValue(totals, metric) {
  if (metric === "row_count") {
    const value = totals.row_count;
    return typeof value === "number" && Number.isInteger(value) ? String(value) : null;
  }
  const sums = totals.numeric_sums;
  const value = isObject(sums) ? sums[metric] : undefined;
  return typeof value === "string" ? value : null;
}

// Default selection: row_count plus the union of every snapshot's final-stage
// numeric_sums column names (sorted), so a metric in only some runs is still
// trended ("-" where it is missing).
function defaultLogMetrics(snapshots) {
  const sums = new Set();
  for (const snapshot of snapshots) {
    const s = finalStageTotals(snapshot).numeric_sums;
    if (isObject(s)) for (const k of Object.keys(s)) sums.add(String(k));
  }
  return ["row_count", ...[...sums].sort()];
}

// The metric ids this snapshot's judgment flagged anywhere (any bucket). The
// breached map is keyed by bucket; `log` trends final-stage whole-table
// metrics, so a metric is marked breached for the run if it breached in ANY
// bucket. null_counts[...] ids never appear as log metrics and are ignored.
function logBreachedMetrics(snapshot) {
  const names = new Set();
  const breached = snapshot.breached;
  if (isObject(breached)) {
    for (const metrics of Object.values(breached)) {
      if (Array.isArray(metrics)) for (const m of metrics) if (typeof m === "string") names.add(m);
    }
  }
  return names;
}

// Collapse validated snapshot items into per-period rows (oldest first).
// Multiple runs in the same period collapse LAST-WINS by created_at (ties
// break on body_hash, matching loadSnapshots' ordering). Returns
// { rows, collapsed } where collapsed counts the runs hidden by the collapse.
function buildLogPeriods(items, granularity, metrics) {
  const groups = new Map();
  for (const item of items) {
    const key = periodKey(item.created_at, granularity);
    const sortKey = `${item.created_at} ${item.body_hash}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { item, sortKey, count: 1 });
    } else {
      group.count += 1;
      if (sortKey > group.sortKey) {
        group.item = item;
        group.sortKey = sortKey;
      }
    }
  }

  const rows = [];
  let collapsed = 0;
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key);
    collapsed += group.count - 1;
    const snapshot = group.item.snapshot;
    const totals = finalStageTotals(snapshot);
    const breached = logBreachedMetrics(snapshot);
    const values = {};
    for (const metric of metrics) values[metric] = logMetricValue(totals, metric);
    rows.push({
      period: key,
      runs: group.count,
      created_at: group.item.created_at,
      tail: snapshot.chain_tail_hash || "",
      unsigned: !group.item.signed,
      values,
      breached,
    });
  }
  return { rows, collapsed };
}

// The most recent earlier row's value for this metric, skipping rows where the
// metric was missing, or null when no earlier row has it.
function previousLogValue(rows, index, metric) {
  for (let back = index - 1; back >= 0; back--) {
    const candidate = rows[back].values[metric];
    if (candidate !== null && candidate !== undefined) return candidate;
  }
  return null;
}

// Signed delta string between two metric values, or null when either is not a
// finite decimal. Integers render without a decimal point ("+22"). Exact
// BigInt math (align mantissas, subtract) to match Python's Decimal.
function logDelta(before, after) {
  const a = parseDecimal(before);
  const b = parseDecimal(after);
  if (a === null || b === null) return null;
  const exp = Math.min(a.exp, b.exp);
  const diff = b.v * 10n ** BigInt(b.exp - exp) - a.v * 10n ** BigInt(a.exp - exp);
  const sign = diff < 0n ? "-" : "+";
  const magnitude = diff < 0n ? { v: -diff, exp } : { v: diff, exp };
  return sign + decimalToPlainString(magnitude);
}

// ASCII, aligned, chronological table. Each metric column shows the value, a
// "!" suffix when the run breached that metric, and a delta vs the previous
// rendered row (first row no delta). A missing metric renders "-". An
// "unsigned" column shows "u" for unsigned snapshots.
function renderLogTable(rows, metrics) {
  const headers = ["period", "runs", "tail", "unsigned", ...metrics];
  const table = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const cells = [row.period, String(row.runs), row.tail ? row.tail.slice(0, 8) : "-", row.unsigned ? "u" : ""];
    for (const metric of metrics) {
      const value = row.values[metric];
      if (value === null || value === undefined) {
        cells.push("-");
        continue;
      }
      let text = value + (row.breached.has(metric) ? "!" : "");
      const prior = previousLogValue(rows, index, metric);
      if (prior !== null) {
        const delta = logDelta(prior, value);
        if (delta !== null) text += ` (${delta})`;
      }
      cells.push(text);
    }
    table.push(cells);
  }

  const widths = headers.map((h) => h.length);
  for (const cells of table) {
    for (let i = 0; i < cells.length; i++) widths[i] = Math.max(widths[i], cells[i].length);
  }
  const fmt = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").replace(/\s+$/, "");
  return [fmt(headers), ...table.map(fmt)];
}

// Per-metric {value, delta?} for one JSON row. value is the display string (or
// "-" when absent); delta is the signed delta vs the previous rendered row
// that had a value (omitted on the first such row).
function logJsonMetrics(rows, index, metrics) {
  const out = {};
  for (const metric of metrics) {
    const value = rows[index].values[metric];
    if (value === null || value === undefined) {
      out[metric] = { value: "-" };
      continue;
    }
    const entry = { value };
    const prior = previousLogValue(rows, index, metric);
    if (prior !== null) {
      const delta = logDelta(prior, value);
      if (delta !== null) entry.delta = delta;
    }
    out[metric] = entry;
  }
  return out;
}

function cmdLog(args) {
  const { values } = parseArgs({
    args,
    options: {
      chain: { type: "string", default: "receipts/" },
      granularity: { type: "string", default: "day" },
      metric: { type: "string", multiple: true },
      pub: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
    },
  });

  const granularity = values.granularity;
  if (!LOG_GRANULARITIES.includes(granularity)) {
    console.error(
      `log: unknown --granularity '${granularity}' (choose from ${LOG_GRANULARITIES.join(", ")})`
    );
    return 1;
  }

  const chainDir = chainDirOf(values.chain);
  const chainPath = join(chainDir, "chain.json");
  let trusted = [];
  if (values.pub?.length) {
    trusted = values.pub.map(loadPublicKeyHex);
  } else if (existsSync(chainPath)) {
    // Default to the chain's embedded key so signed snapshots verify.
    try {
      const chain = readChain(chainPath);
      if (typeof chain.public_key === "string" && chain.public_key) trusted = [chain.public_key];
    } catch {
      trusted = [];
    }
  }

  let items = loadSnapshots(chainDir, {
    trustedKeys: trusted,
    onNotice: (message) => console.error(message),
  });
  if (!items.length) {
    console.log("no run history yet");
    return 0;
  }

  // loadSnapshots returns newest-first; `log` renders oldest-first.
  items = [...items].reverse();
  const snapshots = items.map((item) => item.snapshot);
  const metrics = values.metric?.length ? [...new Set(values.metric)] : defaultLogMetrics(snapshots);

  const { rows, collapsed } = buildLogPeriods(items, granularity, metrics);

  if (values.json) {
    const payload = {
      granularity,
      // Total runs collapsed away by the granularity. Ordered chronological
      // (oldest first), matching the Python CLI byte-for-byte.
      collapsed,
      runs: rows.map((row, index) => ({
        period: row.period,
        created_at: row.created_at,
        tail: row.tail ? row.tail.slice(0, 8) : null,
        unsigned: row.unsigned,
        metrics: logJsonMetrics(rows, index, metrics),
        breached: metrics.filter((m) => row.breached.has(m)).sort(),
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  for (const line of renderLogTable(rows, metrics)) console.log(line);
  console.log("u = unsigned snapshot (weaker evidence); ! = breached in that run");
  return 0;
}

function cmdExport(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      data: { type: "string" },
      out: { type: "string" },
      bundle: { type: "boolean" },
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

  if (values.bundle) {
    // Verified bundle: the original data file plus chain.json and its receipts,
    // packaged so a recipient can `tamper-signal verify chain.json` offline.
    // Entry bytes are stored verbatim (chain.json's receipt_hashes commit to the
    // raw receipt bytes), mirroring the on-disk chain_dir layout flat at the root.
    const dataName = basename(values.data);
    const receiptNames = chain.receipts ?? [];
    const entries = [
      { name: dataName, bytes: readFileSync(values.data) },
      { name: CHAIN_FILENAME, bytes: readFileSync(chainPath) },
      ...receiptNames.map((name) => ({ name, bytes: readFileSync(join(chainDir, name)) })),
    ];
    const stem = dataName.replace(/\.[^.]+$/, "");
    const bundlePath = values.out || join(chainDir, `${stem}-verified.zip`);
    writeFileSync(bundlePath, makeStoredZip(entries));
    console.log(`Exported verified bundle: ${bundlePath}`);
    console.log(`  data ${dataName}, ${receiptNames.length} receipts + ${CHAIN_FILENAME}`);
    console.log(`  semantic_hash ${dataHash} (matches final receipt)`);
    console.log(`  recipient: unzip, then \`tamper-signal verify ${CHAIN_FILENAME}\``);
    return 0;
  }

  const outPath = values.out || join(chainDir, "table.json");
  writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n");
  console.log(`Exported verified table: ${outPath}`);
  console.log(`  rows ${document.rows.length}, columns ${document.headers.length}`);
  console.log(`  semantic_hash ${dataHash} (matches final receipt)`);
  return 0;
}

const [, , command, ...rest] = process.argv;
const commands = { keygen: cmdKeygen, ingest: cmdIngest, verify: cmdVerify, diff: cmdDiff, log: cmdLog, export: cmdExport };
if (!command || !(command in commands)) {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
process.exit(commands[command](rest));
