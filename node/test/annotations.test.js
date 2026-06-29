// Signed annotation record (plan U1), Node side. Mirrors
// tests/test_annotations.py and pins the same cross-stack canonical hash.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  annotationBodyHash,
  buildAnnotation,
  readAnnotations,
  resolveAnnotations,
  writeAnnotation,
} from "../annotations.js";
import { canonicalJsonBytes } from "../canonical.js";
import { generateKeys, loadPrivateKey, publicHexFromPrivate } from "../keys.js";
import { verifySignature } from "../receipts.js";

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "tsann-"));
  generateKeys(join(dir, "keys"));
  const priv = loadPrivateKey(join(dir, "keys", "signing.key"));
  return { dir, priv, pub: publicHexFromPrivate(priv) };
}

const TARGET = "cc".repeat(32);

test("signed annotation verifies; tampering reason/author/target breaks it", () => {
  const { priv, pub } = seed();
  const ann = buildAnnotation({ target: TARGET, reason: "fixed a typo", author: "Jeff", privateKey: priv });
  assert.equal(ann.kind, "annotation");
  assert.ok(verifySignature(ann, pub));
  for (const field of ["reason", "author", "target"]) {
    const t = buildAnnotation({ target: TARGET, reason: "r", author: "a", privateKey: priv });
    t[field] = "x".repeat(64);
    assert.ok(!verifySignature(t, pub), `${field} tamper not caught`);
  }
});

test("missing author allowed; numeric-looking author stays a string", () => {
  const { priv, pub } = seed();
  const bare = buildAnnotation({ target: TARGET, reason: "no author", privateKey: priv });
  assert.equal(bare.author, "");
  assert.ok(verifySignature(bare, pub));
  for (const author of ["030", "1E+2", "30.00"]) {
    const a = buildAnnotation({ target: TARGET, reason: "r", author, privateKey: priv });
    const body = {};
    for (const k of Object.keys(a)) if (k !== "signature") body[k] = a[k];
    assert.ok(canonicalJsonBytes(body).toString("utf-8").includes(`"author":"${author}"`));
    assert.ok(verifySignature(a, pub));
  }
});

test("supersede marks prior (both retained); unknown target and dangling pointer handled", () => {
  const { dir, priv, pub } = seed();
  const valid = new Set([TARGET]);
  const first = buildAnnotation({ target: TARGET, reason: "hasty", author: "a", privateKey: priv, createdAt: "2026-06-01T00:00:00Z" });
  writeAnnotation(dir, first);
  const correction = buildAnnotation({ target: TARGET, reason: "fixed", author: "a", supersedes: annotationBodyHash(first), privateKey: priv, createdAt: "2026-06-02T00:00:00Z" });
  writeAnnotation(dir, correction);
  const stray = buildAnnotation({ target: "ff".repeat(32), reason: "bound to nothing", privateKey: priv });
  writeAnnotation(dir, stray);

  const resolved = resolveAnnotations(readAnnotations(dir), pub, valid);
  assert.equal(resolved.length, 2); // stray dropped: unknown target
  const byHash = Object.fromEntries(resolved.map((a) => [a._hash, a]));
  assert.equal(byHash[annotationBodyHash(first)]._superseded, true);
  assert.equal(byHash[annotationBodyHash(correction)]._superseded, false);
});

test("forged-signature annotation is dropped by resolution", () => {
  const { dir, priv, pub } = seed();
  const ann = buildAnnotation({ target: TARGET, reason: "r", author: "a", privateKey: priv });
  ann.reason = "rewritten after signing";
  writeAnnotation(dir, ann);
  assert.deepEqual(resolveAnnotations(readAnnotations(dir), pub, new Set([TARGET])), []);
});

test("annotation canonical bytes are pinned cross-stack", () => {
  const body = {
    kind: "annotation",
    spec_version: "1.2",
    created_at: "2026-06-12T00:00:00Z",
    target: "aa".repeat(32),
    reason: "corrected the spend total",
    author: "030",
    supersedes: "bb".repeat(32),
  };
  assert.equal(
    createHash("sha256").update(canonicalJsonBytes(body)).digest("hex"),
    "5122e95e7ded8b937d8f8ed3a8ea9197addd9e2f93dd6575af5b1fbdc3a9fefb",
  );
});
