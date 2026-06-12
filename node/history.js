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

import {
  canonicalJsonBytes,
  codePointCompare,
  decimalToPlainString,
  parseDecimal,
} from "./canonical.js";
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
//
// `breached` is the baseline-advancement guard from cross-run judgment
// ({bucket_key: [metric, ...]}): bucket/metric pairs this run's judgment
// flagged as band breaches or settled movement. Later judgments refuse to
// advance baselines from those pairs, so a tampered value never becomes the
// baseline by surviving one yellow. Snapshots without the field (including
// every pre-1.2 snapshot) mean nothing breached.
export function buildRunSnapshot(receipts, chain, { privateKey = null, chainDir = null, createdAt = null, breached = null } = {}) {
  const source = receipts.length ? receipts[0] : {};

  const body = {
    kind: "run_snapshot",
    spec_version: SPEC_VERSION,
    created_at: createdAt ?? nowIso(),
    chain_tail_hash: chainTailHash(chainDir ?? ".", chain),
    source: runSource(receipts),
    stages: runStages(receipts),
  };
  if (breached !== null && typeof breached === "object" && Object.keys(breached).length) {
    body.breached = breached;
  }
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
export function archiveRunSnapshot(chainDir, chain, receipts, { privateKey = null, trustedKeys = [], onNotice = null, breached = null } = {}) {
  const tail = chainTailHash(chainDir, chain);
  const latest = latestSnapshot(chainDir, { trustedKeys, onNotice });
  if (latest !== null && latest.snapshot.chain_tail_hash === tail) return null;
  const snapshot = buildRunSnapshot(receipts, chain, { privateKey, chainDir, breached });
  return writeRunSnapshot(chainDir, snapshot);
}

// ---------------------------------------------------------------------------
// Cross-run judgment (U6): the Node port of tamper_signal/history.py
// judge_cross_run. Caveat strings, caveat_details JSON, notices, and the
// breached map are byte-identical across stacks for the same inputs. All
// arithmetic is exact BigInt decimal ({v, exp} pairs) on the decimal
// strings; floats never enter the math.
// ---------------------------------------------------------------------------

// Detail period key for the flat-band (whole-table) fallback comparison.
export const WHOLE_TABLE_PERIOD = "whole-table";

export const BUCKET_LOSS_CAVEAT = "bucket column no longer detected; period judgment unavailable";

const emptyJudgment = () => ({ caveats: [], details: [], notices: [], breached: {} });

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// --- exact decimal helpers ({v: BigInt, exp: number}) ----------------------
const negDec = (d) => ({ v: -d.v, exp: d.exp });
const subDec = (a, b) => {
  const exp = Math.min(a.exp, b.exp);
  return { v: a.v * 10n ** BigInt(a.exp - exp) - b.v * 10n ** BigInt(b.exp - exp), exp };
};
const absDec = (d) => (d.v < 0n ? negDec(d) : d);
const mulDec = (a, b) => ({ v: a.v * b.v, exp: a.exp + b.exp });
const isZeroDec = (d) => d.v === 0n;
function cmpDec(a, b) {
  const exp = Math.min(a.exp, b.exp);
  const av = a.v * 10n ** BigInt(a.exp - exp);
  const bv = b.v * 10n ** BigInt(b.exp - exp);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

// The source stage's totals in a snapshot, or null when unusable.
function sourceStageTotals(snapshot) {
  if (!Array.isArray(snapshot.stages)) return null;
  for (const stage of snapshot.stages) {
    if (isObj(stage) && stage.name === "source") {
      return isObj(stage.totals) ? stage.totals : null;
    }
  }
  return null;
}

const bucketsOf = (totals) => (isObj(totals.period_buckets) ? totals.period_buckets : null);

// bucket_end (24:00 UTC of the bucket's day) + the settling window, in ms.
// Non-date bucket keys (e.g. "_unbucketed") have no end of day: they never
// settle and are band-judged forever.
function bucketDeadlineMs(key, settleHours) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return ms + 86400000 + settleHours * 3600000;
}

// True when this snapshot's judgment flagged the bucket/metric pair. Tainted
// observations never advance baselines (the breached guard).
function tainted(snapshot, bucket, metric) {
  const breached = snapshot.breached;
  if (!isObj(breached)) return false;
  const metrics = breached[bucket];
  return Array.isArray(metrics) && metrics.includes(metric);
}

// A metric's exact-decimal value in a bucket entry or whole-table totals.
// Metric ids: "row_count", a numeric_sums column name, or
// "null_counts[<column>]" (absent null counts read as 0). Anything
// unparseable reads as null (silently out of scope), never a crash.
function metricValue(entry, metric) {
  if (!isObj(entry)) return null;
  if (metric === "row_count") {
    const value = entry.row_count;
    return typeof value === "number" && Number.isInteger(value) ? { v: BigInt(value), exp: 0 } : null;
  }
  if (metric.startsWith("null_counts[") && metric.endsWith("]")) {
    const nulls = isObj(entry.null_counts) ? entry.null_counts : {};
    const value = nulls[metric.slice("null_counts[".length, -1)] ?? 0;
    return typeof value === "number" && Number.isInteger(value) ? { v: BigInt(value), exp: 0 } : null;
  }
  const sums = isObj(entry.numeric_sums) ? entry.numeric_sums : {};
  const value = sums[metric];
  return typeof value === "string" ? parseDecimal(value) : null;
}

// Judged metric ids for a bucket: row_count, numeric sums, null counts.
function bucketMetricNames(...entries) {
  const sums = new Set();
  const nulls = new Set();
  for (const entry of entries) {
    if (isObj(entry)) {
      if (isObj(entry.numeric_sums)) for (const k of Object.keys(entry.numeric_sums)) sums.add(String(k));
      if (isObj(entry.null_counts)) for (const k of Object.keys(entry.null_counts)) nulls.add(String(k));
    }
  }
  return [
    "row_count",
    ...[...sums].sort(codePointCompare),
    ...[...nulls].sort(codePointCompare).map((k) => `null_counts[${k}]`),
  ];
}

// Flat-band metric ids: whole-table row_count plus numeric sums (R11).
function flatMetricNames(...totals) {
  const sums = new Set();
  for (const t of totals) {
    if (isObj(t) && isObj(t.numeric_sums)) for (const k of Object.keys(t.numeric_sums)) sums.add(String(k));
  }
  return ["row_count", ...[...sums].sort(codePointCompare)];
}

// Plain decimal string with an explicit sign: "+9", "-22", "+9.45".
function signedPlain(dec) {
  const sign = dec.v < 0n ? "-" : "+";
  return sign + decimalToPlainString(absDec(dec));
}

// Signed percent of delta against |base|, quantized to 0.1 round-half-even:
// "+9.2%". Sign follows the movement direction; the division is exact BigInt
// (matching Python's Decimal division + quantize).
function pctString(delta, base) {
  const dn = absDec(delta);
  const bn = absDec(base);
  const shift = dn.exp - bn.exp;
  let num = dn.v * 1000n;
  let den = bn.v;
  if (shift >= 0) num *= 10n ** BigInt(shift);
  else den *= 10n ** BigInt(-shift);
  let tenths = num / den;
  const rem = num % den;
  const twice = rem * 2n;
  if (twice > den || (twice === den && tenths % 2n === 1n)) tenths += 1n;
  const whole = tenths / 10n;
  const tenth = tenths % 10n;
  const text = tenth === 0n ? `${whole}` : `${whole}.${tenth}`;
  return `${delta.v < 0n ? "-" : "+"}${text}%`;
}

function makeRecord(type, metric, period, before, after, { zero = false, flat = false } = {}) {
  return { type, metric, period, before, after, zero, flat };
}

// Flat-band fallback: whole-table row_count + numeric sums, no zones.
function judgeFlat(baseTotals, currentTotals, band) {
  const records = [];
  for (const metric of flatMetricNames(baseTotals, currentTotals)) {
    const base = metricValue(baseTotals, metric);
    const cur = metricValue(currentTotals, metric);
    if (base === null || cur === null) continue;
    if (isZeroDec(base)) {
      if (!isZeroDec(cur)) {
        records.push(makeRecord("band_breach", metric, WHOLE_TABLE_PERIOD, base, cur, { zero: true, flat: true }));
      }
    } else if (cmpDec(absDec(subDec(cur, base)), mulDec(band, absDec(base))) > 0) {
      records.push(makeRecord("band_breach", metric, WHOLE_TABLE_PERIOD, base, cur, { flat: true }));
    }
  }
  return records;
}

// Two-zone judgment of every bucket present in the current run. `matching`
// is [{createdMs, snapshot, totals}] sorted oldest first.
function judgeBuckets(matching, currentBuckets, currentCreatedMs, band, settleHours) {
  const records = [];
  for (const key of Object.keys(currentBuckets).sort(codePointCompare)) {
    const entry = currentBuckets[key];
    if (!isObj(entry)) continue;
    const observations = [];
    for (const { createdMs, snapshot, totals } of matching) {
      const buckets = bucketsOf(totals);
      if (buckets === null) continue;
      const observed = buckets[key];
      if (isObj(observed)) observations.push({ createdMs, snapshot, observed });
    }
    if (!observations.length) continue; // no prior observation: never judged
    const priorCreatedMs = observations[observations.length - 1].createdMs;
    const deadlineMs = bucketDeadlineMs(key, settleHours);
    const settledAtPrior = deadlineMs !== null && priorCreatedMs > deadlineMs;

    for (const metric of bucketMetricNames(entry, observations[observations.length - 1].observed)) {
      const cur = metricValue(entry, metric);
      if (cur === null) continue;
      // The breached guard: baselines only come from observations whose
      // bucket/metric pair was not flagged in that run's judgment.
      const clean = observations.filter(
        (obs) => !tainted(obs.snapshot, key, metric) && metricValue(obs.observed, metric) !== null
      );
      if (!clean.length) continue;
      if (settledAtPrior) {
        // FROZEN: judged against the first post-window observation (the
        // settled baseline); a reappearing bucket with no post-window
        // history is judged against the most recent settling-era value.
        const post = clean.filter((obs) => obs.createdMs > deadlineMs);
        const baseEntry = post.length ? post[0].observed : clean[clean.length - 1].observed;
        const base = metricValue(baseEntry, metric);
        if (base === null || cmpDec(cur, base) === 0) continue;
        records.push(makeRecord("settled_movement", metric, key, base, cur));
      } else {
        const previous = metricValue(clean[clean.length - 1].observed, metric);
        const firstCreatedMs = clean[0].createdMs;
        const first = metricValue(clean[0].observed, metric);
        let breach = null;
        if (previous !== null) {
          if (isZeroDec(previous)) {
            if (!isZeroDec(cur)) breach = makeRecord("band_breach", metric, key, previous, cur, { zero: true });
          } else if (cmpDec(absDec(subDec(cur, previous)), mulDec(band, absDec(previous))) > 0) {
            breach = makeRecord("band_breach", metric, key, previous, cur);
          }
        }
        if (breach === null && first !== null) {
          const elapsedDays = Math.max(1, Math.ceil((currentCreatedMs - firstCreatedMs) / 86400000));
          if (isZeroDec(first)) {
            if (!isZeroDec(cur)) breach = makeRecord("band_breach", metric, key, first, cur, { zero: true });
          } else {
            const allowed = mulDec(mulDec(band, { v: BigInt(elapsedDays), exp: 0 }), absDec(first));
            if (cmpDec(absDec(subDec(cur, first)), allowed) > 0) {
              breach = makeRecord("band_breach", metric, key, first, cur);
            }
          }
        }
        if (breach !== null) records.push(breach);
      }
    }
  }
  return records;
}

// Interior disappearance: a bucket between the current run's min and max
// bucket keys, present in the latest older snapshot, absent now. Trailing-
// edge drops (rolling windows) are out of scope and silent.
function judgeRemovals(latestBuckets, currentBuckets) {
  const present = Object.keys(currentBuckets)
    .filter((k) => isObj(currentBuckets[k]) && bucketDeadlineMs(k, 0) !== null)
    .sort(codePointCompare);
  if (!present.length) return [];
  const lo = present[0];
  const hi = present[present.length - 1];
  const records = [];
  for (const key of Object.keys(latestBuckets).sort(codePointCompare)) {
    if (key in currentBuckets || bucketDeadlineMs(key, 0) === null) continue;
    if (lo <= key && key <= hi) {
      const before = metricValue(latestBuckets[key], "row_count");
      records.push(makeRecord("bucket_removed", null, key, before, null));
    }
  }
  return records;
}

// The worst record in a (type, metric) group; ties keep the earliest. Band
// breaches rank zero-baseline movement above everything, then by
// |delta| / |before| compared by cross-multiplication (exact); settled
// movement ranks by |delta|.
function pickWorst(type, items) {
  let best = items[0];
  for (const record of items.slice(1)) {
    if (type === "band_breach") {
      if (record.zero && !best.zero) {
        best = record;
      } else if (record.zero === best.zero && !record.zero) {
        const dR = absDec(subDec(record.after, record.before));
        const bR = absDec(record.before);
        const dB = absDec(subDec(best.after, best.before));
        const bB = absDec(best.before);
        if (cmpDec(mulDec(dR, bB), mulDec(dB, bR)) > 0) best = record;
      }
    } else if (type === "settled_movement") {
      if (cmpDec(absDec(subDec(record.after, record.before)), absDec(subDec(best.after, best.before))) > 0) {
        best = record;
      }
    }
  }
  return best;
}

function detailValues(record) {
  const before = record.before !== null ? decimalToPlainString(record.before) : null;
  const after = record.after !== null ? decimalToPlainString(record.after) : null;
  const delta =
    record.before !== null && record.after !== null
      ? signedPlain(subDec(record.after, record.before))
      : null;
  return { before, after, delta };
}

function rowsSuffix(metric, magnitude) {
  if (metric !== "row_count") return "";
  return magnitude !== null && cmpDec(absDec(magnitude), { v: 1n, exp: 0 }) === 0 ? " row" : " rows";
}

// Flood control: one caveat string and one details entry per (type, metric),
// naming the bucket count and the worst delta; the full per-bucket detail
// rides in caveat_details. Copy follows MESSAGING.md: lowercase, locates
// exactly, never blames, no em dashes, ASCII only.
function formatRecords(records, out) {
  const groups = new Map();
  for (const record of records) {
    const groupKey = `${record.type} ${record.metric ?? ""}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(record);
  }

  for (const groupKey of [...groups.keys()].sort(codePointCompare)) {
    const items = [...groups.get(groupKey)].sort((a, b) => codePointCompare(a.period, b.period));
    const type = items[0].type;
    const metric = items[0].metric;
    const count = items.length;

    if (type === "bucket_loss") {
      out.caveats.push(BUCKET_LOSS_CAVEAT);
      out.details.push({ type, metric: null, periods: 0, worst: null, buckets: [] });
      continue;
    }

    const worst = pickWorst(type, items);
    const { before, after, delta } = detailValues(worst);
    const worstEntry = { period: worst.period, before, after, delta };
    if (type === "band_breach" && !worst.zero) {
      worstEntry.delta_pct = pctString(subDec(worst.after, worst.before), worst.before);
    }
    const buckets = items.map((record) => {
      const values = detailValues(record);
      return { period: record.period, before: values.before, after: values.after, delta: values.delta };
    });
    out.details.push({ type, metric, periods: count, worst: worstEntry, buckets });

    if (type === "band_breach") {
      const display = worst.zero
        ? `0 -> ${after}${rowsSuffix(metric, worst.after)}`
        : worstEntry.delta_pct;
      if (worst.flat) {
        out.caveats.push(
          `totals drift beyond declared band: ${metric} moved ${display} ` +
            "against the previous run (whole-table comparison)"
        );
      } else {
        const plural = count === 1 ? "bucket" : "buckets";
        out.caveats.push(
          `totals drift beyond declared band: ${metric} breached in ` +
            `${count} ${plural}, worst ${worst.period} (${display})`
        );
      }
    } else if (type === "settled_movement") {
      const display = `${delta}${rowsSuffix(metric, subDec(worst.after, worst.before))}`;
      const plural = count === 1 ? "settled bucket" : "settled buckets";
      out.caveats.push(
        `settled period moved: ${metric} changed in ${count} ${plural}, ` +
          `worst ${worst.period} (${display})`
      );
    } else if (type === "bucket_removed") {
      const plural = count === 1 ? "bucket" : "buckets";
      const verb = count === 1 ? "is" : "are";
      out.caveats.push(
        `period buckets removed: ${count} interior ${plural} present in the ` +
          `previous run ${verb} absent from this run, worst ${items[0].period}`
      );
    }
  }

  // The baseline-advancement guard for the snapshot this run will write:
  // bucket/metric pairs that breached or moved while settled. Flat-band
  // (whole-table) findings are not bucket pairs and stay out of the map.
  const breached = new Map();
  for (const record of records) {
    if ((record.type === "band_breach" || record.type === "settled_movement") && !record.flat) {
      if (!breached.has(record.period)) breached.set(record.period, new Set());
      breached.get(record.period).add(record.metric);
    }
  }
  out.breached = {};
  for (const key of [...breached.keys()].sort(codePointCompare)) {
    out.breached[key] = [...breached.get(key)].sort(codePointCompare);
  }
}

// Judge the source manifest's period buckets against run history: the Node
// port of judge_cross_run (see tamper_signal/history.py for the full rule
// commentary). Pure and side-effect-free; takes the verified chain's
// receipts, the chain document, and validated snapshot bodies (as loaded by
// loadSnapshots); returns { caveats, details, notices, breached }.
export function judgeCrossRun(receipts, chain, snapshots, { now = null } = {}) {
  const out = emptyJudgment();
  const source = receipts.length && isObj(receipts[0]) ? receipts[0] : {};
  const tolerance = isObj(source.tolerance) ? source.tolerance : null;
  if (tolerance === null) return out;

  let band = null;
  if (typeof tolerance.band === "string") {
    const parsed = parseDecimal(tolerance.band);
    if (parsed !== null && parsed.v > 0n) band = parsed;
  }
  const settleRaw = tolerance.settle_hours;
  const settleOk = typeof settleRaw === "number" && Number.isInteger(settleRaw) && settleRaw >= 0;
  if (band === null || !settleOk) {
    out.notices.push("cross-run judgment skipped: tolerance declaration is malformed");
    return out;
  }
  const settleHours = settleRaw;

  const nowMs = now ?? Date.now();
  const tailReceipt = receipts.length && isObj(receipts[receipts.length - 1]) ? receipts[receipts.length - 1] : {};
  const currentCreatedMs = parseCreatedAt(tailReceipt.created_at) ?? nowMs;

  // The current run's own snapshot (re-verify) never judges itself.
  let tail = null;
  if (isObj(chain) && Array.isArray(chain.receipts) && chain.receipts.length && isObj(chain.receipt_hashes)) {
    const last = chain.receipts[chain.receipts.length - 1];
    if (typeof last === "string" && typeof chain.receipt_hashes[last] === "string") {
      tail = chain.receipt_hashes[last];
    }
  }

  const usable = [];
  for (const snapshot of snapshots) {
    if (!isObj(snapshot)) continue;
    if (tail !== null && snapshot.chain_tail_hash === tail) continue;
    const createdMs = parseCreatedAt(snapshot.created_at);
    if (createdMs === null) continue;
    usable.push({ createdMs, snapshot });
  }
  usable.sort((a, b) => a.createdMs - b.createdMs);

  if (!usable.length) {
    out.notices.push("no run history yet; cross-run judgment begins on the next verify");
    return out;
  }

  const older = usable.filter((item) => item.createdMs <= currentCreatedMs);
  if (!older.length) {
    out.notices.push("cross-run judgment skipped: archived runs are newer than this chain");
    return out;
  }

  const identity = runSource(receipts);
  const matching = [];
  for (const { createdMs, snapshot } of older) {
    const snapshotSource = snapshot.source;
    if (!isObj(snapshotSource)) continue;
    if (
      snapshotSource.filename !== identity.filename ||
      JSON.stringify(snapshotSource.columns ?? null) !== JSON.stringify(identity.columns)
    ) {
      continue;
    }
    const totals = sourceStageTotals(snapshot);
    if (totals === null) continue;
    matching.push({ createdMs, snapshot, totals });
  }
  if (!matching.length) {
    out.notices.push("cross-run judgment skipped: source identity differs from history");
    return out;
  }

  const currentTotals = totalsOf(receipts[0]);
  const currentBuckets = bucketsOf(currentTotals);
  const latestTotals = matching[matching.length - 1].totals;
  const latestBuckets = bucketsOf(latestTotals);

  const records = [];
  if (currentBuckets !== null && latestBuckets !== null) {
    records.push(...judgeBuckets(matching, currentBuckets, currentCreatedMs, band, settleHours));
    records.push(...judgeRemovals(latestBuckets, currentBuckets));
  } else if (currentBuckets !== null) {
    // Mixed spec (AE14): the previous run predates period buckets. The flat
    // band covers that comparison; bucket history starts fresh.
    out.notices.push(
      "previous run snapshot has no period buckets; compared whole-table totals under the flat band"
    );
    records.push(...judgeFlat(latestTotals, currentTotals, band));
  } else {
    if (latestBuckets !== null) {
      // The previous run had buckets and this one does not: the bucket
      // column went missing, so period judgment is unavailable. The flat
      // band still covers whole-table totals.
      records.push(makeRecord("bucket_loss", null, "", null, null));
    }
    records.push(...judgeFlat(latestTotals, currentTotals, band));
  }

  formatRecords(records, out);
  return out;
}
