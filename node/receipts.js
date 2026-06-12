// Receipt creation and chain verification: the Node port of
// tamper_signal/receipts.py. Chains written here verify with the Python CLI
// and the browser, and vice versa.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { canonicalJsonBytes } from "./canonical.js";
import { keyFingerprint, publicHexFromPrivate, sign, verify } from "./keys.js";
import { controlTotals, totalsDelta } from "./totals.js";

// 1.1: numeric-looking text canonicalizes as the number it parses to (cell
// normalization), so format round-trips that stringify numbers keep the
// semantic hash stable. Chains recorded under 1.0 still verify.
// 1.2: control totals gain optional per-period buckets. When exactly one
// column is date-shaped (>= 90% of its non-null values are typed Dates or
// ISO-shaped date strings, a bucketing-only rule), totals carry
// "bucket_column" and "period_buckets": per-UTC-day row_count, numeric_sums
// and null_counts, with unbucketable rows under "_unbucketed".
// Canonicalization is unchanged, so semantic hashes do not move; chains
// recorded under 1.0 and 1.1 still verify.
export const SPEC_VERSION = "1.2";
export const CHAIN_FILENAME = "chain.json";
export const SOURCE_RECEIPT_NAME = "000_source.json";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function codeHashOf(fn) {
  // Node has no inspect.getsource; the function's own toString() is the
  // closest stable equivalent. Code hashes are per-receipt metadata, not
  // chain links, so they never need to match across languages.
  return createHash("sha256").update(String(fn), "utf-8").digest("hex");
}

function signBody(body, privateKey) {
  const message = canonicalJsonBytes(body);
  const publicHex = publicHexFromPrivate(privateKey);
  return {
    ...body,
    signature: {
      alg: "ed25519",
      key_fingerprint: keyFingerprint(Buffer.from(publicHex, "hex")),
      value: sign(privateKey, message),
    },
  };
}

// `tolerance` is the producer's declared continuity expectation
// ({band: "<plain decimal string>", settle_hours: <int>, and optionally
// bucket_column: "<normalized name>"}). It joins the body before signing, so
// the signature covers it; absent declaration means absent field. The band is
// a decimal STRING because floats never enter signed bodies. `bucketColumn`
// threads to controlTotals so period_buckets key off the declared column (a
// non-qualifying name throws there).
export function buildSourceManifest({
  filename,
  evidenceHash,
  byteSize,
  declaredOrigin,
  semanticHash,
  records,
  privateKey,
  createdAt,
  tolerance = null,
  bucketColumn = null,
}) {
  const body = {
    kind: "source_manifest",
    spec_version: SPEC_VERSION,
    created_at: createdAt ?? nowIso(),
    source: {
      filename,
      evidence_hash: evidenceHash,
      byte_size: byteSize,
      declared_origin: declaredOrigin,
    },
    semantic_hash: semanticHash,
    control_totals: controlTotals(records, { bucketColumn }),
  };
  if (tolerance !== null) body.tolerance = tolerance;
  return signBody(body, privateKey);
}

export function buildTransformReceipt({
  name,
  codeHash,
  codeFile,
  inputSemanticHash,
  outputSemanticHash,
  outputRecords,
  privateKey,
  createdAt,
}) {
  return signBody(
    {
      kind: "transform_receipt",
      spec_version: SPEC_VERSION,
      created_at: createdAt ?? nowIso(),
      transform: { name, code_hash: codeHash, code_file: codeFile },
      input_semantic_hash: inputSemanticHash,
      output_semantic_hash: outputSemanticHash,
      output_control_totals: controlTotals(outputRecords),
    },
    privateKey
  );
}

// --- Defensive hash accessors mirroring the Python side. -------------------
const MISSING_OUTPUT = "<missing-output-hash>";
const MISSING_INPUT = "<missing-input-hash>";

const strAt = (receipt, keys, fallback) => {
  let cur = receipt;
  for (const key of keys) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !(key in cur)) return fallback;
    cur = cur[key];
  }
  return typeof cur === "string" ? cur : fallback;
};

const kindOf = (r) => (r !== null && typeof r === "object" ? r.kind : undefined);

export function outputHashOf(receipt) {
  if (kindOf(receipt) === "source_manifest") return strAt(receipt, ["semantic_hash"], MISSING_OUTPUT);
  return strAt(receipt, ["output_semantic_hash"], MISSING_OUTPUT);
}

export function inputHashOf(receipt) {
  if (kindOf(receipt) === "source_manifest") return null;
  return strAt(receipt, ["input_semantic_hash"], MISSING_INPUT);
}

