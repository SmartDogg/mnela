# Mnela

Self-hosted personal second brain that exposes itself as an MCP server.

- Source of truth: PostgreSQL. Markdown vault is generated as an export.
- AI calls (Ask Brain, enrichment, vision, project-context) route through a pluggable provider layer (ADR-0049). The built-in **Claude Code (CLI) subprocess** works out of the box with a Claude Max subscription — no API key required. **Anthropic API** and any **OpenAI-compatible endpoint** (OpenAI, DeepSeek, Grok, Gemini-via-OpenRouter, Ollama, LM Studio) can be added in `/admin/system → AI Providers`.
- Falls back to "Dumb Mode" (FTS-only) if no provider is reachable.

> Status: under construction. See [`PLAN.md`](./PLAN.md) for phase-by-phase progress.

## Quick start (development)

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
pnpm --filter @mnela/db db:migrate
pnpm --filter @mnela/db db:seed
pnpm dev
```

Requires Node 22 LTS, pnpm 10+, Docker.

## Documents

- [`mnela-tz-prompt.md`](./mnela-tz-prompt.md) — full technical spec.
- [`PLAN.md`](./PLAN.md) — phase plan and acceptance criteria.
- [`DECISIONS.md`](./DECISIONS.md) — architectural decisions log.
- [`QUESTIONS.md`](./QUESTIONS.md) — open questions log.

## License

MIT — see [`LICENSE`](./LICENSE).
