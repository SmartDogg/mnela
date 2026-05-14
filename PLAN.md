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
- [x] Pages (post-ADR-0052 v1 menu — see also ADR-0050): `/login`, `/setup`, `/`, `/ask`, `/graph`, `/documents`, `/documents/:id`, `/projects` (Active/Suggested/Dismissed tabs), `/projects/new`, `/projects/[slug]` (Files/Timeline/Entities/Decisions/Questions tabs), `/inbox` (labeled "Review"), `/imports/new`, `/imports/:id`, `/activity` (?tab=uploads|queue), `/admin/system`. Legacy `/imports`, `/jobs`, `/admin/jobs` redirect to `/activity`. `/daily` removed (ADR-0050). `/decisions`, `/admin/{tokens,claude,backup}`, `/search` removed (ADR-0052).
- [x] i18n via next-intl (English first, Russian dictionary)
- [x] Auth flow with session cookie
- [x] Cmd-K global search
- [x] TanStack Query + Zustand wiring

## Phase 4 — Live progress + Graph (TZ §11)

**Acceptance:** Importing a ZIP shows growing live graph; pause/resume/cancel work; graph view supports filters, hover-evidence, layout switcher.

- [x] `<MnelaGraph>` renderer in `packages/ui` — see ADR-0047, now built on react-force-graph-2d (canvas + d3-force) with custom radial-gradient halos, hover-dim 1-hop neighborhood, dual-mode highlight, continuous physics. Cytoscape.js was the previous implementation, removed in the same ADR.
- [x] `apps/api` graph endpoint with center/depth/types/relations/projectSlug/confidence/from/to + truncated stats; plus `/graph/overview`, `/graph/entity-types`, `/graph/relation-types`, `POST /graph/entities` (see ADR-0047)
- [x] `/graph` page with filters and interactions: density preset, dynamic entity-type & relation-type facets, dual-mode search + chip + breadcrumb, overlay EntityPanel with inline edit, "+ New entity" header button, mini-map, re-heat / fit camera controls
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

- [x] `infra/docker/Dockerfile.whisper` + `docker-compose.optional.yml`
- [x] HTTP wrapper around whisper.cpp (`packages/ingestion/src/whisper-client.ts`)
- [x] Voice upload UI — `<audio>` player + Re-transcribe button on `/documents/:id`, Setup Wizard checkbox persists `transcription_enabled` to SystemConfig
- [x] Transcription pipeline integration — `transcription` BullMQ queue + worker consumer + `mnela:whisper:status` (ADR-0043/44/45/46)
- [x] API surface: POST `/documents/:id/retranscribe`, GET `/documents/:id/attachment` (Range-aware 206/416), GET `/system/whisper-status`, POST `/system/transcribe-pending`

## Phase 10 — Deploy & DX (TZ §8)

**Acceptance:** Fresh `bash <(curl …)` on a clean VPS produces a running Mnela with HTTPS; `mnela update` works; backup/restore round-trips data **including the keystore + encrypted provider/Telegram secrets**.