export function totalsOf(receipt) {
  const key = kindOf(receipt) === "source_manifest" ? "control_totals" : "output_control_totals";
  const value = receipt !== null && typeof receipt === "object" ? receipt[key] : undefined;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function stageNameOf(receipt) {
  if (kindOf(receipt) === "source_manifest") return "source";
  return strAt(receipt, ["transform", "name"], "") || "<unknown>";
}

// --- Persistence ------------------------------------------------------------
function receiptBody(receipt) {
  const body = {};
  for (const k of Object.keys(receipt)) if (k !== "signature") body[k] = receipt[k];
  return body;
}

export function writeReceipt(chainDir, filename, receipt) {
  mkdirSync(chainDir, { recursive: true });
  const path = join(chainDir, filename);
  writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n");
  return path;
}

export function readReceipt(chainDir, filename) {
  // Receipt filenames come from chain.json, which is attacker-controlled.
  const base = resolve(chainDir);
  const target = resolve(base, filename);
  if (dirname(target) !== base || basename(target) !== filename) {
    throw new Error(`Unsafe receipt path outside chain directory: ${filename}`);
  }
  try {
    return JSON.parse(readFileSync(target, "utf-8"));
  } catch (err) {
    throw new Error(`Could not read receipt ${filename}: ${err.message}`);
  }
}

export function readChain(chainPath) {
  return JSON.parse(readFileSync(chainPath, "utf-8"));
}

export function receiptFileHashes(chainDir, receiptFiles) {
  // sha256 of each receipt file's raw bytes, keyed by filename.
  const out = {};
  for (const name of receiptFiles) {
    out[name] = createHash("sha256").update(readFileSync(join(chainDir, name))).digest("hex");
  }
  return out;
}

export function writeChain(chainDir, receiptFiles, publicHex) {
  // chain.json records the sha256 of each receipt file so it commits to the
  // receipt contents, not just their names: anchoring chain.json then
  // transitively witnesses every receipt. The receipt files must already be
  // on disk (every caller writes receipts before the chain).
  mkdirSync(chainDir, { recursive: true });
  const chain = {
    spec_version: SPEC_VERSION,
    public_key: publicHex,
    receipts: receiptFiles,
    receipt_hashes: receiptFileHashes(chainDir, receiptFiles),
  };
  const path = join(chainDir, CHAIN_FILENAME);
  writeFileSync(path, JSON.stringify(chain, null, 2) + "\n");
  return path;
}

export function readChainFiles(chainDir) {
  const chainPath = join(chainDir, CHAIN_FILENAME);
  if (!existsSync(chainPath)) return [];
  return readChain(chainPath).receipts ?? [];
}

export function loadReceipts(chainDir) {
  return readChainFiles(chainDir).map((name) => readReceipt(chainDir, name));
}

export function nextReceiptFilename(chainDir, transformName) {
  const index = readChainFiles(chainDir).length;
  return `${String(index).padStart(3, "0")}_${transformName}.json`;
}

// --- Verification -----------------------------------------------------------
export function verifySignature(receipt, publicHex) {
  const signature = receipt?.signature;
  if (!signature || !("value" in signature)) return false;
  let message;
  try {
    message = canonicalJsonBytes(receiptBody(receipt));
  } catch {
    return false;
  }
  return verify(publicHex, message, signature.value);
}

function coverageGaps(receiptNames) {
  const indices = [];
  for (const name of receiptNames) {
    const prefix = String(name).split("_", 1)[0];
    if (!/^[0-9]{3}$/.test(prefix)) return [];
    indices.push(parseInt(prefix, 10));
  }
  const gaps = [];
  if (indices.length && indices[0] !== 0) {
    gaps.push(`chain starts at ${String(indices[0]).padStart(3, "0")}, not 000`);
  }
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) {
      gaps.push(
        `numbering jumps ${String(indices[i - 1]).padStart(3, "0")} -> ${String(indices[i]).padStart(3, "0")}`
      );
    }
  }
  return gaps;
}

const short = (value) =>
  value === null || value === undefined
    ? "(none)"
    : value.length <= 10
      ? value
      : `${value.slice(0, 4)}...${value.slice(-2)}`;

// Mirrors _as_trusted_keys in tamper_signal/receipts.py; badge/badge.js
// checkSignatures inlines the same rule -- update all three in lockstep when
// the normalization changes.
function asTrustedKeys(publicHex) {
  if (publicHex === null || publicHex === undefined) return [];
  return (Array.isArray(publicHex) ? publicHex : [publicHex]).filter(Boolean);
}

