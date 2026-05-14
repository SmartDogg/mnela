---
name: Bug report
about: Something doesn't work as documented or expected
title: 'bug: <one-line summary>'
labels: bug
---

## What happened

<!-- One paragraph. What did you do, what did you expect, what did you get? -->

## Repro

1.
2.
3.

## Environment

- Install method: <!-- one-command install.sh / docker compose / pnpm dev -->
- Mnela version / commit: <!-- `mnela status` output or `git rev-parse HEAD` -->
- OS / docker version: <!-- `docker version | head -10` -->
- Browser (if web UI bug):
- LLM provider in use: <!-- builtin:claude-cli / anthropic-api / openai-compatible (which model?) -->

## Logs

```
# Paste relevant tail. For the api:
#   mnela logs api --tail=200
# Redact tokens. Mnela never logs API keys in plaintext, but session
# cookies and bearer tokens DO appear if you copy from devtools.
```

## What you've tried

<!-- Did `mnela claude:test` succeed? Did /api/v1/system/health return ok? -->
