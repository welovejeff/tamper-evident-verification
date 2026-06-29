// The narrow, published provenance timeline (plan U3). Mirror of
// tamper_signal/timeline.py: the document a remote viewer fetches for the
// chain-of-custody view (imports, changes, annotations, a minimal reupload
// count), bound to the chain tail and signed when a key is available. Per-day
// buckets and run cadence stay CLI-local (KTD2). Entry key order matches the
// Python builder, so the written files are byte-identical across stacks.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readAnnotations, resolveAnnotations } from "./annotations.js";
import { SPEC_VERSION, nowIso, outputHashOf, signBody, stageNameOf, totalsOf } from "./receipts.js";

export const TIMELINE_FILENAME = "timeline.json";
const ARCHIVE_DIRNAME = "archive";
const NARROW_TOTALS_KEYS = ["row_count", "numeric_sums", "null_counts"];

function narrowTotals(receipt) {
  const totals = totalsOf(receipt);
  const out = {};
  for (const k of NARROW_TOTALS_KEYS) if (k in totals) out[k] = totals[k];
  return out;
}

export function buildTimeline(receipts, chain, chainDir, { key = null, createdAt = null } = {}) {
  const files = chain.receipts ?? [];
  const hashes = chain.receipt_hashes ?? {};
  const publicHex = chain.public_key ?? "";
  const resolved = resolveAnnotations(
    readAnnotations(chainDir),
    publicHex,
    new Set(Object.values(hashes)),
  );
  const byTarget = {};
  for (const a of resolved) (byTarget[a.target] ??= []).push(a);

  const entries = [];
  let prevRows = null;
  for (let index = 0; index < files.length; index++) {
    const receipt = receipts[index];
    const totals = narrowTotals(receipt);
    const rows = totals.row_count;
    const entry = {
      index,
      stage: stageNameOf(receipt),
      created_at: receipt.created_at ?? "",
      output_hash: outputHashOf(receipt),
      totals,
    };
    if (receipt.kind === "source_manifest") {
      entry.kind = "import";
      entry.origin = (receipt.source ?? {}).declared_origin ?? "";
    } else {
      entry.kind = "change";
      entry.code_hash = (receipt.transform ?? {}).code_hash ?? "";
      if (Number.isInteger(prevRows) && Number.isInteger(rows)) entry.row_delta = rows - prevRows;
    }
    const anns = byTarget[hashes[files[index]] ?? ""] ?? [];
    if (anns.length) {
      entry.annotations = anns.map((a) => ({
        reason: a.reason ?? "",
        author: a.author ?? "",
        self_declared: true,
        superseded: a._superseded ?? false,
        hash: a._hash ?? "",
      }));
    }
    entries.push(entry);
    if (Number.isInteger(rows)) prevRows = rows;
  }

  const body = {
    kind: "timeline",
    spec_version: SPEC_VERSION,
    created_at: createdAt ?? nowIso(),
    chain_tail: files.length ? hashes[files[files.length - 1]] ?? "" : "",
    public_key: publicHex,
    entries,
  };
  const archive = join(chainDir, ARCHIVE_DIRNAME);
  if (existsSync(archive)) {
    let count = 0;
    for (const name of readdirSync(archive)) {
      try {
        if (statSync(join(archive, name)).isDirectory()) count++;
      } catch {
        // unreadable entry: skip
      }
    }
    if (count) body.reuploads = { count }; // narrow: a count only, never contents
  }
  return key !== null ? signBody(body, key) : body;
}

export function writeTimeline(chainDir, timeline, out = null) {
  const path = out || join(chainDir, TIMELINE_FILENAME);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(timeline, null, 2) + "\n");
  return path;
}
