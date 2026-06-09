# AI R&D Digest

AI R&D Digest is a Folo-backed clone of the Follow Builders pattern: a maintainer generates
one incremental archive every day, and subscribers install a skill that reads the latest
1-7 daily archives and asks their agent to produce the digest.

## Current Source Boundary

- Folo list: `AITrendPush Sources`
- List ID: `1146999533868023808`
- Public subscriptions in the list: 38
- Private inbox sources are not included.

## Quick Start

1. Install the packaged skill in your agent.
2. Say `set up AI R&D Digest` or invoke `/follow-airnd`.
3. The agent walks you through setup conversationally.

The agent will ask:

- How many days each digest should cover. This also sets the delivery interval:
  a 2-day digest is delivered every 2 days. Default: 2 days.
- What time of day to deliver. Default: 09:00 in the agent/platform default timezone.
- What language you prefer: Chinese, English, or bilingual. Default: Chinese.

No Folo, X/Twitter, RSSHub, podcast transcript, or source API keys are needed for
subscribers. The source archive is generated centrally.

## Local Commands

```bash
npm run generate
npm run generate:force
npm run generate:preview
npm run prepare
npm run sync:folo-token -- --dry-run
npm run sync:folo-token
```

`npm run generate` calls `npx --yes folocli@latest` and requires either a synced local
Folo CLI session or `FOLO_TOKEN` in the environment.

`npm run generate:preview` ignores existing state and does not update `state-feed.json`.
Use it for repeated local testing.

`npm run generate:force` allows a same-day rerun. Normal generation records a daily
run key in `state-feed.json`; if another machine runs after that, it exits without
rewriting the already generated archive. A forced rerun merges into the same daily
archive by item ID or URL, so existing items are not dropped.

`npm run prepare` emits the single JSON blob an agent needs to remix the digest.

## Syncing the Folo Token to GitHub

Folo CLI stores a session token at `~/.folo/config.json`. GitHub Actions needs the
same value in the repository secret `FOLO_TOKEN`.

Check the token and GitHub access without writing:

```bash
npm run sync:folo-token -- --dry-run
```

Write the secret after an explicit confirmation prompt:

```bash
npm run sync:folo-token
```

Automation-friendly command for Keyboard Maestro, launchd, or cron:

```bash
cd /Users/jaywang/Documents/CodexProjects/AITrendPush
npm run sync:folo-token -- --yes --min-valid-days 7 --skip-if-remote-valid --renew-if-needed --pushover-on-login-needed
```

The script never prints the token. It reads the local Folo session, checks its
expiration with Folo, verifies `gh` can access `wadjj/AI-RnD-Digest`, then calls
`gh secret set FOLO_TOKEN`.

When `--skip-if-remote-valid` is set, the script first checks the non-sensitive GitHub
metadata variable:

- `FOLO_TOKEN_METADATA`

If the GitHub secret exists and that metadata says the remote token is still valid
for at least `--min-valid-days`, the script exits without reading local Folo token,
without writing the secret, and without sending Pushover. This is the recommended
mode when multiple computers run the same fallback automation.

`FOLO_TOKEN_METADATA` is a JSON string stored in a GitHub repo variable. It records
the metadata snapshot for the secret without exposing the token:

```json
{
  "version": 1,
  "secretName": "FOLO_TOKEN",
  "expiresAt": "2026-07-08T05:41:02.212Z",
  "syncedAt": "2026-06-09T12:30:00.000Z",
  "syncedBy": "Jay-MacBook-Pro",
  "source": "scripts/sync-folo-token.js"
}
```

### Pushover emergency alert

When `--pushover-on-login-needed` is set, the script sends an emergency Pushover
message before launching `folocli login`, but only when manual login is actually
needed. Normal token syncs do not send alerts.

Configure these environment variables in Keyboard Maestro:

```bash
export PUSHOVER_APP_TOKEN="your-pushover-app-token"
export PUSHOVER_USER_KEY="your-pushover-user-key"
```

Optional:

```bash
export PUSHOVER_DEVICE="iphone"
export PUSHOVER_SOUND="siren"
export PUSHOVER_RETRY="60"
export PUSHOVER_EXPIRE="3600"
```

Pushover emergency priority requires `priority=2` plus `retry` and `expire`.
The script defaults to retrying every 60 seconds for 1 hour.

Current Folo CLI sessions appear to expire after roughly 30 days. With
`--renew-if-needed`, the script runs `npx --yes folocli@latest login` when the
local session is missing, invalid, or below `--min-valid-days`, then syncs the new
token into GitHub. This can still require browser/user interaction because Folo CLI
does not expose a non-interactive refresh token.

Manual equivalent:

```bash
npx --yes folocli@latest login
npm run sync:folo-token
```

## Generated Files

- `archives/YYYY-MM-DD.json`: one daily incremental archive with X, blog, and podcast sections
- `feed-index.json`: the latest retained archive list and per-archive stats
- `state-feed.json`: shared dedupe state

Generation is incremental. The daily job uses short source lookbacks as a miss-recovery
window, but only items not present in `state-feed.json` enter the day's archive.
Reader frequency does not change source fetching; it only chooses how many daily
archives to merge.

## Computer-Agnostic Generation

The canonical setup should be GitHub Actions:

1. Set repository secret `FOLO_TOKEN`.
2. Optionally set repository variable `FOLO_LIST_ID`; otherwise the checked-in config is used.
3. Let `.github/workflows/generate-feed.yml` run daily and commit archive updates.

Two-computer failover works by running the same repo and script on both machines:

1. Each machine pulls the repo before generation.
2. Each machine runs `npm run generate`.
3. Each machine commits and pushes only if archive files changed.
4. If the second machine pulls after the first one pushed, `state-feed.json` already contains today's run key, so it exits without touching the archive files.
5. If both race from the same state, Git push on one machine wins; the loser should pull and rerun once.

GitHub Actions is still preferred because workflow `concurrency` serializes scheduled runs.

## Subscriber Skill Flow

Subscribers use `SKILL.md`. The skill runs `scripts/prepare-digest.js`, reads
`feed-index.json`, fetches the latest `frequencyDays` archives, and remixes content
strictly from JSON. Subscribers do not need Folo, Twitter, RSSHub, or transcript API
credentials.

Reader configuration lives at `~/.ai-trend-push/config.json`:

```json
{
  "platform": "openclaw",
  "language": "zh",
  "frequencyDays": 2,
  "deliveryTime": "09:00",
  "delivery": { "method": "stdout" },
  "onboardingComplete": true
}
```

`frequencyDays` is clamped to `1-7`. It controls both the digest window and the
delivery interval. The default is `2`, so a new reader receives a two-day digest
every two days unless they choose another window.
