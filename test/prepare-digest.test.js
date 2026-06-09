import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("remote mode reports unavailable feeds instead of using bundled stale feed data", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "ai-rnd-digest-"));
  const scriptUrl = new URL("../scripts/prepare-digest.js", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        global.fetch = async () => {
          throw new Error("simulated network down");
        };
        await import(${JSON.stringify(scriptUrl)});
      `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        AITRENDPUSH_USE_REMOTE: "1",
        HOME: homeDir,
      },
    },
  );

  rmSync(homeDir, { recursive: true, force: true });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "error");
  assert.equal(output.stats.xBuilders, 0);
  assert.equal(output.stats.totalTweets, 0);
  assert.equal(output.stats.blogPosts, 0);
  assert.equal(output.stats.podcastEpisodes, 0);
  assert.ok(output.prompts.digest_intro.includes("AI R&D Digest"));
  assert.ok(output.errors.some((error) => error.includes("Could not fetch remote feed")));
});
