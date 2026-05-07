# Mnela

Self-hosted personal second brain that exposes itself as an MCP server.

- Source of truth: PostgreSQL. Markdown vault is generated as an export.
- Enrichment uses a server-side `claude` CLI subprocess (no third-party LLM API keys).
- Falls back to "Dumb Mode" (FTS-only) if Claude Code isn't installed.

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
