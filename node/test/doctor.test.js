import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = join(import.meta.dirname, "..", "..");
const cli = join(repoRoot, "node", "cli.js");

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), "tamper-doctor-"));

  mkdirSync(join(dir, "keys"), { recursive: true });
  mkdirSync(join(dir, "receipts"), { recursive: true });

  writeFileSync(
    join(dir, "keys", "signing.key"),
    "test-private-key\n",
  );

  writeFileSync(
    join(dir, ".gitignore"),
    "keys/\n*.key\n",
  );

  return dir;
}

function runDoctor(dir, ...args) {
  return execFileSync(
    process.execPath,
    [cli, "doctor", ...args],
    {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function runDoctorResult(dir, ...args) {
  const result = {
    stdout: "",
    stderr: "",
    status: 0,
  };

  try {
    result.stdout = runDoctor(dir, ...args);
  } catch (error) {
    result.stdout = error.stdout?.toString() ?? "";
    result.stderr = error.stderr?.toString() ?? "";
    result.status = error.status ?? 1;
  }

  return result;
}

test("doctor --json returns the expected payload shape", () => {
  const dir = makeProject();

  const result = runDoctorResult(dir, "--json");

  assert.notEqual(result.stdout, "");

  const payload = JSON.parse(result.stdout);

  assert.ok(Array.isArray(payload.checks));
  assert.ok(Array.isArray(payload.warnings));
  assert.equal(typeof payload.all_passed, "boolean");

  for (const check of payload.checks) {
    assert.equal(typeof check.name, "string");
    assert.equal(typeof check.ok, "boolean");
    assert.equal(typeof check.fix, "string");
  }
});

test("doctor detects a missing private key", () => {
  const dir = makeProject();

  const keyPath = join(dir, "keys", "signing.key");
  assert.equal(existsSync(keyPath), true);

  rmSync(keyPath);

  const result = runDoctorResult(dir, "--json");
  const payload = JSON.parse(result.stdout);

  const keyCheck = payload.checks.find((check) =>
    check.name.startsWith("private key at"),
  );

  assert.ok(keyCheck);
  assert.equal(keyCheck.ok, false);
  assert.match(keyCheck.fix, /tamper-signal init/);
  assert.equal(payload.all_passed, false);
});

test("doctor detects a tracked private key", () => {
  const dir = makeProject();

  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync(
    "git",
    ["config", "user.email", "test@example.com"],
    { cwd: dir },
  );
  execFileSync(
    "git",
    ["config", "user.name", "Doctor Test"],
    { cwd: dir },
  );

  execFileSync(
    "git",
    ["add", "-f", "keys/signing.key"],
    { cwd: dir },
  );

  const result = runDoctorResult(dir, "--json");
  const payload = JSON.parse(result.stdout);

  const trackedCheck = payload.checks.find((check) =>
    check.name === "private key is not tracked by git",
  );

  assert.ok(trackedCheck);
  assert.equal(trackedCheck.ok, false);
  assert.equal(payload.all_passed, false);
});

test("doctor warns when gitignore does not cover keys", () => {
  const dir = makeProject();

  writeFileSync(
    join(dir, ".gitignore"),
    "node_modules/\n",
  );

  const result = runDoctorResult(dir, "--json");
  const payload = JSON.parse(result.stdout);

  assert.ok(
    payload.warnings.some((warning) =>
      warning.includes(".gitignore does not mention keys/ or *.key"),
    ),
  );
});

test("doctor reports a missing chain", () => {
  const dir = makeProject();

  const result = runDoctorResult(dir, "--json");
  const payload = JSON.parse(result.stdout);

  assert.ok(
    payload.warnings.some((warning) =>
      warning.includes("no chain at receipts/chain.json"),
    ),
  );
});

test("doctor reports a broken chain", () => {
  const dir = makeProject();

  mkdirSync(join(dir, "receipts"), { recursive: true });

  writeFileSync(
    join(dir, "receipts", "chain.json"),
    JSON.stringify({
      receipts: ["missing-receipt.json"],
      public_key: "00",
    }, null, 2),
  );

  const result = runDoctorResult(dir, "--json");
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.all_passed, false);
  assert.ok(
    payload.checks.some((check) =>
      check.ok === false &&
      (
        check.name.startsWith("chain loads") ||
        check.name.startsWith("chain verifies")
      ),
    ),
  );
});
