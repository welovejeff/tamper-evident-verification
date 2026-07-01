// Signed annotations: a reason + self-declared author bound to a receipt by the
// receipt's content hash, signed so the binding is tamper-evident; corrections
// supersede by hash and nothing is overwritten. Mirror of
// tamper_signal/annotations.py — the two stacks produce byte-identical
// annotation records (JCS sorts keys, so insertion order is irrelevant).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJsonBytes } from "./canonical.js";
import { SPEC_VERSION, nowIso, signBody, verifySignature } from "./receipts.js";

export const ANNOTATIONS_DIRNAME = "annotations";

function annotationBody(annotation) {
  // Exclude the signature and any transient underscore-prefixed key (the
  // _hash/_superseded that resolveAnnotations adds), so re-hashing a resolved
  // item yields the same content address as the original signed body.
  const body = {};
  for (const k of Object.keys(annotation)) {
    if (k !== "signature" && !k.startsWith("_")) body[k] = annotation[k];
  }
  return body;
}

export function annotationBodyHash(annotation) {
  return createHash("sha256").update(canonicalJsonBytes(annotationBody(annotation))).digest("hex");
}

export function buildAnnotation({ target, reason, author = "", supersedes = null, privateKey, createdAt = null }) {
  const body = {
    kind: "annotation",
    spec_version: SPEC_VERSION,
    created_at: createdAt ?? nowIso(),
    target,
    reason,
    author,
  };
  if (supersedes !== null) body.supersedes = supersedes;
  return signBody(body, privateKey);
}

export function writeAnnotation(chainDir, annotation) {
  const dir = join(chainDir, ANNOTATIONS_DIRNAME);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${annotationBodyHash(annotation)}.json`);
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(annotation, null, 2) + "\n");
  return path;
}

export function readAnnotations(chainDir) {
  const dir = join(chainDir, ANNOTATIONS_DIRNAME);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), "utf-8")));
    } catch {
      // Unreadable or non-JSON file: skip, never fatal.
    }
  }
  return out;
}

// Filter to verifying, well-bound annotations and apply supersession. Drops any
// annotation whose signature fails, whose target is not a known receipt hash, or
// whose supersedes pointer dangles. `validTargets` is a Set of receipt content
// hashes (chain.json receipt_hashes values).
export function resolveAnnotations(annotations, publicHex, validTargets) {
  const survivors = [];
  for (const a of annotations) {
    if (!a || typeof a !== "object" || a.kind !== "annotation") continue;
    if (!validTargets.has(a.target)) continue;
    if (!verifySignature(a, publicHex)) continue;
    survivors.push([annotationBodyHash(a), a]);
  }
  const present = new Set(survivors.map(([h]) => h));
  const superseded = new Set();
  for (const [, a] of survivors) {
    if (typeof a.supersedes === "string" && present.has(a.supersedes)) superseded.add(a.supersedes);
  }
  const resolved = survivors.map(([h, a]) => ({ ...a, _hash: h, _superseded: superseded.has(h) }));
  resolved.sort((x, y) => {
    const kx = (x.created_at || "") + x._hash;
    const ky = (y.created_at || "") + y._hash;
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  return resolved;
}
