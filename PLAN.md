# Mnela — Implementation Plan

Source of truth for scope: [`mnela-tz-prompt.md`](./mnela-tz-prompt.md).
Architectural decisions log: [`DECISIONS.md`](./DECISIONS.md).
Open questions: [`QUESTIONS.md`](./QUESTIONS.md).

Each phase below MUST end in a working state. After each phase: tag `phase-N`.

---

## Phase 0 — Foundation

**Acceptance:** `pnpm install` succeeds, `docker compose up postgres redis` boots clean, `pnpm --filter @mnela/db db:migrate` applies all migrations including the FTS raw SQL, `pnpm --filter @mnela/db db:studio` opens, lint + typecheck both green.

- [x] git init + remote → `https://github.com/SmartDogg/mnela.git`
- [x] `.gitignore`, `LICENSE` (MIT), `README.md`, `PLAN.md`, `DECISIONS.md`, `QUESTIONS.md`
- [ ] Root tooling: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.editorconfig`, `.prettierrc`, `eslint.config.js`
- [ ] Skeletons for `apps/{api,mcp,web,worker,orchestrator,cli}` and `packages/{core,db,ingestion,search,graph,claude-runner,mcp-tools,shared-types,ui}`
- [ ] `packages/db` — full Prisma schema (TZ §4) + raw-SQL migration for FTS / pg_trgm / unaccent / pgvector
- [ ] Seed script with sample data
- [ ] `infra/docker/docker-compose.yml` — postgres + redis (dev profile)
- [ ] husky + lint-staged + commitlint
- [ ] `.github/workflows/ci.yml` — lint, typecheck, test on push/PR
- [ ] Smoke run + commit `phase-0` tag

## Phase 1 — Core API + DB layer (TZ §6)

**Acceptance:** REST API up, all CRUD endpoints from TZ §6 functional, FTS + trigram + hybrid search returns results, auth (session + bearer) works, AuditLog records mutations.

- [ ] `apps/api` — NestJS scaffold with modules: Documents, Projects, Decisions, Daily, Entities, Edges, Auth, System
- [ ] Prisma repositories in `packages/db`
- [ ] FTS query helpers in `packages/search` (FTS, trigram, hybrid)
- [ ] Auth module (Argon2 passwords, session cookies, bearer tokens, scope checks)
- [ ] AuditLog interceptor on mutating endpoints
- [ ] Rate limiting (login + api)
- [ ] Vitest unit tests for repos, integration tests for API (testcontainers)
- [ ] OpenAPI / Swagger generation

## Phase 2 — Ingestion (TZ §9)

**Acceptance:** Uploaded ChatGPT export ZIP turns into N parsed documents, all searchable; deduped by `content_hash`; folder watch picks up dropbox files.

- [ ] `packages/ingestion` — parsers: chatgpt, claude, claude-code-session, docx, pdf, md, txt, html, csv/json, image, audio (audio behind whisper flag)
- [ ] BullMQ queues: `ingestion`, `enrichment`, `indexing`, `maintenance`
- [ ] Idempotency by `content_hash`
- [ ] Chunker (700–1200 tokens, 100–150 overlap; tokenizer per DECISIONS)
- [ ] `apps/worker` — BullMQ consumers
- [ ] Redis pubsub bridge → Socket.io gateway in API
- [ ] Folder watcher on `/var/lib/mnela/dropbox/` (chokidar)
- [ ] Tests with real Claude.ai export from `data-*.zip`

## Phase 3 — Web UI skeleton (TZ §7)

**Acceptance:** Login + setup wizard work; all CRUD pages reachable; search page functional; no live progress yet.

- [ ] `apps/web` — Next.js 15 App Router, Tailwind, shadcn/ui, dark default
- [ ] Layout: sidebar nav + main + right context pane
- [ ] Pages: `/login`, `/setup`, `/`, `/search`, `/documents`, `/documents/:id`, `/projects`, `/projects/:slug`, `/decisions`, `/daily`, `/daily/:date`, `/inbox` (skeleton), `/imports`, `/imports/new`, `/imports/:id` (skeleton), `/admin/{system,tokens,claude,backup}`
- [ ] i18n via next-intl (English first, Russian dictionary)
- [ ] Auth flow with session cookie
- [ ] Cmd-K global search
- [ ] TanStack Query + Zustand wiring

## Phase 4 — Live progress + Graph (TZ §11)

**Acceptance:** Importing a ZIP shows growing live graph; pause/resume/cancel work; graph view supports filters, hover-evidence, layout switcher.

- [ ] Cytoscape.js wrapper in `packages/ui`
- [ ] `apps/api` graph endpoint with center/depth/types params
- [ ] `/graph` page with filters and interactions
- [ ] Socket.io client with namespace `/live`
- [ ] Live updates on `/imports/:id` with growing graph + log tail
- [ ] Animations: fadeIn nodes, pulse edges
- [ ] Pause/Resume/Cancel controls
- [ ] Job stats dashboard

## Phase 5 — Claude Code Orchestrator (TZ §3.4, §12)

**Acceptance:** New document is automatically enriched, entities and edges land in the graph; rate limit detected and respected; retry with backoff works.

- [ ] `packages/claude-runner` — typed wrapper around `claude` CLI subprocess
- [ ] `apps/orchestrator` — concurrency-1 enrichment worker, rate limiter
- [ ] CLAUDE.md template in `infra/claude/`
- [ ] MCP config for server-side Claude
- [ ] Health check (`mnela claude:test`)
- [ ] Confidence routing per TZ §3.3 step 6
- [ ] Retry with exponential backoff
- [ ] Rate-limit detection (parse subprocess output, system pubsub event)
- [ ] Pause/resume by rate-limit window

## Phase 6 — MCP server (TZ §5)

**Acceptance:** Local Claude Code can `claude mcp add … mnela` and call all read+write tools; admin scope gated.

- [ ] `apps/mcp` — NestJS host wrapping `@modelcontextprotocol/sdk` (HTTP transport)
- [ ] All tools from TZ §5 (read, write, admin)
- [ ] Bearer-token auth with scope (admin / mcp / read_only)
- [ ] Audit logging
- [ ] `docs/MCP_INTEGRATION.md` with examples for Claude Code, Cursor, Cline

## Phase 7 — Inbox + quality (TZ §7.2)

**Acceptance:** Inbox supports accept/reject/edit; entity merge UI works; edge editing works; keyboard shortcuts wired; empty/loading/error states polished.

- [ ] Inbox UI with diff-style preview, bulk actions, filters
- [ ] Entity merge flow
- [ ] Edge editing
- [ ] Search highlights
- [ ] Polished empty/loading/error states
- [ ] Keyboard shortcuts

## Phase 8 — Ask Brain (TZ §7.2)

**Acceptance:** Chat triggers server-side Claude subprocess; SSE streams answer with inline citations; "save synthesis" creates a new document.

- [ ] Chat UI
- [ ] SSE endpoint backed by `claude-runner`
- [ ] Citation parsing + rendering
- [ ] Save synthesis as note
- [ ] Conversation history

## Phase 9 — Optional modules (TZ §3.1)

**Acceptance:** With whisper profile enabled, voice upload triggers transcription; with profile disabled, voice attaches as raw file only.

- [ ] `infra/docker/Dockerfile.whisper` + `docker-compose.optional.yml`
- [ ] HTTP wrapper around whisper.cpp
- [ ] Voice upload UI
- [ ] Transcription pipeline integration

## Phase 10 — Deploy & DX (TZ §8)

**Acceptance:** Fresh `bash <(curl …)` on a clean VPS produces a running Mnela with HTTPS; `mnela update` works; backup/restore round-trips data.

- [ ] `scripts/install.sh` with full wizard
- [ ] `scripts/update.sh`, `backup.sh`, `restore.sh`
- [ ] `apps/cli` — `mnela` CLI (status/logs/backup/restore/claude:test)
- [ ] Caddyfile templates (domain / IP / tunnel)
- [ ] Multi-stage Dockerfiles for api/web/mcp/worker/orchestrator
- [ ] Docs: README.md (final), DEPLOYMENT.md, EXPORT_GUIDES/{chatgpt,claude,obsidian}.md, TROUBLESHOOTING.md
- [ ] Issue templates

## Phase 11 — Polish

**Acceptance:** Smoke E2E suite passes; perf and memory profiled; healthchecks return; optional Sentry wires up.

- [ ] Perf profiling
- [ ] Index audit
- [ ] Container memory limits + healthchecks
- [ ] Optional Sentry
- [ ] Playwright E2E in `apps/web/e2e`

---

## Out of scope for v1 (TZ §18)

Telegram bot, mobile app, public landing, multi-tenant, plugins API, marketplace, federated search, LLM proxy, TTS, image gen, realtime sync to Notion/Drive/GitHub.
