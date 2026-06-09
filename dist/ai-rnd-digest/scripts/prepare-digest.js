#!/usr/bin/env node

// AITrendPush digest input builder.
// Outputs one JSON blob for the agent: user config, feeds, stats, and prompts.

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const SCRIPT_DIR = decodeURIComponent(new URL(".", import.meta.url).pathname);
const ROOT_DIR = process.env.AITRENDPUSH_ROOT_DIR || join(SCRIPT_DIR, "..");
const USER_DIR = process.env.AITRENDPUSH_USER_DIR || join(homedir(), ".ai-trend-push");
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
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function normalizeFrequencyDays(value, projectConfig, errors) {
  const min = Number(projectConfig.digest?.minFrequencyDays ?? 1);
  const max = Number(projectConfig.digest?.maxFrequencyDays ?? 7);
  const fallback = Number(projectConfig.digest?.defaultFrequencyDays ?? 2);
  const parsed = Number(value ?? fallback);
  const raw = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  const normalized = Math.min(Math.max(raw, min), max);

  if (!Number.isFinite(parsed) || parsed !== normalized) {
    errors.push(`frequencyDays was clamped to ${normalized}; supported range is ${min}-${max}.`);
  }

  return normalized;
}

async function loadFeedIndex(projectConfig, errors) {
  const useRemote = process.env.AITRENDPUSH_USE_REMOTE === "1";
  if (useRemote) {
    const remoteUrl = projectConfig.remote?.feedIndexUrl;
    if (!remoteUrl) {
      errors.push("Missing remote feed index URL.");
      return null;
    }
    const remote = await fetchJSON(remoteUrl);
    if (remote) return remote;
    errors.push(`Could not fetch remote feed index: ${remoteUrl}`);
    return null;
  }

  const local = await readJSON(join(ROOT_DIR, "feed-index.json"));
  if (local) return local;
  errors.push("Could not load local feed index: feed-index.json");
  return null;
}

function selectArchiveEntries(index, days) {
  return [...(index?.archives || [])]
    .filter((entry) => entry?.runKey)
    .sort((a, b) => b.runKey.localeCompare(a.runKey))
    .slice(0, days)
    .sort((a, b) => a.runKey.localeCompare(b.runKey));
}

function remoteArchiveUrl(entry, projectConfig) {
  if (entry.url) return entry.url;
  const base = projectConfig.remote?.archivesBaseUrl;
  return base && entry.runKey ? `${base.replace(/\/$/, "")}/${entry.runKey}.json` : null;
}

async function loadArchive(entry, projectConfig, errors) {
  const useRemote = process.env.AITRENDPUSH_USE_REMOTE === "1";
  if (useRemote) {
    const url = remoteArchiveUrl(entry, projectConfig);
    if (!url) {
      errors.push(`Missing remote archive URL for ${entry.runKey}`);
      return null;
    }
    const archive = await fetchJSON(url);
    if (archive) return archive;
    errors.push(`Could not fetch remote archive: ${url}`);
    return null;
  }

  const relativePath = entry.path || join("archives", `${entry.runKey}.json`);
  const archive = await readJSON(join(ROOT_DIR, relativePath));
  if (archive) return archive;
  errors.push(`Could not load local archive: ${relativePath}`);
  return null;
}

function itemKey(item) {
  return item?.id || item?.url || item?.guid || item?.title || null;
}

function mergeXAccounts(archives) {
  const groups = new Map();

  for (const archive of archives) {
    for (const account of archive.x || []) {
      const groupKey = [account.source || "x", account.handle || "", account.name || ""].join("|");
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { ...account, tweets: [], _seen: new Set() });
      }
      const group = groups.get(groupKey);
      group.bio = group.bio || account.bio || "";
      group.handle = group.handle || account.handle || "";
      group.name = group.name || account.name || "Unknown";

      for (const tweet of account.tweets || []) {
        const key = itemKey(tweet);
        if (!key || group._seen.has(key)) continue;
        group._seen.add(key);
        group.tweets.push(tweet);
      }
    }
  }

  return [...groups.values()]
    .map(({ _seen, ...account }) => account)
    .filter((account) => account.tweets.length > 0);
}

function mergeUniqueItems(archives, field) {
  const seen = new Set();
  const merged = [];

  for (const archive of archives) {
    for (const item of archive[field] || []) {
      const key = itemKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}

function buildStats({ x, blogs, podcasts }, feedGeneratedAt) {
  return {
    podcastEpisodes: podcasts.length,
    xBuilders: x.length,
    totalTweets: x.reduce((sum, account) => sum + account.tweets.length, 0),
    blogPosts: blogs.length,
    feedGeneratedAt,
  };
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
  const frequencyDays = normalizeFrequencyDays(userConfig.frequencyDays, projectConfig, errors);
  const deliveryTime = userConfig.deliveryTime || "09:00";
  const config = {
    language: userConfig.language || "zh",
    frequencyDays,
    deliveryTime,
    schedule: {
      intervalDays: frequencyDays,
      time: deliveryTime,
      timezone: userConfig.timezone || "default",
    },
    delivery: userConfig.delivery || { method: "stdout" },
  };

  const feedIndex = await loadFeedIndex(projectConfig, errors);
  const selectedArchiveEntries = selectArchiveEntries(feedIndex, frequencyDays);
  if (feedIndex && selectedArchiveEntries.length === 0) {
    errors.push("Feed index did not contain any archives.");
  }
  const archives = await Promise.all(
    selectedArchiveEntries.map((entry) => loadArchive(entry, projectConfig, errors)),
  );
  const missingArchive = archives.some((archive) => !archive);
  const usableArchives = missingArchive ? [] : archives.filter(Boolean);
  for (const archive of usableArchives) {
    if (archive?.errors?.length) {
      errors.push(...archive.errors.map((error) => `Archive ${archive.runKey || "unknown"} problem: ${error}`));
    }
  }

  const prompts = await loadPrompts(projectConfig, errors);
  const contentUnavailable = !feedIndex || selectedArchiveEntries.length === 0 || missingArchive;
  const x = contentUnavailable ? [] : mergeXAccounts(usableArchives);
  const blogs = contentUnavailable ? [] : mergeUniqueItems(usableArchives, "blogs");
  const podcasts = contentUnavailable ? [] : mergeUniqueItems(usableArchives, "podcasts");
  const feedGeneratedAt = contentUnavailable
    ? null
    : feedIndex.generatedAt || usableArchives.at(-1)?.generatedAt || null;
  const runKeys = contentUnavailable ? [] : selectedArchiveEntries.map((entry) => entry.runKey);

  const output = {
    status: contentUnavailable ? "error" : "ok",
    message: contentUnavailable
      ? "Remote feed archives are unavailable; no digest was generated to avoid stale news."
      : undefined,
    generatedAt: new Date().toISOString(),
    config,
    source: {
      provider: "folo",
      listId: feedIndex?.source?.listId || projectConfig.folo?.listId || process.env.FOLO_LIST_ID || null,
      listTitle: feedIndex?.source?.listTitle || projectConfig.folo?.title || null,
    },
    digestWindow: {
      days: frequencyDays,
      runKeys,
      startRunKey: runKeys[0] || null,
      endRunKey: runKeys.at(-1) || null,
    },
    podcasts,
    x,
    blogs,
    stats: buildStats({ x, blogs, podcasts }, feedGeneratedAt),
    prompts,
    errors: errors.length > 0 ? errors : undefined,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ status: "error", message: err.message }));
  process.exit(1);
});
