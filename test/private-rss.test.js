import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoPrivateRssLeaks,
  parsePrivateRssBlogs,
} from "../scripts/private-rss.js";

const PRIVATE_FEED_URL = "https://stratechery.passport.online/feed/rss/SECRET_TOKEN_123456789";
const PRIVATE_PODCAST_URL = "https://stratechery.passport.online/feed/podcast/SECRET_TOKEN_123456789";

function privateRssXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Stratechery</title>
    <atom:link href="${PRIVATE_FEED_URL}" rel="self" type="application/rss+xml" />
    <item>
      <title>Paid Update</title>
      <link>https://stratechery.com/2026/paid-update/?access_token=PRIVATE_ARTICLE_TOKEN</link>
      <description>Short description</description>
      <content:encoded><![CDATA[
        <p>Paid body.</p>
        <p><a href="${PRIVATE_PODCAST_URL}">Listen in your podcast player</a></p>
        <p>Visible private URL: ${PRIVATE_FEED_URL}</p>
      ]]></content:encoded>
      <author>Ben Thompson</author>
      <guid isPermaLink="true">https://stratechery.com/2026/paid-update/</guid>
      <pubDate>Wed, 10 Jun 2026 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;
}

test("private RSS blogs use guid URLs and remove paid feed tokens", () => {
  const blogs = parsePrivateRssBlogs(privateRssXml(), {
    id: "stratechery-paid",
    name: "Stratechery",
    type: "blog",
    url: PRIVATE_FEED_URL,
    urlStrategy: "guid",
    contentMode: "plainText",
    stripQuery: true,
  }, {
    lookbackHours: 72,
    maxContentChars: 12000,
    nowMs: Date.parse("2026-06-11T00:00:00.000Z"),
  });

  assert.equal(blogs.length, 1);
  assert.equal(blogs[0].source, "blog");
  assert.equal(blogs[0].name, "Stratechery");
  assert.equal(blogs[0].title, "Paid Update");
  assert.equal(blogs[0].url, "https://stratechery.com/2026/paid-update/");
  assert.equal(blogs[0].author, "Ben Thompson");

  const serialized = JSON.stringify(blogs);
  assert.equal(serialized.includes("access_token"), false);
  assert.equal(serialized.includes("SECRET_TOKEN_123456789"), false);
  assert.equal(serialized.includes(PRIVATE_FEED_URL), false);
  assert.equal(serialized.includes(PRIVATE_PODCAST_URL), false);
});

test("private RSS leak guard rejects persisted access tokens and feed tokens", () => {
  const feeds = [{
    id: "stratechery-paid",
    name: "Stratechery",
    type: "blog",
    url: PRIVATE_FEED_URL,
  }];

  assert.throws(
    () => assertNoPrivateRssLeaks({ blogs: [{ url: "https://example.com/?access_token=abc" }] }, feeds),
    /access_token/,
  );
  assert.throws(
    () => assertNoPrivateRssLeaks({ blogs: [{ content: "SECRET_TOKEN_123456789" }] }, feeds),
    /private RSS token/,
  );
});
