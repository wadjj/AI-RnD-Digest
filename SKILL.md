---
name: ai-rnd-digest
description: AI R&D digest built from centrally generated Folo daily archives. Use when the user wants AI industry updates, builder posts, technical blog changes, says "set up AI R&D Digest", or invokes /follow-airnd. Subscribers do not need source API keys.
---

# AI R&D Digest

You are an AI-powered curator for AI industry and builder updates. The source data is
generated centrally from a Folo list and published as daily JSON archives. Users of
this skill do not need X/Twitter API keys, RSSHub keys, or a running Folo desktop
client.

## First Step

Detect the runtime platform:

```bash
which openclaw 2>/dev/null && echo "PLATFORM=openclaw" || echo "PLATFORM=other"
```

When the user says "set up AI R&D Digest" or invokes `/follow-airnd`, check
`~/.ai-trend-push/config.json`. If it does not exist or `onboardingComplete` is
not true, run setup conversationally.

Ask only these preferences:

1. How many days each digest should cover. This also sets the delivery interval:
   a 2-day digest is delivered every 2 days, a 7-day digest every 7 days. Allowed
   range is 1-7. If the user does not answer, use 2.
2. What time of day to deliver. Ask for the clock time only and use the
   agent/platform default timezone. If the user does not answer, use `09:00`.
3. Language: `zh`, `en`, or `bilingual`. If the user does not answer, use `zh`.
4. Delivery method. For OpenClaw or another persistent agent with built-in channels,
   use `stdout` and let the platform deliver the message. For other agents, offer
   `stdout`, `telegram`, or `email`; default to `stdout`.

Save the answer as:

```json
{
  "platform": "<openclaw or other>",
  "language": "zh",
  "frequencyDays": 2,
  "deliveryTime": "09:00",
  "delivery": { "method": "stdout" },
  "onboardingComplete": true
}
```

Do not ask users for Folo, Twitter, RSSHub, or podcast transcript API keys.
If they choose Telegram or email, ask only for delivery credentials:

- Telegram: guide them to create a bot with BotFather, send the bot one message,
  then save `TELEGRAM_BOT_TOKEN` in `~/.ai-trend-push/.env` and `delivery.chatId`
  in `~/.ai-trend-push/config.json`.
- Email: ask for the destination address, save it as `delivery.email`, and save
  `RESEND_API_KEY` in `~/.ai-trend-push/.env`. If they have a verified sender,
  save it as `delivery.fromEmail` or `RESEND_FROM_EMAIL`.

If the platform supports scheduling, create a recurring job that runs every
`frequencyDays` days at `deliveryTime` using the agent/platform default timezone.
The scheduled message should ask the agent to run the AI R&D Digest skill with
`/follow-airnd`. If scheduling is unavailable, tell the user they can run
`/follow-airnd` on demand.

## Digest Run

When the user invokes `/follow-airnd` after setup, or asks for the digest:

1. Run the prepare script from the skill directory. Use the centrally published
   index and archives by default so the digest stays fresh even if the installed
   skill files are older than the repository:

```bash
cd ${CLAUDE_SKILL_DIR}/scripts && AITRENDPUSH_USE_REMOTE=1 node prepare-digest.js 2>/dev/null
```

2. The script outputs one JSON blob with:

- `config` - language, `frequencyDays`, `deliveryTime`, and delivery preferences
- `digestWindow` - selected archive dates for this run
- `x` - builders with recent posts
- `blogs` - recent blog posts
- `podcasts` - podcast episodes, if any
- `prompts` - exact remix instructions
- `stats` - content counts
- `errors` - feed, archive, or prompt loading problems

3. If `status` is `error`, tell the user the central feed archive is temporarily
   unavailable and stop. Do not use bundled or remembered old feed data to produce
   a digest.

4. If all content counts are zero, say there are no new updates for the selected
   `digestWindow` and stop.

5. Remix content only from the JSON. Do not browse the web, visit URLs, call APIs, or
invent missing context.

6. Follow the prompts embedded in the JSON:

- `prompts.digest_intro`
- `prompts.summarize_tweets`
- `prompts.summarize_blogs`
- `prompts.summarize_podcast`
- `prompts.translate`

7. Apply `config.language` exactly:

- `en`: English only
- `zh`: Chinese only
- `bilingual`: English and Chinese interleaved paragraph by paragraph

8. Every included item must have its source URL. No URL means do not include it.

9. If `config.delivery.method` is `stdout`, output the digest directly. For
`telegram` or `email`, write the final digest to a temp file and run:

```bash
cd ${CLAUDE_SKILL_DIR}/scripts && node deliver.js --file /tmp/ai-rnd-digest.txt 2>/dev/null
```

If delivery fails, show the digest as fallback and report the delivery error.

## Source Changes

The source list is centrally managed through the Folo list in `config/default-sources.json`.
If a user wants to add or remove sources, treat that as a maintainer request rather than
a subscriber preference.

## Maintainer Feed Generation

Maintainers generate public feeds with:

```bash
npm run generate
```

Local generation uses the Folo CLI session if it is already synced. CI generation uses
the `FOLO_TOKEN` repository secret. The generated files are:

- `archives/YYYY-MM-DD.json`
- `feed-index.json`
- `state-feed.json`

Use `npm run generate:preview` for local previews that ignore and do not update state.
