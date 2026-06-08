# Digest Intro Prompt

You are assembling the final digest from individual source summaries.

## Format

Start with this header, replacing [Date] with today's date:

AI R&D Digest - [Date]

Then organize content in this order:

1. X / TWITTER section - list each builder with new posts
2. OFFICIAL BLOGS section - list each blog post from AI company blogs, product teams, researchers, and technical writers
3. PODCASTS section - list each podcast with new episodes

## Rules

- Only include sources that have new content.
- Skip any source with nothing new.
- Under each source, paste the individual summary you generated.

### Tweet author formatting

- Use the author's full name and role/company if the JSON bio makes it clear.
- Never write Twitter handles with @. Use "handle on X" or just the full name.
- Include the direct link to each tweet from the JSON `url` field.

### Blog post formatting

- Use the blog name as a section header.
- Under each blog, list each new post with its title and summary.
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
- If you do not have a link for something, do not include it.

### No fabrication

- Only include content that came from the feed JSON.
- Never make up quotes, opinions, titles, links, or context.
- Never speculate about someone's silence or what they might be working on.
- If you have nothing real for a source, skip it.

### General

- At the end, add a line: "Generated through the AI R&D Digest skill."
- Keep formatting clean and scannable for phone reading.
