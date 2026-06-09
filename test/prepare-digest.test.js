import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SCRIPT_URL = new URL("../scripts/prepare-digest.js", import.meta.url).href;

function archive(runKey, { x = [], blogs = [], podcasts = [] } = {}) {
  return {
    generatedAt: `${runKey}T23:00:00.000Z`,
    runKey,
    source: { provider: "folo", listId: "list-1", listTitle: "AITrendPush Sources" },
    x,
    blogs,
    podcasts,
    stats: {
      xBuilders: x.length,
      totalTweets: x.reduce((sum, account) => sum + account.tweets.length, 0),
      blogPosts: blogs.length,
      podcastEpisodes: podcasts.length,
    },
  };
}

function fetchMap() {
  const index = {
    generatedAt: "2026-06-09T23:00:00.000Z",
    retentionDays: 7,
    archives: [
      {
        runKey: "2026-06-09",
        generatedAt: "2026-06-09T23:00:00.000Z",
        url: "https://example.test/archives/2026-06-09.json",
        stats: { xBuilders: 2, totalTweets: 2, blogPosts: 1, podcastEpisodes: 0 },
      },
      {
        runKey: "2026-06-08",
        generatedAt: "2026-06-08T23:00:00.000Z",
        url: "https://example.test/archives/2026-06-08.json",
        stats: { xBuilders: 1, totalTweets: 2, blogPosts: 2, podcastEpisodes: 0 },
      },
      {
        runKey: "2026-06-07",
        generatedAt: "2026-06-07T23:00:00.000Z",
        url: "https://example.test/archives/2026-06-07.json",
        stats: { xBuilders: 1, totalTweets: 1, blogPosts: 0, podcastEpisodes: 0 },
      },
    ],
  };

  return {
    "https://raw.githubusercontent.com/wadjj/AI-RnD-Digest/main/feed-index.json": index,
    "https://example.test/feed-index.json": index,
    "https://example.test/archives/2026-06-09.json": archive("2026-06-09", {
      x: [
        {
          source: "x",
          name: "Alice",
          handle: "alice",
          bio: "AI builder",
          tweets: [
            { id: "tweet-2", text: "second", createdAt: "2026-06-09T10:00:00.000Z", url: "https://x.com/a/2" },
          ],
        },
        {
          source: "x",
          name: "Bob",
          handle: "bob",
          bio: "",
          tweets: [
            { id: "tweet-3", text: "third", createdAt: "2026-06-09T11:00:00.000Z", url: "https://x.com/b/3" },
          ],
        },
      ],
      blogs: [
        { source: "blog", name: "Blog", title: "Post 2", url: "https://blog.example/2", publishedAt: "2026-06-09T08:00:00.000Z" },
      ],
    }),
    "https://example.test/archives/2026-06-08.json": archive("2026-06-08", {
      x: [
        {
          source: "x",
          name: "Alice",
          handle: "alice",
          bio: "AI builder",
          tweets: [
            { id: "tweet-1", text: "first", createdAt: "2026-06-08T10:00:00.000Z", url: "https://x.com/a/1" },
            { id: "tweet-2", text: "duplicate", createdAt: "2026-06-08T11:00:00.000Z", url: "https://x.com/a/2" },
          ],
        },
      ],
      blogs: [
        { source: "blog", name: "Blog", title: "Post 1", url: "https://blog.example/1", publishedAt: "2026-06-08T08:00:00.000Z" },
        { source: "blog", name: "Blog", title: "Post 2 duplicate", url: "https://blog.example/2", publishedAt: "2026-06-08T09:00:00.000Z" },
      ],
    }),
    "https://example.test/archives/2026-06-07.json": archive("2026-06-07", {
      x: [
        {
          source: "x",
          name: "Carol",
          handle: "carol",
          bio: "",
          tweets: [
            { id: "tweet-0", text: "old", createdAt: "2026-06-07T10:00:00.000Z", url: "https://x.com/c/0" },
          ],
        },
      ],
    }),
  };
}

