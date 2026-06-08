#!/usr/bin/env node

// AITrendPush digest input builder.
// Outputs one JSON blob for the agent: user config, feeds, stats, and prompts.

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const SCRIPT_DIR = decodeURIComponent(new URL(".", import.meta.url).pathname);
const ROOT_DIR = join(SCRIPT_DIR, "..");
const USER_DIR = join(homedir(), ".ai-trend-push");
const CONFIG_PATH = join(USER_DIR, "config.json");
const PROJECT_CONFIG_PATH = join(ROOT_DIR, "config", "default-sources.json");

const PROMPT_FILES = [
  "summarize-podcast.md",
  "summarize-tweets.md",
  "summarize-blogs.md",
  "digest-intro.md",
  "translate.md",
];

async function readJSON(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return fallback;
  }
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

async function loadFeed(name, remoteUrl, errors) {
  const useRemote = process.env.AITRENDPUSH_USE_REMOTE === "1";
  if (useRemote && remoteUrl) {
    const remote = await fetchJSON(remoteUrl);
    if (remote) return remote;
    errors.push(`Could not fetch remote feed: ${remoteUrl}`);
  }

  const localPath = join(ROOT_DIR, name);
  const local = await readJSON(localPath);
  if (local) return local;
  errors.push(`Could not load local feed: ${name}`);
  return null;
}

async function loadPrompts(projectConfig, errors) {
  const prompts = {};
  const userPromptsDir = join(USER_DIR, "prompts");
  const localPromptsDir = join(ROOT_DIR, "prompts");
  const remoteBase = projectConfig.remote?.promptsBaseUrl;
  const useRemote = process.env.AITRENDPUSH_USE_REMOTE === "1";

  for (const filename of PROMPT_FILES) {
    const key = filename.replace(".md", "").replace(/-/g, "_");
    const userPath = join(userPromptsDir, filename);
    const localPath = join(localPromptsDir, filename);

    if (existsSync(userPath)) {
      prompts[key] = await readFile(userPath, "utf-8");
      continue;
    }
    if (useRemote && remoteBase) {
      const remote = await fetchText(`${remoteBase}/${filename}`);
      if (remote) {
        prompts[key] = remote;
        continue;
      }
    }
    if (existsSync(localPath)) {
      prompts[key] = await readFile(localPath, "utf-8");
      continue;
    }
    errors.push(`Could not load prompt: ${filename}`);
  }

  return prompts;
}

async function main() {
  const errors = [];
  const projectConfig = await readJSON(PROJECT_CONFIG_PATH, {});
  const userConfig = await readJSON(CONFIG_PATH, {});
  const config = {
    language: userConfig.language || "zh",
    frequency: userConfig.frequency || "daily",
    delivery: userConfig.delivery || { method: "stdout" },
  };

  const [feedX, feedPodcasts, feedBlogs] = await Promise.all([
    loadFeed("feed-x.json", projectConfig.remote?.feedXUrl, errors),
    loadFeed("feed-podcasts.json", projectConfig.remote?.feedPodcastsUrl, errors),
    loadFeed("feed-blogs.json", projectConfig.remote?.feedBlogsUrl, errors),
  ]);

  for (const [label, feed] of [
    ["Tweet", feedX],
    ["Podcast", feedPodcasts],
    ["Blog", feedBlogs],
  ]) {
    if (feed?.errors?.length) {
      errors.push(...feed.errors.map((error) => `${label} feed problem: ${error}`));
    }
  }

  const prompts = await loadPrompts(projectConfig, errors);

  const output = {
    status: "ok",
    generatedAt: new Date().toISOString(),
    config,
    source: {
      provider: "folo",
      listId: projectConfig.folo?.listId || process.env.FOLO_LIST_ID || null,
      listTitle: projectConfig.folo?.title || null,
    },
    podcasts: feedPodcasts?.podcasts || [],
    x: feedX?.x || [],
    blogs: feedBlogs?.blogs || [],
    stats: {
      podcastEpisodes: feedPodcasts?.podcasts?.length || 0,
      xBuilders: feedX?.x?.length || 0,
      totalTweets: (feedX?.x || []).reduce((sum, account) => sum + account.tweets.length, 0),
      blogPosts: feedBlogs?.blogs?.length || 0,
      feedGeneratedAt: feedX?.generatedAt || feedPodcasts?.generatedAt || feedBlogs?.generatedAt || null,
    },
    prompts,
    errors: errors.length > 0 ? errors : undefined,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ status: "error", message: err.message }));
  process.exit(1);
});
