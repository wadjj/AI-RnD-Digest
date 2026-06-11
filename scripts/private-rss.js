import { XMLParser } from "fast-xml-parser";

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "token",
  "key",
  "subscriber",
  "subscription",
  "auth",
  "signature",
  "sig",
]);

const parser = new XMLParser({
  attributeNamePrefix: "@",
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: true,
  trimValues: true,
});

function arrayOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object") return textValue(value["#text"] ?? value._text ?? value.text);
  return "";
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
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const raw = isHex ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(raw, isHex ? 16 : 10);
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

function lastPathSegment(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    return "";
  }
}

function sensitiveNeedlesFor(feed) {
  const needles = new Set(arrayOf(feed.sensitiveNeedles).filter(Boolean).map(String));
  if (feed.url) {
    needles.add(feed.url);
    try {
      needles.add(encodeURIComponent(feed.url));
      const url = new URL(feed.url);
      const last = lastPathSegment(feed.url);
      if (last.length >= 12) needles.add(last);
      for (const [key, value] of url.searchParams.entries()) {
        if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) && value.length >= 8) {
          needles.add(value);
        }
      }
    } catch {
      // Invalid URLs are rejected during config parsing; keep this helper defensive.
    }
  }
  return [...needles].filter((needle) => needle.length >= 8);
}

function redactSensitiveText(text, feed) {
  let output = String(text || "");
  for (const needle of sensitiveNeedlesFor(feed)) {
    output = output.split(needle).join("[redacted-private-rss]");
    output = output.split(encodeURIComponent(needle)).join("[redacted-private-rss]");
  }
  output = output.replace(/access_token=[^"'&\s<>]+/gi, "access_token=[redacted]");
  return output;
}

function sanitizePublicUrl(rawUrl, { stripQuery = true } = {}) {
  const value = textValue(rawUrl);
  if (!value) return "";
  try {
    const url = new URL(value);
    if (stripQuery) {
      url.search = "";
    } else {
      for (const key of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function guidUrl(item) {
  const guid = item?.guid;
  return textValue(guid);
}

function itemUrl(item, feed) {
  const strategy = feed.urlStrategy || "canonical-or-guid";
  const stripQuery = feed.stripQuery !== false;
  if (strategy === "guid") {
    return sanitizePublicUrl(guidUrl(item), { stripQuery });
  }
  if (strategy === "link") {
    return sanitizePublicUrl(item?.link, { stripQuery });
  }
  return (
    sanitizePublicUrl(guidUrl(item), { stripQuery }) ||
    sanitizePublicUrl(item?.link, { stripQuery })
  );
}

function itemContent(item, feed, maxContentChars) {
  const raw = item?.["content:encoded"] || item?.content || item?.description || "";
  const redacted = redactSensitiveText(textValue(raw), feed);
  return trimText(htmlToText(redacted), maxContentChars);
}

function itemDescription(item, feed) {
  const redacted = redactSensitiveText(textValue(item?.description || ""), feed);
  return htmlToText(redacted);
}

function isWithinLookback(item, nowMs, lookbackHours) {
  const published = textValue(item?.pubDate || item?.published || item?.updated);
  const ts = published ? Date.parse(published) : Number.NaN;
  if (!Number.isFinite(ts)) return true;
  return ts >= nowMs - lookbackHours * 60 * 60 * 1000;
}

export function parsePrivateRssConfig(rawConfig) {
  if (!rawConfig || !String(rawConfig).trim()) return [];
  const parsed = JSON.parse(rawConfig);
  const feeds = arrayOf(parsed);
  return feeds.map((feed, index) => {
    if (!feed || typeof feed !== "object") {
      throw new Error(`Private RSS feed at index ${index} must be an object.`);
    }
    if (!feed.id || typeof feed.id !== "string") {
      throw new Error(`Private RSS feed at index ${index} is missing string id.`);
    }
    if (!feed.url || typeof feed.url !== "string") {
      throw new Error(`Private RSS feed ${feed.id} is missing string url.`);
    }
    if ((feed.type || "blog") !== "blog") {
      throw new Error(`Private RSS feed ${feed.id} has unsupported type: ${feed.type}`);
    }
    return {
      type: "blog",
      urlStrategy: "canonical-or-guid",
      contentMode: "plainText",
      stripQuery: true,
      ...feed,
      name: feed.name || feed.id,
    };
  });
}

export function parsePrivateRssBlogs(xml, feed, {
  lookbackHours = 72,
  maxContentChars = 12000,
  nowMs = Date.now(),
} = {}) {
  const document = parser.parse(xml);
  const channel = document?.rss?.channel || document?.feed || {};
  const items = arrayOf(channel.item || channel.entry);
  const blogs = [];

  for (const item of items) {
    if (!isWithinLookback(item, nowMs, lookbackHours)) continue;
    const url = itemUrl(item, feed);
    const title = textValue(item.title);
    const content = itemContent(item, feed, maxContentChars);
    if (!url || !title) continue;
    blogs.push({
      source: "blog",
      name: feed.name,
      title,
      url,
      publishedAt: textValue(item.pubDate || item.published || item.updated) || null,
      author: textValue(item.author || item["dc:creator"] || item["itunes:author"]),
      description: itemDescription(item, feed),
      content,
    });
  }

  return blogs;
}

export function assertNoPrivateRssLeaks(payload, feeds) {
  const serialized = JSON.stringify(payload);
  if (/access_token=/i.test(serialized)) {
    throw new Error("Private RSS output contains access_token.");
  }
  for (const feed of feeds || []) {
    for (const needle of sensitiveNeedlesFor(feed)) {
      if (serialized.includes(needle) || serialized.includes(encodeURIComponent(needle))) {
        throw new Error(`Private RSS output contains private RSS token for ${feed.id || feed.name}.`);
      }
    }
  }
}

export async function fetchPrivateRssBlogs({
  rawConfig,
  fetchImpl = fetch,
  nowMs = Date.now(),
  lookbackHours = 72,
  maxContentChars = 12000,
  state,
  ignoreState = false,
  errors = [],
} = {}) {
  const feeds = parsePrivateRssConfig(rawConfig);
  const blogs = [];

  for (const feed of feeds) {
    try {
      const response = await fetchImpl(feed.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const xml = await response.text();
      const parsed = parsePrivateRssBlogs(xml, feed, { nowMs, lookbackHours, maxContentChars });
      for (const blog of parsed) {
        const key = blog.url;
        if (!key || (!ignoreState && state?.seenArticles?.[key])) continue;
        blogs.push(blog);
        if (!ignoreState && state?.seenArticles) state.seenArticles[key] = nowMs;
      }
    } catch (err) {
      errors.push(`Private RSS feed ${feed.id} failed: ${err.message}`);
    }
  }

  assertNoPrivateRssLeaks(blogs, feeds);
  return { blogs, feeds };
}
