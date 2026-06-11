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
  verify <chain.json> [--pub key.pub] [--data <file>] [--warn-drift]
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

  const result = verifyChain(receipts, publicHex, dataHash, dataTotals, {
    chainPublicHex: chainKey,
    receiptNames: chain.receipts ?? [],
    warnDrift: values["warn-drift"],
  });
  for (const line of result.lines) console.log(line);
  return { green: 0, red: 1, yellow: 2 }[result.verdict];
}

const [, , command, ...rest] = process.argv;
const commands = { keygen: cmdKeygen, ingest: cmdIngest, verify: cmdVerify };
if (!command || !(command in commands)) {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
process.exit(commands[command](rest));
