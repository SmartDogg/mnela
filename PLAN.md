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

- [x] `apps/api` — NestJS scaffold with modules: Documents, Projects, Decisions, Daily, Entities, Edges, Auth, System, Inbox, Jobs, Imports, Search
- [x] Prisma repositories in `packages/db`
- [x] FTS query helpers in `packages/search` (FTS, trigram, hybrid)
- [x] Auth module (Argon2 passwords, session cookies, bearer tokens, scope checks)
- [x] AuditLog interceptor on mutating endpoints (same-tx via AsyncLocalStorage)
- [x] Rate limiting (login 10/min + global 100/min)
- [x] Vitest unit tests for utilities, integration test for API (testcontainers postgres+redis)
- [x] OpenAPI / Swagger generation (nestjs-zod + @nestjs/swagger, served at `/api/docs`)
- [x] Stubbed for Phase 5: `/search/ask`, `/documents/:id/reenrich`, `/projects/:slug/refresh-context`, `/system/claude-{status,test}` return 503 with proper `application/problem+json`
- [x] Stubbed for Phase 2: `/imports` persists upload to `MNELA_DATA_DIR/uploads/` and creates `Job(type=ingest_file)`; `/documents/upload` accepts `text/plain|markdown|json` only (other mimetypes → 415)

## Phase 2 — Ingestion (TZ §9)

**Acceptance:** Uploaded ChatGPT export ZIP turns into N parsed documents, all searchable; deduped by `content_hash`; folder watch picks up dropbox files.

- [x] `packages/ingestion` — parsers: chatgpt, claude, claude-code-session, docx, pdf, md, txt, html, csv, json, image, audio (audio behind whisper flag)
- [x] `packages/queue` — BullMQ queue names + Redis pubsub helpers (ADR-0015)
- [x] BullMQ queues registered: `ingestion` (concurrency 4), stubs for `enrichment` / `indexing` / `maintenance`
- [x] Idempotency: `content_hash = sha256(rawText)` (no sourceId) or `sha256(source::sourceId::rawText)` (per-conversation)
- [x] Chunker (700–1200 tokens, 100–150 overlap; gpt-tokenizer per ADR-0005)
- [x] `apps/worker` — NestJS application context with BullMQ consumers (ADR-0016)
- [x] Redis pubsub bridge `mnela:events` → Socket.io gateway `/live` (ADR-0017)
- [x] Folder watcher on `${MNELA_DATA_DIR}/dropbox/` (chokidar)
- [x] `/documents/upload` and `/imports` route every file through the worker (async contract, returns Job)
- [x] Image and audio without Claude/whisper → Attachment + Document(status=raw) (ADR-0014)
- [x] Ingestion writes are not audited; user-initiated job creation is (ADR-0013)
- [x] Integration tests on testcontainers: real Claude.ai ZIP, dropbox watcher smoke, Socket.io live events

## Phase 3 — Web UI skeleton (TZ §7)

**Acceptance:** Login + setup wizard work; all CRUD pages reachable; search page functional; no live progress yet.

- [x] `apps/web` — Next.js 15 App Router, Tailwind, shadcn/ui, dark default
- [x] Layout: sidebar nav + main + right context pane
- [x] Pages: `/login`, `/setup`, `/`, `/search`, `/documents`, `/documents/:id`, `/projects`, `/projects/:slug`, `/decisions`, `/daily`, `/daily/:date`, `/inbox` (skeleton), `/imports`, `/imports/new`, `/imports/:id` (skeleton), `/admin/{system,tokens,claude,backup}`
- [x] i18n via next-intl (English first, Russian dictionary)
- [x] Auth flow with session cookie
- [x] Cmd-K global search
- [x] TanStack Query + Zustand wiring

## Phase 4 — Live progress + Graph (TZ §11)

**Acceptance:** Importing a ZIP shows growing live graph; pause/resume/cancel work; graph view supports filters, hover-evidence, layout switcher.

- [x] Cytoscape.js wrapper in `packages/ui` (`<MnelaGraph>` with imperative ref, lazy cose-bilkent, in-house mini-map)
- [x] `apps/api` graph endpoint with center/depth/types/relations/projectSlug/confidence/from/to + truncated stats
- [x] `/graph` page with filters and interactions (filter sidebar, search, layout switcher, entity panel, mini-map)
- [x] Socket.io client with namespace `/live` (singleton manager, refcounted subs, exp backoff, 5s degrade timer)
- [x] Live updates on `/imports/:id` with growing graph + log tail
- [x] Animations: fadeIn nodes, pulse edges
- [x] Pause/Resume/Cancel controls (Resume === POST /imports/:id/start)
- [x] Job stats dashboard (throughput, durations p50/p95, error rate, recent failed table)

## Phase 5 — Claude Code Orchestrator (TZ §3.4, §12)

**Acceptance:** New document is automatically enriched, entities and edges land in the graph; rate limit detected and respected; retry with backoff works.

- [x] `packages/claude-runner` — typed wrapper around `claude` CLI subprocess
- [x] `apps/orchestrator` — concurrency-1 enrichment worker, rate limiter
- [x] CLAUDE.md template in `infra/claude/`
- [x] MCP config for server-side Claude
- [x] Health check (`mnela claude:test`) — `POST /system/claude-test`
- [x] Confidence routing per TZ §3.3 step 6 (lives in `mnela_add_links`)
- [x] Retry with exponential backoff (BullMQ attempts:3)
- [x] Rate-limit detection (stream-json frames + result text parse, ADR-0026)
- [x] Pause/resume by rate-limit window (`RateLimitService` + setTimeout)
- [x] `packages/mcp-tools` — shared registry (4 tools) reused by Phase 6 HTTP host (ADR-0025)
- [x] stdio MCP host at `apps/orchestrator/src/mcp/stdio-host.ts`
- [x] `/system/claude-status` real, pubsub-fed (`system.claude_status_changed`, ADR-0029)
- [x] Web Inbox shows `link_suggestion` cards with Accept/Reject + live updates
- [x] Web `/admin/claude` shows status badge, version, last-test, rate-limit window, test button

## Phase 6 — MCP server (TZ §5)

**Acceptance:** Local Claude Code can `claude mcp add … mnela` and call all read+write tools; admin scope gated.

- [x] `apps/mcp` — NestJS host wrapping `@modelcontextprotocol/sdk` (HTTP transport)
- [x] All tools from TZ §5 (read, write, admin)
- [x] Bearer-token auth with scope (admin / mcp / read_only)
- [x] Audit logging
- [x] `docs/MCP_INTEGRATION.md` with examples for Claude Code, Cursor, Cline

## Phase 7 — Inbox + quality (TZ §7.2)

**Acceptance:** Inbox supports accept/reject/edit; entity merge UI works; edge editing works; keyboard shortcuts wired; empty/loading/error states polished.

- [x] Inbox UI with diff-style preview, bulk actions, filters
- [x] Entity merge flow
- [x] Edge editing
- [x] Search highlights
- [x] Polished empty/loading/error states
- [x] Keyboard shortcuts

## Phase 8 — Ask Brain (TZ §7.2)

**Acceptance:** Chat triggers server-side Claude subprocess; SSE streams answer with inline citations; "save synthesis" creates a new document.

- [x] Chat UI
- [x] SSE endpoint backed by `claude-runner`
- [x] Citation parsing + rendering
- [x] Save synthesis as note
- [x] Conversation history

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