- [x] `scripts/install.sh` with full wizard (generates `.env`, runs migrations, builds compose, prints first URL)
- [x] `scripts/backup.sh`, `restore.sh` — `backup.sh` includes `$MNELA_DATA_DIR/keystore/provider.key` plus `LlmProvider.apiKeyEnc` + `TelegramBot.tokenEnc` rows; `restore.sh` verifies the keystore decrypts before importing SQL
- [x] `apps/cli` — `mnela` CLI (status/logs/backup/restore/claude:test/`providers:export`); zero runtime deps, wraps `docker compose` + the bash scripts
- [x] Caddyfile templates (domain / IP / tunnel) with `flush_interval -1` on `/api/v1/search/ask` for SSE
- [x] Multi-stage Dockerfiles for api/web/mcp/worker/orchestrator/**tg-bot**; orchestrator bakes the Anthropic native installer for `claude` and persists `~/.claude` via the `mnela-claude-creds` volume
- [x] `infra/docker/docker-compose.yml --profile prod` — all 6 apps + caddy. postgres/redis stay profile-less so dev keeps working unchanged
- [x] `POST /auth/bootstrap` server endpoint + `GET /auth/setup-status`; `/login` redirects to `/setup` when no admin exists; wizard's step 1 calls bootstrap not login
- [x] Setup Wizard pre-expands relevant `/admin/system` cards (Providers, Telegram, Whisper if voice was enabled) on completion
- [x] `infra/claude/claude-mcp-config.json` converted to a reference-only template; the live config is generated at orchestrator boot per-install
- [x] `.github/workflows/release.yml` — multi-arch (amd64+arm64) GHCR builds for all 6 Dockerfiles on `v*` tag; ci.yml adds a `docker-build-smoke` job
- [x] Docs: README.md updated (no more "under construction" + one-command install snippet), `DEPLOYMENT.md`, `TROUBLESHOOTING.md`, `docs/EXPORT_GUIDES/{chatgpt,claude,obsidian}.md`
- [x] Issue templates (`bug.md`, `feature.md`) + `PULL_REQUEST_TEMPLATE.md`

## Phase 11 — Polish

**Acceptance:** Smoke E2E suite passes; perf and memory profiled; healthchecks return; optional Sentry wires up. UX rough edges from the ADR-0049/0050/0051/0052/0053 sprint are smoothed.

- [x] Perf profiling
- [x] Index audit
- [x] Container memory limits + healthchecks (incl. apps/tg-bot, apps/orchestrator projects queue)
- [x] Optional Sentry
- [x] Playwright E2E in `apps/web/e2e`
- [x] **Honest Restart Services UX** — per-subscriber ack via `mnela:events` (worker/orchestrator/api reply, UI shows ack/timeout), replacing the current 2.5s timer overlay (see CLAUDE.md "SystemConfig & hot-reload")
- [x] `/admin/system` command-bar search across SystemConfig keys + section names + anchor links (`/admin/system#telegram`)
- [x] Cmd-K palette: index Projects + Decisions + Conversations alongside Documents + Entities
- [x] Mobile sidebar (`Sheet` drawer from header hamburger, or `lg:flex md:flex` icon-only collapsed variant)
- [x] Persist `apps/tg-bot` `TurnBuffer` to Redis with TTL (currently in-process, lost on restart)
- [x] Per-day budget cap for `projects.suggestions` rescans (`projects.suggestions.maxPassesPerDay`)
- [x] Cost telemetry on provider `usage` frames (`Message.tokensIn/Out` + per-provider rate table → "$X this week" in admin)
- [x] Provider tool-use detection — badge non-tool-use models as "no citations" in admin
- [x] Dashboard first-visit empty state with CTAs ("Upload your first export", "Connect Telegram", "Connect Dropbox")
- [x] Scope chip moved from `/ask` composer footer to chat header (visible while reading, not just composing)
- [x] `useCollapsibleSection` localStorage key scoped per-user (avoid shared-workstation cross-user persistence)

---

## Done after Phase 8 — ADR-0049: Pluggable LLM provider abstraction (2026-05-13)

**Acceptance:** Every AI call (Ask Brain, enrichment, vision, project-context) routes through `@mnela/llm-providers`. Built-in `claude-cli` is the default and the no-config path; users can add Anthropic API / OpenAI-compatible providers in `/admin/system → AI Providers` and route per feature. API keys live AES-256-GCM-encrypted in `LlmProvider.apiKeyEnc`. Supersedes TZ §1 principle 2 ("никаких внешних AI API" → "по умолчанию никаких; опционально настраивается в /admin/system").

- [x] `packages/llm-providers` — `LLMProvider` interface, 3 implementations (`ClaudeCliProvider`, `AnthropicApiProvider`, `OpenAiCompatibleProvider`), in-process agent loop reusing `@mnela/mcp-tools`
- [x] `LlmProvider` Prisma model + migration `20260513120000_llm_providers`; built-in CLI virtual (never persisted)
- [x] Keystore: `MNELA_PROVIDER_SECRET` env or auto-generated `<MNELA_DATA_DIR>/keystore/provider.key`
- [x] `/admin/system → AI Providers` hero card with per-feature router + "Apply default to all" + Add-provider dialog (presets for OpenAI / DeepSeek / Grok / Gemini / OpenRouter / Ollama / LM Studio)
- [x] Chat tool-call timeline rendered uniformly for CLI + API providers

## Done after Phase 8 — ADR-0050: Pinned chat → Documents, /daily merges into /ask (2026-05-13)

**Acceptance:** Chat composer has a Pin / Ask toggle; pinning a Q&A turn promotes it to a `Document(source='chat')` and enrichment runs. `/daily` route deleted; Daily history surfaces as the AskSidebar's Daily tab grouping `Document(source IN 'chat','daily')` by day. Citations are derived from `tool_result` frames, not body regex.

- [x] `MessageKind = ephemeral | pinned` + `Message.pinnedDocumentId` back-reference
- [x] `AskService.promoteToDocument` bundles Q+A into a single Document and enqueues `enrich_document`
- [x] `SourceType.chat` + `SourceType.daily`; migration of legacy `DailyNote` rows → `Document(source='daily', status='raw')`; `DailyNote` table dropped
- [x] `CitationParser` regex removed; `mnela_find_similar` / `mnela_search` / `mnela_get_document` / `mnela_get_chunks` tool-result IDs become citation chips
- [x] SSE heartbeat (15s) + idle-timeout watcher (60s) + client retry-once
- [x] AskSidebar with Chats + Daily tabs; `/daily*` routes and `DailyModule` deleted; `mnela_get_daily_note` MCP tool preserved

## Done after Phase 8 — ADR-0052: v1 menu consolidation (2026-05-13)

**Acceptance:** Sidebar has exactly three sections (Workspace / Library / Admin) with 8 routes total. Imports + Jobs collapse into `/activity`; Decisions move into the project detail tab; `/admin/{tokens,claude,backup}` fold into `/admin/system`; `/daily` is gone (ADR-0050); `/search` becomes the Cmd-K palette only.

- [x] `/activity?tab=uploads|queue` page; `/imports`, `/jobs`, `/admin/jobs` redirect there
- [x] `/projects/[slug] → Decisions tab` is the only place to list/create decisions in the UI (API endpoint still accepts global POST for MCP/CLI callers)
- [x] `TokensSection`, `ClaudeStatusBlock`, Storage moved as cards into `/admin/system`
- [x] Sidebar i18n: Workspace (`/`, `/graph`, `/ask`), Library (`/documents`, `/projects`, `/inbox` as "Review"), Admin (`/activity`, `/admin/system`)
- [x] Redirect stubs for `/decisions`, `/admin/{tokens,claude,backup}`, `/search` — shipped in commit `188d79b` as part of the Bucket C cleanup

## Done after Phase 9 — ADR-0053: Telegram bot integration (2026-05-13)

**Acceptance:** A new `apps/tg-bot` (NestJS + grammY) is the second canonical client of `/search/ask` + `/documents/upload`. Single-tenant (`TelegramBot` singleton + `TelegramAllowedUser` whitelist), configured under `/admin/system → Telegram`, hot-reloaded via `mnela:events telegram:reload`. **Supersedes TZ §18** — "Telegram бот — отдельный проект" is no longer accurate; the bot ships in-scope as `apps/tg-bot`.

- [x] `apps/tg-bot` NestJS process; grammY + Bot API 9.5 `sendMessageDraft` streaming (fallback to single `sendMessage`)
- [x] Schema: `TelegramBot` singleton + `TelegramAllowedUser` + `TelegramChatLink`; `TelegramBot.tokenEnc` AES-256-GCM via shared keystore; `tokenLast4` for UI
- [x] Multi-modal `TurnBuffer<chatId>` debounce (`telegram.bundleWindowMs`, default 4s) merging voice + photo + text into one `/search/ask` call
- [x] Provenance on every uploaded Document: `source='telegram'`, `metadata.telegram = { chatId, msgId, userId, turnId }`
- [x] Reaction-as-status: 👀 received, 🎧 transcribing, 📷 analysing, ✍️ generating, ✅ done, ❌ error
- [x] Commands: `/scope <slug>`, `/save <text>`, `/last [N]`
- [x] `/admin/system → Telegram` card with token rotation, whitelist editor, `Test` (grammY `getMe()`), `Enabled` toggle
- [x] `/activity` source filter shows telegram-originated documents
- [x] `Dockerfile.tg-bot` + `tg-bot` service in `infra/docker/docker-compose.yml --profile prod` (shipped in Phase 10, commits `887e034` + `a595ed9`)
- [x] `TurnBuffer` persisted to Redis with TTL (Phase 11 Bucket C)

---

## Done after Phase 8 — ADR-0051: Auto-suggested projects (2026-05-13)

**Acceptance:** Imports trigger post-enrichment debounced detector that proposes Projects without auto-creating them; user can accept/dismiss; /projects/new combines suggestions + manual create with optional autofill; Ask Brain supports `?scope=project:<slug>`; admin master gate kills all token spend when off.

- [x] `ProjectStatus` / `ProjectSource` / `DocumentProjectLinkSource` enums + `signature` / `signatureMetrics` / `batchId` / `autoFill` columns
- [x] Manual migration `20260514120000_auto_suggested_projects`
- [x] `projects.suggestions.enabled` + `projects.autoSummary.enabled` SystemConfig keys with new `projects` admin section
- [x] BullMQ `projects` queue + `SuggestionDetector` (batch + cluster, SQL-only) + `SuggestionNamer` (single Haiku call, heuristic fallback) + `ProjectsSuggesterService` with revival logic + `ProjectsAutofillService`
- [x] Post-enrichment debounce trigger in `enrichment.consumer`
- [x] API endpoints: `GET /projects?status=`, `GET /projects/suggestions`, `POST /projects/suggestions/rescan`, `POST /projects/preview`, `POST /projects/:slug/dismiss`, `POST /projects` accept-from-slug flow, `POST /projects/:slug/documents`
- [x] Ask scope: `AskDto.scopeProjectSlug` plumbed through agent loop, search tool filters
- [x] Web: /projects with Active/Suggested/Dismissed tabs, /projects/new (suggestion grid + manual form + preview + autofill), /projects/[slug] redesigned with Files/Timeline/Entities/Decisions/Questions, "Ask about this project" deep-link
- [x] Tests: signature/revival unit + suggester gate-off short-circuit + revival path

---

## Out of scope for v1 (TZ §18, amended by ADR-0053)

Mobile app, public landing, multi-tenant, plugins API, marketplace, federated search, LLM proxy, TTS, image gen, realtime sync to Notion/Drive/GitHub.

> **Amendment:** TZ §18 originally listed "Telegram bot — отдельный проект" as out-of-scope. Reversed by [ADR-0053](./DECISIONS.md#adr-0053--telegram-bot-integration-single-tenant-frontend-over-searchask--documentsupload) (2026-05-13); Telegram bot ships in-scope as `apps/tg-bot`.
