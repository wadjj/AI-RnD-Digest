# AI R&D Digest

AI R&D Digest is a Folo-backed clone of the Follow Builders pattern: a maintainer generates
central JSON feeds every day, and subscribers install a skill that reads those public feeds
and asks their agent to produce the digest.

## Current Source Boundary

- Folo list: `AITrendPush Sources`
- List ID: `1146999533868023808`
- Public subscriptions in the list: 38
- Private inbox sources are not included.

## Local Commands

```bash
npm run generate
npm run generate:force
npm run generate:preview
npm run prepare
```

`npm run generate` calls `npx --yes folocli@latest` and requires either a synced local
Folo CLI session or `FOLO_TOKEN` in the environment.

`npm run generate:preview` ignores existing state and does not update `state-feed.json`.
Use it for repeated local testing.

`npm run generate:force` allows a same-day rerun. Normal generation records a daily
run key in `state-feed.json`; if another machine runs after that, it exits without
overwriting the already generated feeds.

`npm run prepare` emits the single JSON blob an agent needs to remix the digest.

## Generated Files

- `feed-x.json`: recent X/RSSHub social posts grouped by builder
- `feed-blogs.json`: recent blog/RSS posts
- `feed-podcasts.json`: podcast placeholder, currently empty unless the Folo list contains audio sources
- `state-feed.json`: shared dedupe state

## Computer-Agnostic Generation

The canonical setup should be GitHub Actions:

1. Set repository secret `FOLO_TOKEN`.
2. Optionally set repository variable `FOLO_LIST_ID`; otherwise the checked-in config is used.
3. Let `.github/workflows/generate-feed.yml` run daily and commit feed updates.

Two-computer failover works by running the same repo and script on both machines:

1. Each machine pulls the repo before generation.
2. Each machine runs `npm run generate`.
3. Each machine commits and pushes only if feed files changed.
4. If the second machine pulls after the first one pushed, `state-feed.json` already contains today's run key, so it exits without touching the feed files.
5. If both race from the same state, Git push on one machine wins; the loser should pull and rerun once.

GitHub Actions is still preferred because workflow `concurrency` serializes scheduled runs.

## Subscriber Skill Flow

Subscribers use `SKILL.md`. The skill runs `scripts/prepare-digest.js`, reads feeds and
prompts, and remixes content strictly from JSON. Subscribers do not need Folo, Twitter,
RSSHub, or transcript API credentials.
