#!/usr/bin/env node
// The JavaScript CLI for Tamper Signal. Mirrors the Python `receipts` CLI
// (which owns the short name); this binary installs as `tamper-signal`.
//
//   tamper-signal keygen --out keys/
//   tamper-signal ingest export.csv --origin "..." --key keys/signing.key --out receipts/
//   tamper-signal verify receipts/chain.json [--pub keys/signing.pub] [--data current.csv] [--warn-drift]
//
// Exit codes are the traffic light: 0 green, 1 red, 2 yellow.

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseArgs } from "node:util";
import process from "node:process";

import { evidenceHash, semanticHash } from "./canonical.js";
import { generateKeys, loadPrivateKey, loadPublicKeyHex, publicHexFromPrivate } from "./keys.js";
import { loadRecords } from "./load.js";
import {
  SOURCE_RECEIPT_NAME,
  buildSourceManifest,
  readChain,
  readReceipt,
  receiptFileHashes,
  stageNameOf,
  totalsOf,
  verifyChain,
  writeChain,
  writeReceipt,
} from "./receipts.js";
import { controlTotals } from "./totals.js";

const USAGE = `usage: tamper-signal <command>

commands:
  keygen --out keys/                         generate an Ed25519 signing keypair
  ingest <file> --origin "..." [--key keys/signing.key] [--out receipts/]
                                             create a signed source manifest
                                             (.csv, .tsv, .json, .ndjson)
  verify <chain.json> [--pub key.pub ...] [--data <file>] [--warn-drift] [--json]
                                             verify a chain (exit 0 green, 1 red, 2 yellow)
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
    },
  });
  const file = positionals[0];
  if (!file) {
    console.error("ingest: missing source file");
    return 1;
  }
  const raw = readFileSync(file);
  const records = loadRecords(file);
  if (process.env.TAMPER_SIGNAL_KEY) {
    // The env var silently outranks --key; say so where it matters.
    console.error("Signing with TAMPER_SIGNAL_KEY from the environment (overrides --key)");
  }
  const privateKey = loadPrivateKey(values.key);
  const manifest = buildSourceManifest({
    filename: basename(file),
    evidenceHash: evidenceHash(raw),
    byteSize: raw.length,
    declaredOrigin: values.origin,
    semanticHash: semanticHash(records),
    records,
    privateKey,
  });
  writeReceipt(values.out, SOURCE_RECEIPT_NAME, manifest);
  writeChain(values.out, [SOURCE_RECEIPT_NAME], publicHexFromPrivate(privateKey));
  const totals = manifest.control_totals;
  console.log(`Ingested ${basename(file)}`);
  console.log(`  evidence_hash ${manifest.source.evidence_hash}`);
  console.log(`  semantic_hash ${manifest.semantic_hash}`);
  console.log(`  rows ${totals.row_count}, columns ${totals.column_count}`);
  console.log(`  source manifest -> ${values.out.replace(/\/?$/, "/")}${SOURCE_RECEIPT_NAME}`);
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
  return code;
}

const [, , command, ...rest] = process.argv;
const commands = { keygen: cmdKeygen, ingest: cmdIngest, verify: cmdVerify };
if (!command || !(command in commands)) {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
process.exit(commands[command](rest));
