# Mnela — developer guide for Claude Code

This file is read by Claude Code when working inside the Mnela repo. The Server-Brain instruction template that the runtime Claude subprocess uses lives at `infra/claude/CLAUDE.md.template` — DO NOT confuse the two.

## Architecture overview

- `apps/api` — NestJS HTTP API. `/search/ask` SSE stream, `/admin/*` panels, `/system/config` typed registry, `/admin/providers` LLM CRUD, `/projects` (incl. suggestions + preview + dismiss).
- `apps/orchestrator` — NestJS process running BullMQ consumers: enrichment, project-context, vision (analyze_attachment), claude-status boot, and the new `projects` consumer (project_suggest debounced post-enrichment + project_autofill). See [ADR-0051](./DECISIONS.md#adr-0051--auto-suggested-projects-post-import-detector--manual-create--ask-scope).
- `apps/worker` — ingestion worker (parsers, attachment promotion).
- `apps/mcp` — HTTP MCP transport for external tools.
- `apps/tg-bot` — Telegram bot frontend over `/search/ask` + `/documents/upload`. Single-tenant: one `TelegramBot` singleton row + `TelegramAllowedUser` whitelist. Configured under `/admin/system → Telegram`; hot-reloaded via `mnela:events` `telegram:reload` channel. grammY + Bot API 9.5 `sendMessageDraft` streaming. Multi-modal turn bundling (debounce `telegram.bundleWindowMs`) merges voice + photo + text into one /ask call. See [ADR-0053](./DECISIONS.md#adr-0053--telegram-bot-integration-single-tenant-frontend-over-searchask--documentsupload).
- `apps/web` — Next.js 15 UI. v1 menu has three sections: **Workspace** (`/`, `/graph`, `/ask`), **Library** (`/documents`, `/projects`, `/inbox` shown as "Review"), **Admin** (`/activity`, `/admin/system`). `/projects` (Active/Suggested/Dismissed tabs), `/projects/new` (suggestion grid + manual create + autofill), `/projects/[slug]` (Files/Timeline/Entities/Decisions/Questions + Ask-scope deep-link) — the Decisions tab owns the per-project list and Create flow (no standalone `/decisions` page). `/activity` is the single home for `?tab=uploads` (was `/imports`) and `?tab=queue` (was `/jobs`); legacy URLs redirect there. `/admin/system` is the only admin route — it folds in AI Providers + Claude Code status (expand) + Storage stats + API tokens (was `/admin/tokens`). See [ADR-0052](./DECISIONS.md#adr-0052--v1-menu-consolidation-imports--queues-review-decisions-into-projects-admin-into-system).
- `packages/llm-providers` — **the only place** AI calls flow through. See [ADR-0049](./DECISIONS.md#adr-0049--pluggable-llm-provider-abstraction).
- `packages/mcp-tools` — `@mnela/mcp-tools` registry. `invokeTool(name, input, ctx)` is the shared entry point for both the MCP host and the in-process agent loop.
- `packages/core` — `system-registry.ts`: typed `SystemConfig` keys + `readRegistryValue` shared by api/orchestrator/worker.
- `packages/db` — Prisma schema + repositories. Migrations are hand-written when `migrate dev` is impractical on Windows (see ADR-0048 stopgap pattern).
- `packages/claude-runner` — low-level wrapper around the `claude` CLI subprocess. **Never import directly from app code** — go through `@mnela/llm-providers`.

## Deploy & DX paths (Phase 10)

- `scripts/install.sh` — one-command VPS bootstrap (`curl … | sudo bash`). Generates `.env` with random secrets, clones to `/opt/mnela`, materialises a Caddyfile, runs the `migrate` one-shot compose service, issues the install-time AuthToken for tg-bot, then `--profile prod up -d`. Flags: `--domain HOST | --ip ADDR | --tunnel HOST | --no-claude | --branch TAG | --force`. Non-interactive without a mode flag is rejected.
- `scripts/update.sh` — `git fetch latest v* tag → compose pull|build → migrate → up -d`. Wired as `mnela update [--tag X]`.
- `scripts/backup.sh` — `pg_dump` + `mnela-data` tar (incl. `keystore/provider.key`) + optional `mnela-claude-creds`, single .tar.gz output. Refuses to run without keystore unless `--allow-no-keystore`.
- `scripts/restore.sh` — calls `scripts/validate-keystore.mjs` (AES-GCM via `crypto.createDecipheriv`, not `openssl -aead_tag_hex`) BEFORE wiping target DB. Uses `--profile migrate run --rm migrate` for schema catch-up.
- `apps/cli/src/main.ts` — `mnela <status|logs|backup|restore|update|claude:test|providers:export>`. Hand-rolled arg parsing, zero deps; shells into `scripts/*.sh` or `docker compose exec`.
- `apps/api/scripts/issue-bootstrap-token.mjs` — install-time AuthToken provisioner. Reads plaintext from `MNELA_INTERNAL_TOKEN` (env or argv), sha256-hashes, INSERTs `AuthToken(scope=mcp)`. Idempotent. Required so tg-bot can authenticate against api on first boot. Baked into Dockerfile.api via `apps/api/package.json` `files: ["dist", "scripts"]`.
- `infra/caddy/Caddyfile.{domain,ip,tunnel}.template` — three reverse-proxy variants; `install.sh` materialises the chosen one to `Caddyfile` at repo root (the compose mount expects it there). All carry `flush_interval -1` on `/api/v1/search/ask` for SSE.
- `infra/docker/Dockerfile.{api,web,worker,orchestrator,tg-bot,mcp,whisper}` — multi-stage, `node:22-slim`, non-root `mnela` user, BuildKit cache mounts. `Dockerfile.web` accepts `ARG NEXT_PUBLIC_MNELA_API_ORIGIN` because Next.js inlines `NEXT_PUBLIC_*` at build time. `Dockerfile.orchestrator` installs the Anthropic `claude` CLI at build time (network call to claude.ai/install.sh — pin with `--build-arg CLAUDE_INSTALL_REF=X.Y.Z`).
- `infra/docker/docker-compose.yml` — three profiles. No profile = dev (postgres + redis only, for `pnpm dev`). `--profile prod` = all 6 apps + Caddy. `--profile migrate` = one-shot `migrate` service reusing the api image with `prisma migrate deploy` as CMD; runs to completion via `run --rm`.
- `.github/workflows/release.yml` — on `v*` tag, builds + pushes all 6 multi-arch images to GHCR and publishes a GitHub Release with auto-generated changelog.
- `docs/EXPORT_GUIDES/{chatgpt,claude,obsidian}.md`, `DEPLOYMENT.md`, `TROUBLESHOOTING.md` — user-facing operator docs.

## Project suggestions (ADR-0051)

- Every `enrich_document` success triggers `ProjectsQueueService.debounceBatchSuggest(batchId)` on the import's `__import.batchId`. Five-minute debounce coalesces all docs in one batch into a single detector run.
- `SuggestionDetector` (SQL-only) finds two candidate shapes: `batch:<batchId>` (import batches) and `cluster:<sortedEntityHash>:<docBucket>` (entity co-occurrence). `SuggestionNamer` makes one Haiku-class call per emitted candidate; everything else is heuristic.
- The master gate `projects.suggestions.enabled` (default `true`) lives in `packages/core/system-registry.ts`. When off, the suggester exits before any SQL/LLM. Surfaced under the `Projects` section of `/admin/system`.
- Ask scope: `AskDto.scopeProjectSlug` + URL param `?scope=project:<slug>` on `/ask` plumbs through `ask.service.buildToolContext` so `mnela_find_similar` / `mnela_search` filter by project. The CLI provider gets the prefixed user turn but no filter shim (owns its own MCP).
- Lifecycle: `ProjectStatus = active | suggested | dismissed`. Dismiss removes `linkSource=suggested` links but keeps the row + `signatureMetrics` snapshot. On the next detector pass, growth ≥ 50% docs **or** ≥ 2 new top entities mints a fresh suggestion row (the dismissed one stays as audit).

## AI call routing (must read before touching)

Every LLM call goes through `@mnela/llm-providers`. The use-site pattern is:

```ts
const provider = await providersService.resolveForFeature(
  'ask' /* or enrichment / vision / projectContext */,
);
yield * provider.stream({ messages, tools, signal, image });
```

- `resolveForFeature(feature)` consults `providers.<feature>` → `providers.default` → built-in `claude-cli` in that order.
- `provider.stream(...)` yields `start | token | tool_call | tool_result | done | error` frames. The api SSE layer relays them 1:1.
- Tools (`PHASE_5_TOOLS` from `@mnela/mcp-tools`) are passed in `req.tools`. The CLI provider ignores them (CLI handles MCP itself); API providers run a multi-turn agent loop via `runAgentLoop(...)`.
- For single-turn callers (vision, project-context) use `completeProvider(provider, req)` instead of iterating manually.
- **Do not** call `streamClaude` or `runClaude` from app code. The CLI subprocess path is owned by `ClaudeCliProvider`.

## Provider config & keystore

- `LlmProvider` rows in Postgres hold `kind`, `model`, optional `baseUrl`, AES-256-GCM-encrypted `apiKeyEnc`, and `extra` JSON. The built-in `builtin:claude-cli` is virtual (never persisted).
- Master key: `MNELA_PROVIDER_SECRET` env (preferred) or `$MNELA_DATA_DIR/keystore/provider.key` auto-generated at boot.
- Admin UI exposes per-feature routing + "Apply default to all" in `/admin/system → AI Providers`.

## SystemConfig & hot-reload

- User-facing knobs live in the typed registry at `packages/core/system-registry.ts` (SystemConfig table holds overrides). Sections: `providers / ingestion / enrichment / whisper / search / api / projects / telegram / storage / advanced`. Every spec has `type` + `default`; `requiresRestart: true` flags entries whose runtime consumer is constructed once at boot (BullMQ worker concurrency, ThrottlerModule, dropbox watcher feature flag).
- **"Restart Services" button** (top of `/admin/system`) → `POST /system/restart` → publishes `system.service_reload` on Redis pubsub → each subscriber's `ReloadService` calls its registered hot-reload callbacks AND publishes a `system.service_reload_ack` frame the api collects within a 2.5 s window. **No `process.exit`** — the consumers close + recreate their BullMQ Workers in-process, so the same one-click flow works under docker / systemd / `pnpm dev` identically. **Subscriber coverage:** `apps/worker`, `apps/orchestrator`, and `apps/api` all subscribe and reply. The /admin/system overlay renders the per-subscriber ack list (✅ ok / ⚠️ noop / ❌ error) so the operator sees exactly which subsystem hot-reloaded vs which still needs a process restart.
- Env vars are reserved for boot-critical / secret / deploy-infra values: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `MNELA_DATA_DIR`, `WHISPER_URL`, `MNELA_INTERNAL_TOKEN`, `MNELA_PROVIDER_SECRET`. Everything tunable from the admin UI is in SystemConfig.
- All cards on `/admin/system` are collapsible and remember their open/closed state via `useCollapsibleSection` (localStorage `mnela:admin-system:open:<section>:u:<userId>`). Default is closed for every card so first-visit isn't a wall of settings. The key is namespaced per-principal so shared workstations don't leak one operator's state to the next; deep-link via `/admin/system#telegram` (and other section names) auto-opens the target card and scrolls to it.

## Project conventions

- TypeScript strict, no `any`, no implicit unknowns.
- Atomic commits, no `Co-Authored-By: Claude` (TZ §19).
- Tests live next to code under `__tests__/` (`vitest`). Integration tests under `apps/<app>/test/integration/` (testcontainers).
- Migrations: see `packages/db/prisma/migrations/`. When `prisma generate` is blocked on Windows by a held query-engine .dll, write a manual repository typing shim and keep the schema correct — the next clean restart regenerates the client.
- DECISIONS.md / QUESTIONS.md / PLAN.md are the source of truth for architecture choices and open issues.

## Don'ts

- Don't add LLM-calling code outside the provider abstraction.
- Don't echo decrypted API keys anywhere (logs, audit metadata, response bodies).
- Don't store provider keys in env vars per-provider — they belong in the encrypted `LlmProvider.apiKeyEnc`.
- Don't add `Co-Authored-By: Claude` to commits. Don't write marketing copy into the README.
