# Digest Intro Prompt

You are assembling the final digest from individual source summaries.

## Format

Start with this H1 header, replacing [Date or Date Range] with the selected
`digestWindow`. Use one date for a one-day digest, or a compact date range for
multi-day digests:

# AI R&D Digest - [Date or Date Range]

Then organize content in this order, using these exact H2 section headers when
that section has content:

1. `## X / TWITTER` - list each builder with posts in the selected archive window
2. `## OFFICIAL BLOGS` - list each blog post from AI company blogs, product teams, researchers, and technical writers in the selected archive window
3. `## PODCASTS` - list each podcast with episodes in the selected archive window

## Rules

- Only include sources that have content in the selected archive window.
- Skip any source with nothing new.
- Skip empty sections silently. Do not write placeholder text such as "No podcast episodes", "No podcasts this time", "本次没有 podcast", or any other note explaining that a section has no content.
- Under each source, paste the individual summary you generated.
- Preserve Markdown heading levels: one H1 digest title, then H2 section headers.
  Do not flatten section headers into bold text or plain text.

### Output formatting contract

- Each person or content item must start with its own bold label line.
- For X / Twitter builders, use `**Full Name**` or `**Full Name, role/company**` when the role/company is available from the JSON bio. If the role/company is not clear, use the person's name only.
- For blog posts and podcasts, use a bold line with the source/title, and include the author, speaker, or role/company only when available.
- Put the summary body below the bold label, separated by a newline.
- After each builder summary, blog post, or podcast item, add a blank line, then a `Sources:` block.
- In the `Sources:` block, every original source URL must be a separate bullet point.
- Show the raw URL text directly, for example `- https://example.com/post`.
- Do not hide URLs behind Markdown link labels such as `[Original](url)`, `[Source](url)`, `[原文](url)`, `Original`, `Source`, or `原文`.
- Do not append source links immediately after the summary sentence. There must be a blank line before `Sources:`.
- If one summary merges multiple posts, articles, or episodes, include every source URL as its own bullet.

### Tweet author formatting

- Use the author's full name and role/company if the JSON bio makes it clear.
- Never write Twitter handles with @. Use "handle on X" or just the full name.
- Include the direct link to each tweet from the JSON `url` field.

### Blog post formatting

- Use the blog name as a section header.
- Under each blog, list each new post with its title and summary.
- If an individual blog summary is exactly `No notable blog post`, do not include that item in the final digest.
- If a blog source has no remaining notable posts after exclusions, skip that source.
- Include the author name if available.
- Include the direct link to the original article.

### Podcast links

- After each podcast summary, include the specific episode URL from the JSON `url` field.
- Never link to a channel page when an episode URL is available.
- Include the exact episode title from the JSON `title` field in the heading.

### Mandatory links

- Every single piece of content must have an original source link.
- Blog posts: the direct article URL.
- Podcasts: the episode URL.
- Tweets: the direct tweet URL.
- Source links must follow the `Sources:` block format above.
- If you do not have a link for something, do not include it.

### No fabrication

- Only include content that came from the feed JSON.
- Never make up quotes, opinions, titles, links, or context.
- Never speculate about someone's silence or what they might be working on.
- If you have nothing real for a source, skip it.

### General

- At the end, add a line: "Generated through the AI R&D Digest skill."
- Keep formatting clean and scannable for phone reading.
