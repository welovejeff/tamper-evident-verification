// The canonical vocabulary contract: badge.js exports VOCAB whose words and
// verdicts are copied VERBATIM from light.js's private WORDS/VERDICTS tables.
// light.js is byte-untouched by the room work, so this test reads both files
// and proves the literals never drift — one vocabulary in pill, strip, log
// line, CLI, and export README.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

globalThis.window = { location: { href: "http://localhost/" }, crypto: globalThis.crypto };

const { VOCAB } = await import("../../badge/badge.js");

function extractLiteral(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} literal not found in light.js`);
  const open = src.indexOf("{", start);
  const end = src.indexOf("};", open);
  return src.slice(open, end + 1);
}

test("VOCAB words/verdicts match light.js WORDS/VERDICTS verbatim", async () => {
  const lightSrc = readFileSync(new URL("../../badge/light.js", import.meta.url), "utf8");
  const code =
    `export const WORDS = ${extractLiteral(lightSrc, "WORDS")};\n` +
    `export const VERDICTS = ${extractLiteral(lightSrc, "VERDICTS")};\n`;
  const light = await import("data:text/javascript," + encodeURIComponent(code));
  assert.deepEqual(VOCAB.words, light.WORDS);
  assert.deepEqual(VOCAB.verdicts, light.VERDICTS);
});

test("VOCAB carries the room-only additions", () => {
  assert.equal(VOCAB.redStale, "NOT THE ATTESTED DATA");
  assert.equal(typeof VOCAB.directives.green, "string");
  assert.equal(typeof VOCAB.directives.redStale, "string");
  assert.equal(VOCAB.caveatJoiner, " · ");
});

test("the styling honesty rules hold at the source level", () => {
  const badgeSrc = readFileSync(new URL("../../badge/badge.js", import.meta.url), "utf8");
  // The unverifiable badge state is grey; the amber class died with the bug.
  assert.ok(!badgeSrc.includes("lb-amber"), "badge.js must not carry the lb-amber class");
  assert.ok(badgeSrc.includes("lb-grey"), "badge.js must style unverifiable grey");

  const roomSrc = readFileSync(new URL("../../badge/room.js", import.meta.url), "utf8");
  // Severed-link grammar appears exactly once, guarded by the broken ternary:
  // only a linkResult.ok === false hash mismatch may sever a link.
  const glyphAt = roomSrc.indexOf("──✗⚡✗──");
  assert.notEqual(glyphAt, -1);
  assert.equal(roomSrc.indexOf("──✗⚡✗──", glyphAt + 1), -1, "severed glyph must appear once");
  const glyphLine = roomSrc.slice(roomSrc.lastIndexOf("\n", glyphAt), roomSrc.indexOf("\n", glyphAt));
  assert.match(glyphLine, /broken \?/, "severed glyph must be gated on the broken link");
  // No unverifiable styling rule may reach for amber.
  for (const line of roomSrc.split("\n")) {
    if (line.includes('data-state="unverifiable"')) {
      assert.ok(!line.includes("amber"), `unverifiable rule wears amber: ${line.trim()}`);
    }
  }
});
