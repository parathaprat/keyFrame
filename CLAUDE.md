# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

This is a Luma Labs engineering take-home challenge. The goal is to pick one of three open-ended problems, build real working software in ~1 working day, and submit via `./submit.sh`.

## Problem Options

1. **Reverse-engineer an undocumented API** — pick any website without a public API, reverse-engineer it, and build a useful tool on top of it.
2. **Fix something annoying** — build a browser extension that fixes a genuine annoyance on a website you use daily.
3. **Clone and improve** — rebuild one specific feature or interaction from an app you admire, then make it meaningfully better.

## Required Deliverables

- **Working software** — must run in a fresh Linux container. If using Docker, include `docker-compose.yml` for one-command setup.
- **APPROACH.md** — what you built and why, key decisions and tradeoffs, what you left out, what breaks first under pressure, what you'd build next.
- **video.md** — paste your Loom/Google Drive/YouTube link (~5 min walkthrough).
- **Live URL** — deploy if at all possible (Vercel, Railway, Fly, etc.) and include in APPROACH.md.

## Setup

```bash
cp .env.example .env
# Fill in whichever keys your solution needs
```

## Available API Keys

The following providers have accounts — real keys are supplied during review:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `ELEVEN_LABS_API_KEY`
- `GOOGLE_CLOUD_API_KEY`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (region: `us-west-2`)

## Submission

```bash
./submit.sh
```

This packages AI session history, commits and pushes changes, grants reviewer access, and registers the submission. AI session logs are a required deliverable — they are bundled automatically for Claude Code sessions.
