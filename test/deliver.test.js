import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/deliver.js", import.meta.url));

function makeUserDir(config = {}) {
  const userDir = mkdtempSync(join(tmpdir(), "ai-rnd-deliver-"));
  writeFileSync(join(userDir, "config.json"), JSON.stringify(config));
  return userDir;
}

function runDeliver(userDir, args = [], input = "") {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      AITRENDPUSH_USER_DIR: userDir,
      TELEGRAM_BOT_TOKEN: "",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
    },
  });
}

test("stdout delivery prints the digest text", () => {
  const userDir = makeUserDir({ delivery: { method: "stdout" } });
  try {
    const result = runDeliver(userDir, ["--message", "AI digest"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "AI digest");
  } finally {
    rmSync(userDir, { recursive: true, force: true });
  }
});

test("file input is delivered through stdout", () => {
  const userDir = makeUserDir({ delivery: { method: "stdout" } });
  const filePath = join(userDir, "digest.txt");
  writeFileSync(filePath, "Digest from file");
  try {
    const result = runDeliver(userDir, ["--file", filePath]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "Digest from file");
  } finally {
    rmSync(userDir, { recursive: true, force: true });
  }
});

test("empty digest text is skipped", () => {
  const userDir = makeUserDir({ delivery: { method: "stdout" } });
  try {
    const result = runDeliver(userDir, [], "");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { status: "skipped", reason: "empty digest text" });
  } finally {
    rmSync(userDir, { recursive: true, force: true });
  }
});

test("telegram delivery reports missing token clearly", () => {
  const userDir = makeUserDir({ delivery: { method: "telegram", chatId: "123" } });
  try {
    const result = runDeliver(userDir, ["--message", "AI digest"]);
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "error");
    assert.equal(output.method, "telegram");
    assert.match(output.message, /TELEGRAM_BOT_TOKEN/);
  } finally {
    rmSync(userDir, { recursive: true, force: true });
  }
});
