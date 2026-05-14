# Mnela

Self-hosted personal second brain that exposes itself as an MCP server.

- Source of truth: PostgreSQL. Markdown vault is generated as an export.
- AI calls (Ask Brain, enrichment, vision, project-context) route through a pluggable provider layer (ADR-0049). The built-in **Claude Code (CLI) subprocess** works out of the box with a Claude Max subscription — no API key required. **Anthropic API** and any **OpenAI-compatible endpoint** (OpenAI, DeepSeek, Grok, Gemini-via-OpenRouter, Ollama, LM Studio) can be added in `/admin/system → AI Providers`.
- Falls back to "Dumb Mode" (FTS-only) if no provider is reachable.

See [`PLAN.md`](./PLAN.md) for phase-by-phase status.

## Features

- **Knowledge ingestion** — drag-and-drop ChatGPT / Claude.ai exports, Obsidian vaults, PDFs, Office docs, voice notes, images. Streaming ZIP parser handles multi-GB archives. Folder watcher picks up files from `${MNELA_DATA_DIR}/dropbox/`.
- **Auto entity + edge extraction** — every imported document is enriched via your chosen LLM provider; entities, relationships, decisions, and confidence-scored link suggestions land in the graph. Low-confidence proposals queue in **Review** (`/inbox`) for human triage.
- **Ask Brain** — chat over your vault with inline citations. SSE streams answer + tool-call timeline; pinning a Q&A turn promotes it to a Document and feeds it back into enrichment (ADR-0050).
- **Auto-suggested projects** — post-ingest detector (ADR-0051) groups related documents into project candidates without auto-creating them; accept or dismiss in `/projects?status=suggested`.
- **Telegram bot** — second canonical client (ADR-0053). Single-tenant, multi-modal turn bundling: voice + photo + text in one TG thread becomes one `/search/ask` call. Configure under `/admin/system → Telegram`.
- **Voice transcription** — optional whisper.cpp container; toggle under `/admin/system → Transcription`. Audio attachments stream out via Range-aware endpoints.
- **MCP server** (`apps/mcp`) — bearer-token-authenticated MCP host; connect from Claude Code, Cursor, Cline, ChatGPT, anything that speaks MCP.
- **One settings sheet** — `/admin/system` is the only admin page. Everything tunable (provider routing, ingestion limits, suggestion gates, Telegram config, API tokens) lives there and hot-reloads via the **Restart Services** button — no process restart needed.

## Install on a fresh VPS

```bash
curl -fsSL https://raw.githubusercontent.com/SmartDogg/mnela/main/scripts/install.sh | sudo bash
```

The script auto-installs Docker if missing, asks for your domain / IP /
Cloudflare Tunnel choice, generates `/opt/mnela/.env` with random secrets,
pulls images from GHCR, applies migrations, and prints the URL of the
Setup Wizard. Full guide: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

After install, open `/setup`, create the first admin, and either run
`docker exec -it mnela-orchestrator claude login` (if you have Claude Max)
or add an API provider under `/admin/system → AI Providers`.

Backup / restore: `mnela backup` and `mnela restore <file>` round-trip
everything including the encrypted provider keystore — see
[`scripts/backup.sh`](./scripts/backup.sh).

## Quick start (development)

```bash
cp .env.example .env       # edit POSTGRES_PASSWORD, REDIS_PASSWORD, COOKIE_SECRET
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
pnpm --filter @mnela/db db:migrate
pnpm --filter @mnela/db db:seed
pnpm dev                   # api:3000 + web:3001 + worker + orchestrator
# open http://localhost:3001/setup
```

Requires:

- **Node 22 LTS** + **pnpm 10+**
- **Docker** (for postgres + redis; optional whisper / production stack)
- **Claude Code CLI** (`claude --version`) for the default built-in provider. Skip if you'll configure an API provider in the Setup Wizard instead.

## Configuration model

| Tier                  | Lives in                                                                              | Hot-reloadable                                    | Examples                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Boot-critical secrets | `.env` only (this file is gitignored)                                                 | No                                                | `DATABASE_URL`, `REDIS_URL`, `COOKIE_SECRET`, `MNELA_PROVIDER_SECRET`, `MNELA_INTERNAL_TOKEN` |
| User-tunable settings | SystemConfig registry (`packages/core/src/system-registry.ts`); UI at `/admin/system` | Yes (Restart Services button, per-subscriber ack) | `enrichment.parallelism`, `search.fts.weight`, `transcription.enabled`, `telegram.enabled`    |

See [`.env.example`](./.env.example) for the full env list with comments. Provider API keys + the Telegram bot token are AES-256-GCM-encrypted in the database — never put them in `.env`.

## Documents

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — fresh-VPS install, backup/restore, Cloudflare Tunnel.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — typical failures and fixes.
- [`docs/EXPORT_GUIDES`](./docs/EXPORT_GUIDES/) — exporting from ChatGPT, Claude.ai, Obsidian.
- [`PLAN.md`](./PLAN.md) — phase plan and acceptance criteria.
- [`DECISIONS.md`](./DECISIONS.md) — architectural decisions log (ADRs).
- [`CLAUDE.md`](./CLAUDE.md) — developer guide for Claude Code working inside this repo.
- [`mnela-tz-prompt.md`](./mnela-tz-prompt.md) — full original technical spec (preserved as historical north star; amendments are pointed via ADRs).
- [`QUESTIONS.md`](./QUESTIONS.md) — open + resolved questions log.

## License

MIT — see [`LICENSE`](./LICENSE).