function runPrepare({ userConfig, map = fetchMap() } = {}) {
  const homeDir = mkdtempSync(join(tmpdir(), "ai-trend-push-"));
  if (userConfig) {
    const configDir = join(homeDir, ".ai-trend-push");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify(userConfig));
  }

  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        const map = JSON.parse(process.env.FETCH_MAP);
        global.fetch = async (url) => {
          const value = map[String(url)];
          if (value === undefined) {
            return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
          }
          if (value === "__THROW__") throw new Error("simulated network down");
          return {
            ok: true,
            json: async () => value,
            text: async () => typeof value === "string" ? value : JSON.stringify(value),
          };
        };
        await import(${JSON.stringify(SCRIPT_URL)});
      `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        AITRENDPUSH_USE_REMOTE: "1",
        HOME: homeDir,
        FETCH_MAP: JSON.stringify(map),
      },
    },
  );

  rmSync(homeDir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("remote mode defaults to a two-day archive window and dedupes merged items", () => {
  const output = runPrepare();

  assert.equal(output.status, "ok");
  assert.equal(output.config.frequencyDays, 2);
  assert.equal(output.config.deliveryTime, "09:00");
  assert.deepEqual(output.config.schedule, { intervalDays: 2, time: "09:00", timezone: "default" });
  assert.deepEqual(output.digestWindow.runKeys, ["2026-06-08", "2026-06-09"]);
  assert.equal(output.digestWindow.days, 2);
  assert.equal(output.stats.totalTweets, 3);
  assert.equal(output.stats.xBuilders, 2);
  assert.equal(output.stats.blogPosts, 2);
  assert.deepEqual(output.x.map((account) => account.name), ["Alice", "Bob"]);
  assert.deepEqual(output.x[0].tweets.map((tweet) => tweet.id), ["tweet-1", "tweet-2"]);
});

test("remote mode uses the configured one-day archive window and delivery time", () => {
  const output = runPrepare({ userConfig: { language: "zh", frequencyDays: 1, deliveryTime: "08:30", delivery: { method: "stdout" } } });

  assert.equal(output.config.frequencyDays, 1);
  assert.equal(output.config.deliveryTime, "08:30");
  assert.deepEqual(output.config.schedule, { intervalDays: 1, time: "08:30", timezone: "default" });
  assert.deepEqual(output.digestWindow.runKeys, ["2026-06-09"]);
  assert.equal(output.stats.totalTweets, 2);
  assert.equal(output.stats.blogPosts, 1);
});

test("frequencyDays is clamped to the supported 1-7 day window", () => {
  const output = runPrepare({ userConfig: { language: "zh", frequencyDays: 12, delivery: { method: "stdout" } } });

  assert.equal(output.config.frequencyDays, 7);
  assert.deepEqual(output.digestWindow.runKeys, ["2026-06-07", "2026-06-08", "2026-06-09"]);
  assert.ok(output.errors.some((error) => error.includes("frequencyDays")));
});

test("remote mode reports archive fetch failures instead of using bundled stale feeds", () => {
  const map = fetchMap();
  map["https://example.test/archives/2026-06-09.json"] = "__THROW__";

  const output = runPrepare({ userConfig: { language: "zh", frequencyDays: 1, delivery: { method: "stdout" } }, map });

  assert.equal(output.status, "error");
  assert.equal(output.stats.totalTweets, 0);
  assert.equal(output.stats.blogPosts, 0);
  assert.ok(output.errors.some((error) => error.includes("Could not fetch remote archive")));
});

test("remote mode reports index fetch failures instead of using bundled stale feeds", () => {
  const map = fetchMap();
  map["https://raw.githubusercontent.com/wadjj/AI-RnD-Digest/main/feed-index.json"] = "__THROW__";

  const output = runPrepare({ map });

  assert.equal(output.status, "error");
  assert.deepEqual(output.digestWindow.runKeys, []);
  assert.equal(output.stats.totalTweets, 0);
  assert.equal(output.stats.blogPosts, 0);
  assert.ok(output.errors.some((error) => error.includes("Could not fetch remote feed index")));
});
