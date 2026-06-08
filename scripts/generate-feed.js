#!/usr/bin/env node

// AITrendPush central feed generator.
// Fetches a Folo list, normalizes entries into Follow Builders-compatible
// feed-x.json, feed-blogs.json, feed-podcasts.json, and maintains state-feed.json.

import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = decodeURIComponent(new URL(".", import.meta.url).pathname);
const ROOT_DIR = join(SCRIPT_DIR, "..");
const CONFIG_PATH = join(ROOT_DIR, "config", "default-sources.json");
const STATE_PATH = join(ROOT_DIR, "state-feed.json");
const DEFAULT_STATE = {
  seenTweets: {},
  seenVideos: {},
  seenArticles: {},
  lastRunKey: null,
  lastRunAt: null,
};

async function readJSON(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf-8"));
}

async function loadState() {
  const state = await readJSON(STATE_PATH, DEFAULT_STATE);
  return {
    seenTweets: state.seenTweets || {},
    seenVideos: state.seenVideos || {},
    seenArticles: state.seenArticles || {},
    lastRunKey: state.lastRunKey || null,
    lastRunAt: state.lastRunAt || null,
  };
}

async function saveState(state) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const bucket of ["seenTweets", "seenVideos", "seenArticles"]) {
    for (const [id, ts] of Object.entries(state[bucket] || {})) {
      if (ts < cutoff) delete state[bucket][id];
    }
  }
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function dailyRunKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function stateHasSeenItemsForRunKey(state, runKey, timeZone) {
  for (const bucket of ["seenTweets", "seenVideos", "seenArticles"]) {
    for (const ts of Object.values(state[bucket] || {})) {
      if (dailyRunKey(new Date(ts), timeZone) === runKey) return true;
    }
  }
  return false;
}

async function runFolocli(config, args) {
  const cliPackage = process.env.FOLO_CLI_PACKAGE || config.folo?.cliPackage || "folocli@latest";
  const env = { ...process.env };
  const { stdout } = await execFileAsync(
    "npx",
    ["--yes", cliPackage, ...args],
    {
      env,
      timeout: 180000,
      maxBuffer: 80 * 1024 * 1024,
    },
  );

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`folocli returned non-JSON output for ${args.join(" ")}: ${err.message}`);
  }
  if (!parsed.ok) {
    const message = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
    throw new Error(`folocli ${args.join(" ")} failed: ${message}`);
  }
  return parsed.data;
}

function decodeEntities(text) {
  if (!text) return "";
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const raw = entity[1]?.toLowerCase() === "x" ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(raw, entity[1]?.toLowerCase() === "x" ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity] ?? match;
  });
}

function htmlToText(value) {
  if (!value) return "";
  return decodeEntities(String(value))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr[^>]*>/gi, "\n---\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function trimText(text, maxChars) {
  if (!text || text.length <= maxChars) return text || "";
  return `${text.slice(0, maxChars).trim()}...`;
}

function normalizeTimelineItem(item) {
  return {
    feed: item.feeds || item.feed || {},
    entry: item.entries || item.entry || item,
    view: item.view,
    settings: item.settings || {},
  };
}

function normalizeDetail(data, fallback) {
  if (!data) return fallback;
  return {
    feed: data.feeds || data.feed || fallback.feed,
    entry: data.entries || data.entry || data,
    view: fallback.view,
    settings: data.settings || fallback.settings || {},
  };
}

function publishedTime(entry) {
  const value = entry.publishedAt || entry.insertedAt;
  const ts = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ts) ? ts : null;
}

function isXEntry(feed, entry) {
  const feedUrl = feed.url || "";
  const siteUrl = feed.siteUrl || "";
  const entryUrl = entry.url || entry.guid || "";
  return (
    feedUrl.startsWith("rsshub://twitter/user/") ||
    /https?:\/\/(x|twitter)\.com\//i.test(siteUrl) ||
    /https?:\/\/(x|twitter)\.com\/[^/]+\/status\//i.test(entryUrl)
  );
}

