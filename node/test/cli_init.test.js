import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = join(process.cwd(), "node", "cli.js");

function runInit(cwd, ...args) {
  return execFileSync(process.execPath, [CLI, "init", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("init: first run creates keys, gitignore, and receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-init-"));

  const output = runInit(dir);

  assert.match(output, /generated keys/);
  assert.match(output, /gitignore/);
  assert.match(output, /receipts/);

  assert.equal(statSync(join(dir, "keys", "signing.key")).isFile(), true);
  assert.equal(statSync(join(dir, "keys", "signing.pub")).isFile(), true);
  assert.equal(statSync(join(dir, "receipts")).isDirectory(), true);

  const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
  assert.match(gitignore, /# Tamper Signal: never commit private key material/);
  assert.match(gitignore, /^keys\/$/m);
  assert.match(gitignore, /^\*\.key$/m);
});

test("init: second run is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-init-"));

  runInit(dir);

  const privateKeyPath = join(dir, "keys", "signing.key");
  const beforeKey = readFileSync(privateKeyPath, "utf8");
  const beforeGitignore = readFileSync(join(dir, ".gitignore"), "utf8");

  const output = runInit(dir);

  const afterKey = readFileSync(privateKeyPath, "utf8");
  const afterGitignore = readFileSync(join(dir, ".gitignore"), "utf8");

  assert.equal(afterKey, beforeKey);
  assert.equal(afterGitignore, beforeGitignore);
  assert.match(output, /already exists/);
  assert.match(output, /already covers/);
});

test("init: preserves existing gitignore entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "tamper-signal-init-"));

  writeFileSync(
    join(dir, ".gitignore"),
    "# Existing project rules\nnode_modules/\nkeys/\n*.key\n"
  );

  runInit(dir);

  const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");

  assert.match(gitignore, /node_modules\//);
  assert.match(gitignore, /keys\//);
  assert.match(gitignore, /\*\.key/);
});
