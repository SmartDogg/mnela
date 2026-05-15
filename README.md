<div align="center">

```
███╗   ███╗ ███╗   ██╗ ███████╗ ██╗      █████╗
████╗ ████║ ████╗  ██║ ██╔════╝ ██║     ██╔══██╗
██╔████╔██║ ██╔██╗ ██║ █████╗   ██║     ███████║
██║╚██╔╝██║ ██║╚██╗██║ ██╔══╝   ██║     ██╔══██║
██║ ╚═╝ ██║ ██║ ╚████║ ███████╗ ███████╗██║  ██║
╚═╝     ╚═╝ ╚═╝  ╚═══╝ ╚══════╝ ╚══════╝╚═╝  ╚═╝
```

**Your second brain becomes an MCP server, in one click.**

[![CI](https://github.com/SmartDogg/mnela/actions/workflows/ci.yml/badge.svg)](https://github.com/SmartDogg/mnela/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 22 LTS](https://img.shields.io/badge/node-22%20LTS-brightgreen.svg)](https://nodejs.org/)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-host-8a4fff.svg)](https://modelcontextprotocol.io/)

[Install](#install-one-command-on-a-fresh-vps) · [Features](#features) · [Quick start](#quick-start-local-dev) · [Docs](#documentation)

</div>

---

## What is Mnela?

Self-hosted personal-knowledge OS. Drop in your ChatGPT / Claude.ai exports, Obsidian vaults, voice notes, PDFs — Mnela parses them, links them into a knowledge graph, and exposes everything as an **MCP server** so Claude Code, Cursor, Cline, ChatGPT and any other MCP client can read and write into your second brain.

- **Postgres is the source of truth.** A markdown vault is generated as an export.
- **AI calls route through a pluggable provider layer** ([ADR-0049](./docs/dev/DECISIONS.md#adr-0049--pluggable-llm-provider-abstraction)). The built-in **Claude Code (CLI) subprocess** works out of the box with a Claude Max subscription — no API key required. **Anthropic API** and any **OpenAI-compatible endpoint** (OpenAI, DeepSeek, Grok, Gemini-via-OpenRouter, Ollama, LM Studio) can be added in `/admin/system → AI Providers`.
- **Falls back to Dumb Mode (FTS-only)** if no provider is reachable, so the UI never goes dark.

## Features

- **Drag-and-drop ingestion** — ChatGPT/Claude.ai exports, Obsidian vaults, PDFs, Office docs, voice notes, images. Streaming ZIP parser handles multi-GB archives. Folder watcher picks up files dropped into `${MNELA_DATA_DIR}/dropbox/`.
- **Auto knowledge graph** — every document is enriched by your chosen LLM; entities, relationships, decisions, and confidence-scored link suggestions land in the graph. Low-confidence proposals queue in **Review** for human triage.
- **Ask Brain** — chat over your vault with inline citations. SSE-streamed answer + tool-call timeline. Pin any Q&A turn to promote it to a Document and feed it back into enrichment.
- **Auto-suggested projects** — post-ingest detector groups related documents into project candidates; accept or dismiss in `/projects?status=suggested`.
- **MCP server** — bearer-token-authenticated MCP host (`apps/mcp`); connect from Claude Code, Cursor, Cline, ChatGPT, anything that speaks MCP.
- **Telegram bot** — second canonical client. Multi-modal turn bundling: voice + photo + text in one TG thread becomes one `/search/ask` call.
- **One settings sheet** — `/admin/system` is the only admin page. Provider routing, ingestion limits, suggestion gates, Telegram config, API tokens — all hot-reloadable via **Restart Services** (no process restart).

## Install (one command on a fresh VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/SmartDogg/mnela/main/scripts/install.sh | sudo bash
```

The script auto-installs Docker if missing, asks for domain / IP / Cloudflare Tunnel choice, generates `/opt/mnela/.env` with random secrets, pulls images from GHCR, applies migrations, and prints the URL of the Setup Wizard.

After install, open `/setup`, create the first admin, then either run `docker exec -it mnela-orchestrator claude login` (if you have Claude Max) or add an API provider under `/admin/system → AI Providers`.

**Backup / restore:** `mnela backup` and `mnela restore <file>` round-trip everything including the encrypted provider keystore.

Full guide → [DEPLOYMENT.md](./DEPLOYMENT.md)

## Quick start (local dev)

```bash
git clone https://github.com/SmartDogg/mnela && cd mnela
cp .env.example .env       # edit POSTGRES_PASSWORD, REDIS_PASSWORD, COOKIE_SECRET
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
pnpm --filter @mnela/db db:migrate
pnpm --filter @mnela/db db:seed
pnpm dev                   # api :3000 · web :3001 · worker · orchestrator
# open http://localhost:3001/setup
```

Requires **Node 22 LTS**, **pnpm 10+**, **Docker**. Optional: **Claude Code CLI** for the default built-in provider.

## Configuration model

Two tiers, deliberately split:

| Tier                  | Lives in                                      | Hot-reloadable           | Examples                                                                                      |
| --------------------- | --------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| Boot-critical secrets | `.env` (gitignored)                           | No                       | `DATABASE_URL`, `REDIS_URL`, `COOKIE_SECRET`, `MNELA_PROVIDER_SECRET`, `MNELA_INTERNAL_TOKEN` |
| User-tunable settings | SystemConfig registry — UI at `/admin/system` | Yes (per-subscriber ack) | `enrichment.parallelism`, `search.fts.weight`, `transcription.enabled`, `telegram.enabled`    |

Provider API keys and the Telegram bot token are AES-256-GCM-encrypted in the database — never put them in `.env`.

## Architecture (one-line tour)

| Service                  | Role                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `apps/api`               | NestJS HTTP API, SSE `/search/ask`, `/admin/*`, `/projects`                       |
| `apps/web`               | Next.js 15 UI (`/`, `/graph`, `/ask`, `/documents`, `/projects`, `/admin/system`) |
| `apps/worker`            | BullMQ ingestion pipeline (parsers, attachment promotion)                         |
| `apps/orchestrator`      | Claude Code subprocess manager + enrichment + project suggestions                 |
| `apps/mcp`               | MCP server (Streamable HTTP transport)                                            |
| `apps/tg-bot`            | Telegram frontend over `/search/ask` + `/documents/upload`                        |
| `packages/llm-providers` | The only place AI calls flow through                                              |
| `packages/mcp-tools`     | Shared tool registry for MCP host + in-process agent loop                         |

## Documentation

- **Operators**
  - [DEPLOYMENT.md](./DEPLOYMENT.md) — fresh-VPS install, backup/restore, Cloudflare Tunnel
  - [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — typical failures and fixes
  - [docs/EXPORT_GUIDES/](./docs/EXPORT_GUIDES/) — exporting from ChatGPT, Claude.ai, Obsidian
  - [docs/MCP_INTEGRATION.md](./docs/MCP_INTEGRATION.md) — connecting MCP clients
- **Contributors**
  - [CONTRIBUTING.md](./CONTRIBUTING.md) — how to propose changes
  - [CLAUDE.md](./CLAUDE.md) — developer guide for Claude Code working inside this repo
  - [docs/dev/DECISIONS.md](./docs/dev/DECISIONS.md) — architectural decisions log (ADRs)
  - [docs/dev/PLAN.md](./docs/dev/PLAN.md) — phase plan and acceptance criteria
  - [docs/dev/QUESTIONS.md](./docs/dev/QUESTIONS.md) — open + resolved questions log
  - [docs/dev/ORIGINAL_TZ.md](./docs/dev/ORIGINAL_TZ.md) — original technical spec, preserved as historical north star
- **Security**
  - [SECURITY.md](./SECURITY.md) — vulnerability disclosure policy

## License

[MIT](./LICENSE) — © 2026 SmartDogg