// Mirrors tamper_signal/receipts.py verify_chain, including the yellow
// verdict. Returns { ok, verdict, caveats, lines, brokenLink, brokenLinkDetail,
// dataMismatch, receiptMismatch }.
export function verifyChain(receipts, publicHex, dataSemanticHash = null, dataTotals = null, options = {}) {
  const {
    chainPublicHex = null,
    receiptNames = null,
    warnDrift = false,
    recordedHashes = null,
    actualHashes = null,
  } = options;
  // publicHex may be a single trusted key or a list (key rotation).
  const trusted = asTrustedKeys(publicHex);
  const result = {
    ok: true,
    verdict: "green",
    caveats: [],
    lines: [],
    brokenLink: null,
    brokenLinkDetail: null,
    dataMismatch: null,
    receiptMismatch: null,
  };
  const fail = (...lines) => {
    result.ok = false;
    result.verdict = "red";
    result.lines.push(...lines);
  };

  if (!receipts.length) {
    fail("✗ CHAIN EMPTY: no receipts to verify");
    return result;
  }

  // 0) Receipt files against the hashes chain.json records. This is what
  // lets an anchored chain.json transitively witness receipt contents.
  if (recordedHashes !== null && actualHashes !== null) {
    const mismatched = (receiptNames ?? []).filter(
      (name) => actualHashes[name] !== recordedHashes[name]
    );
    if (mismatched.length) {
      result.receiptMismatch = mismatched;
      for (const name of mismatched) {
        fail(
          `✗ RECEIPT FILE MISMATCH: ${name} does not match the hash ` +
            "recorded in chain.json; the receipt was rewritten after the chain was"
        );
      }
      return result;
    }
  }

  // 1) Signatures, trusted keys first, chain key as fallback.
  const unrecognized = [];
  const useFallback = Boolean(chainPublicHex) && !trusted.includes(chainPublicHex);
  receipts.forEach((receipt, index) => {
    if (trusted.some((key) => verifySignature(receipt, key))) return;
    if (useFallback && verifySignature(receipt, chainPublicHex)) {
      unrecognized.push(index);
      return;
    }
    fail(`✗ SIGNATURE INVALID on receipt ${index} (${stageNameOf(receipt)})`);
  });
  if (!result.ok) return result;
  if (unrecognized.length) {
    const stages = unrecognized.map((i) => stageNameOf(receipts[i])).join(", ");
    const fp = (hex) => {
      try {
        return keyFingerprint(Buffer.from(hex, "hex"));
      } catch {
        return "<malformed key>";
      }
    };
    const fingerprints = trusted.map(fp).join(", ") || "(none)";
    result.caveats.push(
      `unrecognized signing key: ${unrecognized.length} receipt(s) (${stages}) verify under ` +
        `the chain's embedded key ${fp(chainPublicHex)}, not any of the ${trusted.length} trusted key(s) (${fingerprints})`
    );
  }

  // 2) Links.
  for (let index = 1; index < receipts.length; index++) {
    const expected = outputHashOf(receipts[index - 1]);
    const found = inputHashOf(receipts[index]);
    if (found !== expected) {
      result.brokenLink = index;
      const delta = totalsDelta(totalsOf(receipts[index - 1]), totalsOf(receipts[index]));
      result.brokenLinkDetail = {
        link: [index - 1, index],
        stage: stageNameOf(receipts[index]),
        expected_input_hash: expected,
        found_input_hash: found,
        totals_delta: delta,
      };
      fail(
        `✗ CHAIN BROKEN at link ${index - 1} -> ${index} (${stageNameOf(receipts[index])})`,
        `  expected input hash ${short(expected)}  (output of ${stageNameOf(receipts[index - 1])})`,
        `  found    input hash ${short(found)}`,
        `  Control totals delta vs upstream: ${delta.length ? delta.join(", ") : "(no totals changes detected)"}`
      );
      return result;
    }
  }

  // 3) Optional current-data check.
  if (dataSemanticHash !== null) {
    const final = receipts[receipts.length - 1];
    const expected = outputHashOf(final);
    if (dataSemanticHash !== expected) {
      const delta = dataTotals !== null ? totalsDelta(totalsOf(final), dataTotals) : null;
      result.dataMismatch = {
        stage: stageNameOf(final),
        expected_output_hash: expected,
        found_data_hash: dataSemanticHash,
        totals_delta: delta,
      };
      fail(
        `✗ DATA MISMATCH against final receipt (${stageNameOf(final)})`,
        `  expected output hash ${short(expected)}`,
        `  found    data hash   ${short(dataSemanticHash)}`,
        `  Control totals delta vs receipt: ${
          delta === null
            ? "(pass the data records to see which values moved)"
            : delta.length
              ? delta.join(", ")
              : "(no totals changes detected)"
        }`
      );
      return result;
    }
  }

  // 4) Yellow caveats; red findings above returned early.
  for (const gap of coverageGaps(receiptNames ?? [])) {
    result.caveats.push(`coverage gap: receipt ${gap}; a stage may have run without leaving a receipt`);
  }
  if (warnDrift) {
    for (let index = 1; index < receipts.length; index++) {
      const delta = totalsDelta(totalsOf(receipts[index - 1]), totalsOf(receipts[index]));
      if (delta.length) {
        result.caveats.push(
          `totals drift at link ${index - 1} -> ${index} (${stageNameOf(receipts[index])}): ${delta.join(", ")}`
        );
      }
    }
  }

  const rows = totalsOf(receipts[receipts.length - 1]).row_count ?? "?";
  const transforms = receipts.filter((r) => r.kind === "transform_receipt").length;
  if (result.caveats.length) {
    result.verdict = "yellow";
    result.lines.push(
      `⚠ CHAIN VERIFIES, WITH CAVEATS: ${receipts.length} receipts, ${transforms} transforms, final row_count ${rows}`
    );
    for (const caveat of result.caveats) result.lines.push(`  - ${caveat}`);
    result.lines.push("  A human should look.");
  } else {
    result.lines.push(
      `✓ CHAIN INTACT: ${receipts.length} receipts, ${transforms} transforms, final row_count ${rows}`
    );
  }
  return result;
}
