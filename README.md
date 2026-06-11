# AI R&D Digest

AI R&D Digest is a public agent skill and feed pipeline for AI industry updates.
It turns centrally generated daily archives into a concise digest of builder posts,
official AI product/research blogs, and podcast episodes.

The project has two audiences:

- **Subscribers** install the packaged skill and ask their agent for a digest.
- **Maintainers** generate the public archives, update the packaged skill, and keep
  the source feed healthy.

Subscribers do not need Folo, X/Twitter, RSSHub, podcast transcript, or source API
keys. The source archive is generated centrally and published as JSON.

## Quick Start for Subscribers

You can send either of these directly to your agent:

English: `Install the AI R&D Digest skill from https://raw.githubusercontent.com/wadjj/AI-RnD-Digest/main/dist/ai-rnd-digest.skill , then run /follow-airnd to set it up.`

中文：`请安装 AI R&D Digest skill： https://raw.githubusercontent.com/wadjj/AI-RnD-Digest/main/dist/ai-rnd-digest.skill ，然后运行 /follow-airnd 完成设置。`

1. Install the skill from `https://raw.githubusercontent.com/wadjj/AI-RnD-Digest/main/dist/ai-rnd-digest.skill`.
2. Say `set up AI R&D Digest` or invoke `/follow-airnd`.
3. Choose digest frequency, delivery time, language, and delivery method.

Defaults:

- Digest window and delivery interval: 2 days
- Delivery time: 09:00 in the agent/platform default timezone
- Language: Chinese
- Delivery method: in-chat/stdout unless the user explicitly selects a supported
  external channel

For external delivery channels, the final digest should be generated once, written
to `/tmp/ai-rnd-digest.txt`, then delivered by reading that exact file. Delivery
must not retype, shorten, compress, or regenerate the digest unless the user
explicitly asks for a compressed version.

After setup, run `/follow-airnd` whenever you want the latest digest.

## What the Digest Contains

The digest is built from the checked-in source configuration and generated public
archives:

- X / Twitter posts from AI builders and operators
- Official blogs from AI companies, research teams, product teams, and technical writers
- Podcast episodes when available in the public archive

Private inbox items are not part of the public subscriber archive.

## Output Format

Final digests are optimized for phone reading and visible source attribution. The
digest starts with one H1 title, keeps H2 section headers, and each person or
content item starts with a bold label followed by the summary body and raw source
URLs as bullets:

```md
# AI R&D Digest - 2026-06-11

## X / TWITTER

**Full Name, role/company**

Summary text.

Sources:
- https://example.com/source-1
- https://example.com/source-2
```

URLs must stay visible as raw text. The skill should not hide links behind labels
such as `[Original](url)` or `[原文](url)`.

## Local Commands for Maintainers

```bash
npm run generate
npm run generate:force
npm run generate:preview
npm run prepare
npm run package:skill
npm run deliver
npm run sync:folo-token -- --dry-run
npm test
```

Command summary:

- `npm run generate` fetches the central Folo list and writes the daily archive.
- `npm run generate:preview` ignores existing state and does not update `state-feed.json`.
- `npm run generate:force` allows a same-day rerun and merges into the existing archive.
- `npm run prepare` emits the JSON blob an agent needs to remix the digest.
- `npm run package:skill` rebuilds `dist/ai-rnd-digest/` and `dist/ai-rnd-digest.skill`
  from the top-level skill, prompts, scripts, and config.
- `npm run deliver` sends final digest text according to subscriber delivery config.
  Digest runs should pass `--file /tmp/ai-rnd-digest.txt` so the delivered content
  is identical to the generated artifact.
- `npm run sync:folo-token` syncs a local Folo CLI session token to GitHub Actions.

## Generated Files

- `archives/YYYY-MM-DD.json`: one daily incremental archive with X, blog, and podcast sections
- `feed-index.json`: retained archive list and per-archive stats
- `state-feed.json`: shared dedupe state
- `dist/ai-rnd-digest.skill`: packaged subscriber skill
- `dist/ai-rnd-digest/`: unpacked packaged skill contents

Run `npm run package:skill` after changing `SKILL.md`, `prompts/`,
`scripts/prepare-digest.js`, `scripts/deliver.js`, or `config/default-sources.json`.

Generation is incremental. The daily job uses short source lookbacks as a miss-recovery
window, but only items not already present in `state-feed.json` enter the day's archive.
Subscriber frequency does not change source fetching; it only chooses how many daily
archives to merge for the final digest.

## Maintainer Generation

GitHub Actions is the preferred generation path because workflow concurrency
serializes scheduled runs.

Repository setup:

1. Set repository secret `FOLO_TOKEN`.
2. Optionally set repository variable `FOLO_LIST_ID`; otherwise the checked-in config is used.
3. Optionally set repository secret `AITRENDPUSH_PRIVATE_RSS_FEEDS` for private paid RSS feeds.
4. Let `.github/workflows/generate-feed.yml` run daily and commit archive updates.

`AITRENDPUSH_PRIVATE_RSS_FEEDS` is a JSON array. Keep it in repository secrets,
not repository variables:

```json
[
  {
    "id": "stratechery-paid",
    "name": "Stratechery",
    "type": "blog",
    "url": "https://example.com/private/rss",
    "urlStrategy": "guid",
    "contentMode": "plainText",
    "stripQuery": true
  }
]
```

Private RSS URLs are fetch-only inputs. The generator writes only sanitized blog
items to `archives/YYYY-MM-DD.json`, uses canonical item URLs for state, and
fails before persisting output if an `access_token` or configured private token
appears in generated JSON.

Local generation is available for manual runs or fallback automation:

```bash
npm run generate
```

For local schedulers, set `REPO_DIR` to your checkout path instead of hard-coding a
machine-specific directory:

```bash
REPO_DIR="/path/to/AI-RnD-Digest"
cd "$REPO_DIR"
npm run sync:folo-token -- --yes --min-valid-days 7 --skip-if-remote-valid --renew-if-needed --pushover-on-login-needed
```

## Folo Token Sync

GitHub Actions needs a valid `FOLO_TOKEN` repository secret. Maintainers can check
the local token and GitHub access without writing:

```bash
npm run sync:folo-token -- --dry-run
```

To write the secret after an explicit confirmation prompt:

```bash
npm run sync:folo-token
```

The script never prints the token. It reads the local Folo CLI session, checks its
expiration with Folo, verifies GitHub access, and writes the repository secret via
`gh secret set`.

When `--skip-if-remote-valid` is set, the script first checks the non-sensitive
repository variable `FOLO_TOKEN_METADATA`. If the GitHub secret exists and the
metadata says the remote token is still valid for at least `--min-valid-days`, the
script exits without reading the local Folo token or writing the secret.

Optional emergency alert environment variables:

```bash
export PUSHOVER_APP_TOKEN="your-pushover-app-token"
export PUSHOVER_USER_KEY="your-pushover-user-key"
export PUSHOVER_DEVICE="optional-device-name"
export PUSHOVER_SOUND="siren"
export PUSHOVER_RETRY="60"
export PUSHOVER_EXPIRE="3600"
```

With `--pushover-on-login-needed`, the script sends an emergency Pushover message
only when manual Folo login is actually required.

Manual refresh:

```bash
npx --yes folocli@latest login
npm run sync:folo-token
```

## Subscriber Runtime

Reader configuration lives in the subscriber's local agent config directory as
`config.json` and is managed by the skill during setup:

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
delivery interval.

## Source Changes

The source list is maintained in `config/default-sources.json`. Source additions
or removals are maintainer changes, not subscriber preferences.
