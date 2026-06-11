import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoPrivateRssLeaks,
  fetchPrivateRssBlogs,
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

test("private RSS leak guard can ignore access_token text outside private RSS output", () => {
  const feeds = [{
    id: "stratechery-paid",
    name: "Stratechery",
    type: "blog",
    url: PRIVATE_FEED_URL,
  }];

  assert.doesNotThrow(() => assertNoPrivateRssLeaks(
    { blogs: [{ content: "OAuth examples often include access_token=abc123." }] },
    feeds,
    { checkAccessToken: false },
  ));
});

test("private RSS fetch errors redact feed URLs and tokens", async () => {
  const errors = [];
  const privateToken = "SECRET_TOKEN_123456789";
  const feed = {
    id: "stratechery-paid",
    name: "Stratechery",
    type: "blog",
    url: `https://stratechery.passport.online/feed/rss/${privateToken}`,
  };

  const result = await fetchPrivateRssBlogs({
    feeds: [feed],
    fetchImpl: async () => {
      throw new Error(`Failed to parse URL from ${feed.url}?access_token=${privateToken}`);
    },
    errors,
  });

  assert.deepEqual(result.blogs, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].includes(privateToken), false);
  assert.equal(errors[0].includes(feed.url), false);
  assert.equal(errors[0].includes("access_token="), false);
});

test("private RSS parser supports Atom link href and id fallback", () => {
  const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Private Atom</title>
  <entry>
    <title>Atom Update</title>
    <id>https://example.com/atom-update/?access_token=PRIVATE_ARTICLE_TOKEN</id>
    <link rel="alternate" href="https://example.com/atom-update/?access_token=PRIVATE_ARTICLE_TOKEN" />
    <updated>2026-06-10T10:00:00Z</updated>
    <author><name>Ada</name></author>
    <summary>Short summary</summary>
  </entry>
</feed>`;

  const blogs = parsePrivateRssBlogs(atom, {
    id: "atom-paid",
    name: "Private Atom",
    type: "blog",
    url: PRIVATE_FEED_URL,
    urlStrategy: "link",
    stripQuery: true,
  }, {
    nowMs: Date.parse("2026-06-11T00:00:00.000Z"),
  });

  assert.equal(blogs.length, 1);
  assert.equal(blogs[0].url, "https://example.com/atom-update/");
  assert.equal(blogs[0].author, "Ada");
  assert.equal(blogs[0].content, "Short summary");
  assert.equal(blogs[0].description, "Short summary");
});

test("private RSS text decodes entities after stripping markup", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item>
      <title>Entity Update</title>
      <link>https://example.com/entity-update/</link>
      <description>AT&amp;amp;T and escaped tag &amp;lt;b&amp;gt;</description>
      <content:encoded><![CDATA[
        <p>AT&amp;T &#8217;quoted&#8217;</p>
        <p>Escaped display tag: &lt;b&gt;</p>
      ]]></content:encoded>
      <pubDate>Wed, 10 Jun 2026 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

  const blogs = parsePrivateRssBlogs(xml, {
    id: "entity-paid",
    name: "Entity Paid",
    type: "blog",
    url: PRIVATE_FEED_URL,
    urlStrategy: "link",
    stripQuery: true,
  }, {
    nowMs: Date.parse("2026-06-11T00:00:00.000Z"),
  });

  assert.equal(blogs.length, 1);
  assert.equal(blogs[0].content, "AT&T ’quoted’\n\nEscaped display tag: <b>");
  assert.equal(blogs[0].description, "AT&T and escaped tag <b>");
});