function isPodcastEntry(feed, entry) {
  const url = `${feed.url || ""} ${feed.siteUrl || ""} ${entry.url || ""}`.toLowerCase();
  const media = Array.isArray(entry.media) ? entry.media : [];
  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
  return (
    media.some((m) => String(m.type || "").toLowerCase().includes("audio")) ||
    attachments.some((a) => String(a.mimeType || a.type || "").toLowerCase().includes("audio")) ||
    /podcast|simplecast|megaphone|anchor\.fm|spotify\.com\/show/.test(url)
  );
}

function handleFrom(feed, entry) {
  const feedMatch = (feed.url || "").match(/rsshub:\/\/twitter\/user\/([^/?#]+)/i);
  if (feedMatch) return feedMatch[1];
  const authorMatch = (entry.authorUrl || feed.siteUrl || entry.url || "").match(/(?:x|twitter)\.com\/([^/?#]+)/i);
  if (authorMatch && authorMatch[1] !== "i") return authorMatch[1];
  const titleMatch = (feed.title || "").match(/Twitter\s+@?(.+)$/i);
  return titleMatch ? titleMatch[1].trim() : "";
}

function cleanBio(feed) {
  return htmlToText(feed.description || "")
    .replace(/\s*-\s*Powered by RSSHub\s*$/i, "")
    .trim();
}

function tweetKey(entry) {
  return entry.guid || entry.url || entry.id;
}

function articleKey(entry) {
  return entry.url || entry.guid || entry.id;
}

function quoteContext(entry, maxChars) {
  const links = entry.extra?.links || [];
  const quotes = links.filter((link) => link.type === "quote");
  if (quotes.length === 0) return null;
  return trimText(
    quotes
      .map((link) => {
        const text = htmlToText(link.content_html || "");
        return [link.url, text].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n"),
    maxChars,
  );
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function hydrateEntries(config, items, errors) {
  const limit = config.limits?.maxEntryGetConcurrency || 4;
  return mapLimit(items, limit, async (item) => {
    try {
      const data = await runFolocli(config, ["entry", "get", String(item.entry.id)]);
      return normalizeDetail(data, item);
    } catch (err) {
      errors.push(`Folo entry get failed for ${item.entry.id}: ${err.message}`);
      return item;
    }
  });
}

async function fetchTimeline(config, activeLookbackHours, errors) {
  const listId = process.env.FOLO_LIST_ID || config.folo?.listId;
  if (!listId) throw new Error("FOLO_LIST_ID is not set and config.folo.listId is missing");

  const pageSize = config.limits?.timelinePageSize || 50;
  const maxPages = config.limits?.maxTimelinePages || 6;
  const cutoff = Date.now() - activeLookbackHours * 60 * 60 * 1000;
  const all = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const args = ["timeline", "--list", String(listId), "--limit", String(pageSize)];
    if (cursor) args.push("--cursor", cursor);
    const data = await runFolocli(config, args);
    const entries = data.entries || [];
    all.push(...entries.map(normalizeTimelineItem));

    const nextCursor = data.nextCursor;
    if (!data.hasNext || !nextCursor || entries.length === 0) break;
    const nextTs = Date.parse(nextCursor);
    if (Number.isFinite(nextTs) && nextTs < cutoff) break;
    cursor = nextCursor;
  }

  if (all.length === 0) {
    errors.push(`Folo list ${listId} returned no entries`);
  }
  return all;
}

function selectXEntries(items, config, state, ignoreState) {
  const cutoff = Date.now() - (config.lookbackHours?.x || 24) * 60 * 60 * 1000;
  const maxPerBuilder = config.limits?.maxTweetsPerBuilder || 3;
  const groups = new Map();

  for (const item of items) {
    const { feed, entry } = item;
    const ts = publishedTime(entry);
    if (!ts || ts < cutoff || !isXEntry(feed, entry)) continue;
    const key = tweetKey(entry);
    if (!key || (!ignoreState && state.seenTweets[key])) continue;

    const handle = handleFrom(feed, entry);
    const groupKey = feed.id || handle || entry.author || "unknown";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        feed,
        handle,
        name: entry.author || feed.title?.replace(/^Twitter\s+@/i, "") || handle || "Unknown",
        items: [],
      });
    }
    const group = groups.get(groupKey);
    if (group.items.length < maxPerBuilder) group.items.push(item);
  }
  return [...groups.values()];
}

function selectBlogEntries(items, config, state, ignoreState) {
  const cutoff = Date.now() - (config.lookbackHours?.blogs || 72) * 60 * 60 * 1000;
  const maxPerBlog = config.limits?.maxArticlesPerBlog || 3;
  const groups = new Map();

  for (const item of items) {
    const { feed, entry } = item;
    const ts = publishedTime(entry);
    if (!ts || ts < cutoff || isXEntry(feed, entry) || isPodcastEntry(feed, entry)) continue;
    const key = articleKey(entry);
    if (!key || (!ignoreState && state.seenArticles[key])) continue;

    const groupKey = feed.id || feed.title || feed.url || "unknown";
    if (!groups.has(groupKey)) groups.set(groupKey, { feed, items: [] });
    const group = groups.get(groupKey);
    if (group.items.length < maxPerBlog) group.items.push(item);
  }
  return [...groups.values()];
}

function buildXFeed(groups, hydratedById, config, state, ignoreState) {
  const maxChars = config.limits?.maxContentChars || 12000;
  const x = [];

  for (const group of groups) {
    const tweets = [];
    for (const item of group.items) {
      const hydrated = hydratedById.get(item.entry.id) || item;
      const entry = hydrated.entry;
      const key = tweetKey(entry);
      const text = trimText(
        htmlToText(entry.content || entry.description || entry.summary || entry.title),
        maxChars,
      );
      if (!entry.url || !text) continue;
      tweets.push({
        id: key,
        text,
        createdAt: entry.publishedAt || entry.insertedAt,
        url: entry.url,
        likes: null,
        retweets: null,
        replies: null,
        isQuote: Boolean(quoteContext(entry, maxChars)),
        quotedTweetId: null,
        quotedContext: quoteContext(entry, maxChars),
      });
      if (!ignoreState && key) state.seenTweets[key] = Date.now();
    }
    if (tweets.length > 0) {
      x.push({
        source: "x",
        name: group.name,
        handle: group.handle,
        bio: cleanBio(group.feed),
        tweets,
      });
    }
  }
  return x;
}

function buildBlogFeed(groups, hydratedById, config, state, ignoreState) {
  const maxChars = config.limits?.maxContentChars || 12000;
  const blogs = [];

  for (const group of groups) {
    for (const item of group.items) {
      const hydrated = hydratedById.get(item.entry.id) || item;
      const { feed, entry } = hydrated;
      const key = articleKey(entry);
      const content = trimText(
        htmlToText(entry.content || entry.summary || entry.description || ""),
        maxChars,
      );
      if (!entry.url || !entry.title) continue;
      blogs.push({
        source: "blog",
        name: feed.title || "Unknown Blog",
        title: entry.title,
        url: entry.url,
        publishedAt: entry.publishedAt || entry.insertedAt,
        author: entry.author || "",
        description: htmlToText(entry.description || entry.summary || ""),
        content,
      });
      if (!ignoreState && key) state.seenArticles[key] = Date.now();
    }
  }
  return blogs;
}

function buildPodcastFeed(config) {
  return {
    generatedAt: new Date().toISOString(),
    lookbackHours: config.lookbackHours?.podcasts || 336,
    podcasts: [],
    stats: { podcastEpisodes: 0 },
  };
}

async function writeFeed(filename, data) {
  const path = join(ROOT_DIR, filename);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const tweetsOnly = args.includes("--tweets-only");
  const podcastsOnly = args.includes("--podcasts-only");
  const blogsOnly = args.includes("--blogs-only");
  const ignoreState = args.includes("--ignore-state") || process.env.AITRENDPUSH_IGNORE_STATE === "1";
  const force = args.includes("--force") || process.env.AITRENDPUSH_FORCE === "1";

  const runTweets = tweetsOnly || (!podcastsOnly && !blogsOnly);
  const runPodcasts = podcastsOnly || (!tweetsOnly && !blogsOnly);
  const runBlogs = blogsOnly || (!tweetsOnly && !podcastsOnly);

  const config = await readJSON(CONFIG_PATH);
  if (!config) throw new Error(`Missing config: ${CONFIG_PATH}`);

  const state = ignoreState ? structuredClone(DEFAULT_STATE) : await loadState();
  const timeZone = process.env.AITRENDPUSH_TIMEZONE || config.schedule?.timeZone || "Asia/Shanghai";
  const runKey = process.env.AITRENDPUSH_RUN_KEY || dailyRunKey(new Date(), timeZone);

  if (
    !ignoreState &&
    !force &&
    (state.lastRunKey === runKey || stateHasSeenItemsForRunKey(state, runKey, timeZone))
  ) {
    if (state.lastRunKey !== runKey) {
      state.lastRunKey = runKey;
      state.lastRunAt = new Date().toISOString();
      await saveState(state);
    }
    console.error(`Already generated for ${runKey} (${timeZone}); leaving feed files unchanged`);
    return;
  }

  const errors = [];
  const activeLookbacks = [];
  if (runTweets) activeLookbacks.push(config.lookbackHours?.x || 24);
  if (runBlogs) activeLookbacks.push(config.lookbackHours?.blogs || 72);
  if (runPodcasts) activeLookbacks.push(config.lookbackHours?.podcasts || 336);
  const maxLookback = Math.max(...activeLookbacks, 24);

  console.error(`Fetching Folo list ${process.env.FOLO_LIST_ID || config.folo.listId}...`);
  const timelineItems = await fetchTimeline(config, maxLookback, errors);
  console.error(`  Timeline entries considered: ${timelineItems.length}`);

  const xGroups = runTweets ? selectXEntries(timelineItems, config, state, ignoreState) : [];
  const blogGroups = runBlogs ? selectBlogEntries(timelineItems, config, state, ignoreState) : [];
  const selectedItems = [
    ...xGroups.flatMap((group) => group.items),
    ...blogGroups.flatMap((group) => group.items),
  ];

  if (
    !ignoreState &&
    !force &&
    selectedItems.length === 0 &&
    stateHasSeenItemsForRunKey(state, runKey, timeZone)
  ) {
    state.lastRunKey = runKey;
    state.lastRunAt = new Date().toISOString();
    await saveState(state);
    console.error(`No new selected entries and state already has ${runKey} items; leaving feed files unchanged`);
    return;
  }

  const uniqueItems = [...new Map(selectedItems.map((item) => [item.entry.id, item])).values()];
  console.error(`  Hydrating selected entries: ${uniqueItems.length}`);
  const hydratedItems = await hydrateEntries(config, uniqueItems, errors);
  const hydratedById = new Map(hydratedItems.map((item) => [item.entry.id, item]));

  if (runTweets) {
    const xContent = buildXFeed(xGroups, hydratedById, config, state, ignoreState);
    const totalTweets = xContent.reduce((sum, account) => sum + account.tweets.length, 0);
    await writeFeed("feed-x.json", {
      generatedAt: new Date().toISOString(),
      lookbackHours: config.lookbackHours?.x || 24,
      source: "folo",
      listId: process.env.FOLO_LIST_ID || config.folo.listId,
      x: xContent,
      stats: { xBuilders: xContent.length, totalTweets },
      errors: errors.length ? errors : undefined,
    });
    console.error(`  feed-x.json: ${xContent.length} builders, ${totalTweets} posts`);
  }

  if (runBlogs) {
    const blogs = buildBlogFeed(blogGroups, hydratedById, config, state, ignoreState);
    await writeFeed("feed-blogs.json", {
      generatedAt: new Date().toISOString(),
      lookbackHours: config.lookbackHours?.blogs || 72,
      source: "folo",
      listId: process.env.FOLO_LIST_ID || config.folo.listId,
      blogs,
      stats: { blogPosts: blogs.length },
      errors: errors.length ? errors : undefined,
    });
    console.error(`  feed-blogs.json: ${blogs.length} posts`);
  }

  if (runPodcasts) {
    await writeFeed("feed-podcasts.json", buildPodcastFeed(config));
    console.error("  feed-podcasts.json: 0 episodes");
  }

  if (!ignoreState) {
    state.lastRunKey = runKey;
    state.lastRunAt = new Date().toISOString();
    await saveState(state);
    console.error("  state-feed.json updated");
  } else {
    console.error("  state-feed.json not updated (--ignore-state)");
  }
}

main().catch((err) => {
  const hint =
    err.message.includes("npx") || err.message.includes("folocli")
      ? `\nHint: run "npx --yes folocli@latest whoami" locally, or set FOLO_TOKEN in CI.`
      : "";
  console.error(`Feed generation failed: ${err.message}${hint}`);
  process.exit(1);
});
