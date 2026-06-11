// Ed25519 keys: the Node port of tamper_signal/keys.py. Same on-disk formats
// (PKCS8 PEM private key, raw 32-byte hex public key) so the two CLIs are
// interchangeable on one project.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PRIVATE_KEY_NAME = "signing.key";
export const PUBLIC_KEY_NAME = "signing.pub";

// SPKI DER for Ed25519 is a fixed 12-byte header followed by the raw key.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function keyFingerprint(publicKeyBytes) {
  return createHash("sha256").update(publicKeyBytes).digest("hex").slice(0, 16);
}

function rawFromPublicKey(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

export function publicKeyFromHex(publicHex) {
  const raw = Buffer.from(publicHex, "hex");
  if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function generateKeys(outDir) {
  mkdirSync(outDir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePath = join(outDir, PRIVATE_KEY_NAME);
  const publicPath = join(outDir, PUBLIC_KEY_NAME);
  writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
  try {
    chmodSync(privatePath, 0o600);
  } catch {
    // best effort, matching the Python side
  }
  writeFileSync(publicPath, rawFromPublicKey(publicKey).toString("hex") + "\n");
  return { privatePath, publicPath };
}

// When TAMPER_SIGNAL_KEY is set, its contents (the PEM text) are used instead
// of the file, so CI pipelines can sign without a key file on disk.
export function loadPrivateKey(path) {
  const env = process.env.TAMPER_SIGNAL_KEY;
  return createPrivateKey(env || readFileSync(path));
}

export function loadPublicKeyHex(path) {
  return readFileSync(path, "utf-8").trim();
}

export function publicHexFromPrivate(privateKey) {
  return rawFromPublicKey(createPublicKey(privateKey)).toString("hex");
}

export function sign(privateKey, message) {
  return cryptoSign(null, message, privateKey).toString("hex");
}

// Returns false (never throws) for bad signatures OR malformed inputs:
// receipt JSON is attacker-controlled in the tamper-evident model.
export function verify(publicHex, message, signatureHex) {
  try {
    if (typeof signatureHex !== "string" || !/^[0-9a-fA-F]+$/.test(signatureHex)) return false;
    return cryptoVerify(null, message, publicKeyFromHex(publicHex), Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
