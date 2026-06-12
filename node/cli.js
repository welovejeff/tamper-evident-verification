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
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import process from "node:process";

import { canonicalDocument, canonicalJsonBytes, semanticHash } from "./canonical.js";
import { generateKeys, loadPublicKeyHex } from "./keys.js";
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
import { controlTotals, groupedNumericColumns } from "./totals.js";
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
  return code;
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
const commands = { keygen: cmdKeygen, ingest: cmdIngest, verify: cmdVerify, export: cmdExport };
if (!command || !(command in commands)) {
  console.error(USAGE);
  process.exit(command ? 1 : 0);
}
process.exit(commands[command](rest));
