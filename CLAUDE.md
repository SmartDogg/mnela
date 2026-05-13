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
