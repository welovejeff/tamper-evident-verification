// The store-only zip writer used by `tamper-signal export --bundle`. The bundle
// must preserve entry bytes exactly (chain.json's receipt_hashes commit to raw
// receipt bytes), so these tests round-trip bytes through a minimal store-only
// reader and assert the archive structure is well-formed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { makeStoredZip } from "../zip.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

// Minimal store-only extractor: walk local file headers and slice out the
// (uncompressed) bytes. Sufficient to prove the writer's offsets and sizes.
function extractStored(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = {};
  let i = 0;
  while (i + 4 <= zip.length && view.getUint32(i, true) === 0x04034b50) {
    const method = view.getUint16(i + 8, true);
    const size = view.getUint32(i + 22, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const nameStart = i + 30;
    const name = dec.decode(zip.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    assert.equal(method, 0, "entries are stored, not compressed");
    out[name] = zip.subarray(dataStart, dataStart + size);
    i = dataStart + size;
  }
  return out;
}

test("makeStoredZip preserves entry bytes exactly", () => {
  const entries = [
    { name: "report.csv", bytes: enc.encode("a,b\n1,2\n") },
    { name: "chain.json", bytes: enc.encode('{"receipts":["000_source.json"]}\n') },
    { name: "000_source.json", bytes: enc.encode('{"kind":"source"}\n') },
  ];
  const zip = makeStoredZip(entries);
  const extracted = extractStored(zip);

  for (const { name, bytes } of entries) {
    assert.deepEqual(extracted[name], bytes, `bytes round-trip for ${name}`);
  }
});

test("makeStoredZip writes a valid end-of-central-directory record", () => {
  const entries = [{ name: "a.txt", bytes: enc.encode("hello") }];
  const zip = makeStoredZip(entries);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // EOCD signature sits 22 bytes from the end (no archive comment).
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, "EOCD signature present");
  assert.equal(view.getUint16(eocd + 10, true), entries.length, "total entry count");
});

test("makeStoredZip is deterministic for identical input", () => {
  const entries = [{ name: "x", bytes: enc.encode("same") }];
  assert.deepEqual(makeStoredZip(entries), makeStoredZip(entries));
});

// The browser Data tab inlines its own copy of this writer (badge/table.js can't
// import from node/), so guard against the two drifting: the inline copy must
// produce byte-identical archives. This caught a central-directory date-field
// offset bug the DOM-less unit tests could not reach.
test("the inline badge/table.js ZIP writer matches node/zip.js byte for byte", async () => {
  const src = readFileSync(new URL("../../badge/table.js", import.meta.url), "utf8");
  const start = src.indexOf("const _CRC_TABLE");
  const end = src.indexOf("function cellText");
  assert.ok(start !== -1 && end > start, "could not locate the inline ZIP writer in badge/table.js");
  const code = src.slice(start, end) + "\nexport { makeStoredZip };\n";
  const inline = await import("data:text/javascript," + encodeURIComponent(code));

  const entries = [
    { name: "report.csv", bytes: enc.encode("a,b\n1,2\n3,4\n") },
    { name: "chain.json", bytes: enc.encode('{"receipts":["000_source.json"]}\n') },
    { name: "000_source.json", bytes: enc.encode('{"kind":"source"}\n') },
  ];
  assert.deepEqual(inline.makeStoredZip(entries), makeStoredZip(entries));
});
