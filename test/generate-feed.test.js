import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/generate-feed.js", import.meta.url));

function writeJSON(path, data) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "ai-trend-generate-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "archives"), { recursive: true });
  writeJSON(join(root, "config", "default-sources.json"), {
    folo: { listId: "list-1", title: "Sources", cliPackage: "fake-folocli" },
    schedule: { timeZone: "UTC" },
    lookbackHours: { x: 24, blogs: 72, podcasts: 336 },
    retention: { archiveDays: 7 },
    limits: {
      timelinePageSize: 50,
      maxTimelinePages: 1,
      maxTweetsPerBuilder: 3,
      maxArticlesPerBlog: 3,
      maxEntryGetConcurrency: 2,
      maxContentChars: 12000,
    },
  });
  return root;
}

function installFakeNpx(root, entries) {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "npx");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const entries = JSON.parse(process.env.FAKE_FOLO_ENTRIES);
const args = process.argv.slice(2);
const command = args.slice(2);
if (command[0] === "timeline") {
  console.log(JSON.stringify({ ok: true, data: { entries, hasNext: false, nextCursor: null } }));
  process.exit(0);
}
if (command[0] === "entry" && command[1] === "get") {
  const id = command[2];
  const item = entries.find((entry) => String((entry.entries || entry.entry || entry).id) === String(id));
  console.log(JSON.stringify({ ok: true, data: item || null }));
  process.exit(0);
}
console.error("unexpected fake npx args", JSON.stringify(args));
process.exit(2);
`,
  );
  chmodSync(scriptPath, 0o755);
  return binDir;
}

function tweet(id, url = `https://x.com/alice/status/${id}`) {
  return {
    feeds: {
      id: "feed-x",
      url: "rsshub://twitter/user/alice",
      title: "Twitter @alice",
      description: "AI builder",
    },
    entries: {
      id,
      guid: id,
      url,
      publishedAt: "2026-06-09T10:00:00.000Z",
      author: "Alice",
      content: `tweet ${id}`,
    },
  };
}

function blog(id, url = `https://blog.example/${id}`) {
  return {
    feeds: {
      id: "feed-blog",
      url: "https://blog.example/feed.xml",
      title: "AI Blog",
      description: "",
    },
    entries: {
      id,
      guid: id,
      url,
      title: `Post ${id}`,
      publishedAt: "2026-06-09T09:00:00.000Z",
      author: "Writer",
      content: `blog ${id}`,
      description: `description ${id}`,
    },
  };
}

function runGenerate(root, { entries = [tweet("tweet-1"), blog("blog-1")], args = [] } = {}) {
  const binDir = installFakeNpx(root, entries);
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AITRENDPUSH_ROOT_DIR: root,
      AITRENDPUSH_RUN_KEY: "2026-06-09",
      AITRENDPUSH_NOW: "2026-06-09T23:00:00.000Z",
      AITRENDPUSH_TIMEZONE: "UTC",
      FAKE_FOLO_ENTRIES: JSON.stringify(entries),
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });
}

function emptyArchive(runKey) {
  return {
    generatedAt: `${runKey}T23:00:00.000Z`,
    runKey,
    source: { provider: "folo", listId: "list-1", listTitle: "Sources" },
    x: [],
    blogs: [],
    podcasts: [],
    stats: { xBuilders: 0, totalTweets: 0, blogPosts: 0, podcastEpisodes: 0 },
  };
}

test("generate writes a daily archive and prunes index to the latest seven archives", () => {
  const root = makeRoot();
  try {
    for (const runKey of [
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
    ]) {
      writeJSON(join(root, "archives", `${runKey}.json`), emptyArchive(runKey));
    }
    writeJSON(join(root, "state-feed.json"), {
      seenTweets: {},
      seenVideos: {},
      seenArticles: { "https://blog.example/seen": Date.parse("2026-06-08T00:00:00.000Z") },
      lastRunKey: null,
      lastRunAt: null,
    });

    const result = runGenerate(root, { entries: [tweet("tweet-1"), blog("blog-1"), blog("seen", "https://blog.example/seen")] });

    assert.equal(result.status, 0, result.stderr);
    const archive = readJSON(join(root, "archives", "2026-06-09.json"));
    assert.equal(archive.runKey, "2026-06-09");
    assert.equal(archive.stats.totalTweets, 1);
    assert.equal(archive.stats.blogPosts, 1);
    assert.equal(archive.blogs[0].url, "https://blog.example/blog-1");
    assert.equal(existsSync(join(root, "archives", "2026-06-01.json")), false);
    assert.equal(existsSync(join(root, "archives", "2026-06-02.json")), false);

    const index = readJSON(join(root, "feed-index.json"));
    assert.equal(index.retentionDays, 7);
    assert.deepEqual(index.archives.map((entry) => entry.runKey), [
      "2026-06-09",
      "2026-06-08",
      "2026-06-07",
      "2026-06-06",
      "2026-06-05",
      "2026-06-04",
      "2026-06-03",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate skips a non-force rerun for the same run key", () => {
  const root = makeRoot();
  try {
    const archivePath = join(root, "archives", "2026-06-09.json");
    writeJSON(archivePath, emptyArchive("2026-06-09"));
    writeJSON(join(root, "state-feed.json"), {
      seenTweets: {},
      seenVideos: {},
      seenArticles: {},
      lastRunKey: "2026-06-09",
      lastRunAt: "2026-06-09T01:00:00.000Z",
    });

    const result = runGenerate(root, { entries: [tweet("tweet-should-not-run")] });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readJSON(archivePath), emptyArchive("2026-06-09"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("force rerun merges into the existing daily archive without dropping old items", () => {
  const root = makeRoot();
  try {
    writeJSON(join(root, "archives", "2026-06-09.json"), archive("2026-06-09", {
      x: [
        {
          source: "x",
          name: "Alice",
          handle: "alice",
          bio: "AI builder",
          tweets: [
            { id: "tweet-old", text: "old", createdAt: "2026-06-09T08:00:00.000Z", url: "https://x.com/alice/status/old" },
          ],
        },
      ],
      blogs: [],
      podcasts: [],
    }));
    writeJSON(join(root, "state-feed.json"), {
      seenTweets: { "tweet-old": Date.now() },
      seenVideos: {},
      seenArticles: {},
      lastRunKey: "2026-06-09",
      lastRunAt: "2026-06-09T01:00:00.000Z",
    });

    const result = runGenerate(root, { entries: [tweet("tweet-new")], args: ["--force"] });

    assert.equal(result.status, 0, result.stderr);
    const mergedArchive = readJSON(join(root, "archives", "2026-06-09.json"));
    assert.deepEqual(mergedArchive.x[0].tweets.map((item) => item.id), ["tweet-old", "tweet-new"]);
    assert.equal(mergedArchive.stats.totalTweets, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function archive(runKey, { x, blogs, podcasts }) {
  return {
    generatedAt: `${runKey}T23:00:00.000Z`,
    runKey,
    source: { provider: "folo", listId: "list-1", listTitle: "Sources" },
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
