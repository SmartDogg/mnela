# Architectural Decisions Log

Each entry: context, decision, alternatives considered, status. Reverse-chronological.

---

## ADR-0020 — Web auth: Next.js middleware + same-origin proxy via rewrites

**Context:** The web app runs on `:3001` and the API on `:3000`. The session cookie is `HttpOnly` + signed + `SameSite=lax` and is scoped to the API origin. We need (a) the web app to reach the API in dev without CORS noise, (b) `Set-Cookie` on `/auth/login` to actually land in the browser, and (c) middleware on the web app to gate unauthenticated routes by checking presence of `mnela_session`.
**Decision:** Use Next.js `rewrites()` in `apps/web/next.config.ts` to proxy `/_api/*` → `http://localhost:3000/api/v1/*`. The fetch client always talks to `/_api/...` (same-origin), so cookies flow naturally and the API doesn't need CORS. Middleware in `apps/web/middleware.ts` redirects unauthenticated traffic to `/login` based on the presence of the `mnela_session` cookie (the cookie is signed; presence is sufficient gate — `/auth/me` is the authoritative check inside protected pages). In production behind Caddy, the same path mapping is provided by the reverse proxy and the rewrite is a no-op.
**Alternatives:** Direct CORS (forces credentialed CORS config, doubles error surface area, weaker CSRF posture); BFF route handlers in Next.js (extra hop, no benefit for a single-tenant app); deploy api+web on the same Node process (couples lifecycles, breaks Phase 0 split).
**Status:** Accepted.

## ADR-0019 — Web client types: generated from OpenAPI

**Context:** The API uses `nestjs-zod` to derive runtime validators and Swagger schemas (ADR-0009). The web app needs accurate types for request bodies and responses. We could re-export the Zod schemas from `@mnela/shared-types`, but Zod brings a runtime dep into every web client bundle that imports it, and the schemas are NestJS-flavoured (parameter-property classes via `createZodDto`) which doesn't tree-shake cleanly into a Next.js client bundle.
**Decision:** Generate `apps/web/src/lib/api/schema.ts` from `http://localhost:3000/api/docs-json` with `openapi-typescript`. A `pnpm --filter @mnela/web codegen:api` script runs `openapi-typescript` against the live API (or a checked-in `openapi.json` for CI). The fetch client uses `openapi-fetch` for typed calls and inferred response types. `@mnela/shared-types` keeps its tiny role for cross-cutting type aliases (e.g. branded ids) but is NOT the typing channel for HTTP DTOs.
**Alternatives:** Re-export Zod schemas from `@mnela/shared-types` (couples client bundle to nestjs-zod runtime); hand-roll DTO interfaces in the web app (drift risk); tRPC (would require API rewrite away from REST/MCP-shaped contracts).
**Status:** Accepted.

## ADR-0018 — Web state split: TanStack Query for server, Zustand for ephemeral UI

**Context:** TZ §2 names both TanStack Query and Zustand. We need a clear rule for which library owns what — otherwise we get duplicated cache-and-state for the same value and stale UI.
**Decision:** TanStack Query owns every server-derived value (lists, detail, search results, jobs, principal). Zustand owns ephemeral client-only state (Cmd-K open/closed, sidebar collapsed, theme override before persistence, draft form state shared across two components). React Server Components own anything that can be rendered server-side without interactivity. Form state stays local to the component (`react-hook-form`) unless it crosses a route boundary.
**Alternatives:** TanStack Query everywhere (forces every UI bit through a query cache); Zustand everywhere (loses HTTP cache + retries + dedupe); Server Components only (loses optimistic updates and Cmd-K live filter UX).
**Status:** Accepted.

## ADR-0017 — Redis pubsub message format

**Context:** Worker emits live progress events; API forwards them to Socket.io clients in `/live`. We need a wire format that's small, type-safe, and matches the WebSocket events listed in TZ §6.
**Decision:** A single Redis channel `mnela:events`. Each message is `JSON.stringify({ type, payload })` where `type` is a string literal from a discriminated union (`MnelaEvent` in `@mnela/queue`). Type names mirror TZ §6 verbatim: `job.created`, `job.started`, `job.progress`, `job.completed`, `job.failed`, `document.created`, `document.parsed`, `document.enriched`, `graph.*`, `inbox.item_added`, `system.claude_status_changed`. The API gateway re-emits each event over Socket.io as `socket.emit(event.type, event.payload)` — so frontend code listens directly for the TZ vocabulary.
**Alternatives:** One channel per event type (more pubsub, no win); structured frames with seqNum + per-client filtering (premature for single-tenant); MessagePack (size win negligible for our volumes).
**Status:** Accepted.

## ADR-0016 — Worker boots as a NestJS application context

**Context:** Phase 2's worker needs DI (Prisma, Redis, repositories, BullMQ workers). It does not serve HTTP. We also need to run the same worker module inside the API integration test process for end-to-end ingestion tests.
**Decision:** `apps/worker/src/main.ts` bootstraps via `NestFactory.createApplicationContext(WorkerModule)` — DI wiring without HTTP. Tests reuse this with `buildTestWorker()` (see `apps/api/test/bootstrap-worker.ts`) and import the worker module via a relative path to avoid a workspace-built dependency.
**Alternatives:** Plain Node script with manual DI (loses parameter-property injection); a long-running HTTP server (unnecessary surface area).
**Status:** Accepted.

## ADR-0015 — Shared queue contract: `@mnela/queue` package

**Context:** Both the API (publisher / Socket.io subscriber) and the worker (consumer) need the BullMQ queue names, job-data shapes, and pubsub event vocabulary. Co-locating these in `@mnela/ingestion` would couple "how we run jobs" to "how we parse files"; inlining per-app would let the two sides drift.
**Decision:** A new `@mnela/queue` package owns: queue names (`ingestion`/`enrichment`/`indexing`/`maintenance`), a `createQueueConnection` helper for BullMQ-friendly ioredis connections (`maxRetriesPerRequest: null`), the `IngestFileJob`/`EnrichmentJob`/etc job-data unions, and the `MnelaEvent` discriminated union with `publishEvent`/`subscribeEvents` helpers. Imported by `apps/api`, `apps/worker`.
**Alternatives:** Inline in `@mnela/ingestion` (couples concerns); inline per-app (drift risk).
**Status:** Accepted.

## ADR-0014 — Image and audio without Claude/whisper: passthrough Document(status='raw')

**Context:** TZ §9.1 spells out that images and audio without Claude vision / whisper are stored "as attachment without processing". They still need to surface in `/documents` listings so the user can re-enrich later (Phase 5/9), and Phase 1's invariant "every uploaded file becomes a Document row" should hold.
**Decision:** Image and audio parsers return `ParsedDocument` with `rawText: ''`, `type: 'image' | 'audio'`, plus a `ParsedAttachment` describing the binary. The worker writes `Document(status='raw')` plus an `Attachment` row pointing at the file in `${MNELA_DATA_DIR}/attachments/<hash-prefix>-<safeName>`. FTS body is empty but the title is searchable. `/documents/:id/reenrich` (Phase 5) will re-process through Claude vision; whisper integration (Phase 9) will transcribe audio attachments.
**Alternatives:** Save Attachment only, no Document (breaks the listing invariant); enqueue `enrichment_failed` Inbox item (heavier UX, less honest about "we just don't have Claude yet").
**Status:** Accepted.

## ADR-0013 — Ingestion writes are not audited

**Context:** TZ §10.5 requires AuditLog rows for mutations, but the surrounding text scopes that to user / Claude / MCP-tool actions. The Phase-1 `AuditInterceptor` is HTTP-bound and uses request-scoped principal + target metadata. Worker ingestion writes Document/DocumentChunk/Attachment rows en masse — a single Claude.ai export can produce tens of thousands of rows.
**Decision:** Worker ingestion writes go through repositories directly (no `@Audit` decorator, no `runInTx`-wrapping interceptor). User-initiated mutations on the API surface keep being audited (incl. `document.upload` which audits the _Job creation_, not the per-document inserts). Re-enrichment in Phase 5 may add per-Entity audit rows because those edits are model/user-driven, not bulk parsing.
**Alternatives:** Audit every ingestion write as `actor='system:worker'` (creates audit rows roughly equal to Document count — drowns the table); audit at the import-batch level only with a result summary (acceptable but adds work for marginal value beyond what Job.result already captures).
**Status:** Accepted.

## ADR-0012 — `useDefineForClassFields: false` + SWC under Vitest

**Context:** NestJS DI relies on TypeScript parameter properties (e.g. `constructor(private readonly admins: AdminUserRepository)`) being assigned via the constructor call. Modern ECMAScript class-fields semantics (the default once `target` ≥ ES2022) emit `this.admins = void 0;` immediately after the constructor body, overwriting whatever DI placed there — and esbuild (Vitest's default transpiler) emits decorator metadata incompletely.
**Decision:** Set `useDefineForClassFields: false` in `apps/api/tsconfig.json`, and configure Vitest to use `unplugin-swc` so SWC handles `experimentalDecorators` + `emitDecoratorMetadata` correctly. Production builds keep using `tsc`.
**Alternatives:** Replace parameter properties with explicit `@Inject()` everywhere (verbose, easy to forget); use `ts-jest` instead of Vitest (loses speed and shared config).
**Status:** Accepted.

## ADR-0011 — FTS bilingual deferred to Phase 2

**Context:** The Phase-0 FTS migration hard-codes the `russian` text-search config in the `Document.search_vector` generated column. English-only documents stem suboptimally with that config (e.g. `Postgres → postgres` works but `gardening → garden` does not under russian).
**Decision:** Keep the russian config for Phase 1. Per-document language detection + a regenerated `search_vector` (using `to_tsvector(language, …)`) lands in Phase 2 alongside the ingestion parsers, where language metadata is available.
**Alternatives:** Switch to `simple` config now (no stemming, weaker recall); use `english` config (worse for Russian-heavy corpora). Both are worse trade-offs than waiting for per-document language signals.
**Status:** Accepted.

## ADR-0010 — HTTP framework: Express (NestJS default)

**Context:** NestJS supports both Express and Fastify adapters. Phase-1 needs multipart upload, signed cookies, helmet, throttler — all of which have first-class Express integrations.
**Decision:** Stay on `@nestjs/platform-express`. Revisit Fastify only if perf profiling in Phase 11 shows the adapter is a bottleneck.
**Alternatives:** Fastify (`@nestjs/platform-fastify`) — ~2× throughput on micro-benchmarks but introduces friction with multer-style multipart middleware and our existing `cookie-parser` choice.
**Status:** Accepted.

## ADR-0009 — Validation + OpenAPI via `nestjs-zod`

**Context:** REST DTOs need both runtime validation and Swagger schema generation. We already use Zod for env validation.
**Decision:** Define DTOs as Zod schemas wrapped in `createZodDto(...)`; register `ZodValidationPipe` globally. One source of truth for the type, the validator, and the OpenAPI schema. No `class-validator` parallel definitions.
**Alternatives:** `class-validator` + `class-transformer` (NestJS default; second source of truth and dual decorator stack); manual schema duplication.
**Status:** Accepted.

## ADR-0008 — AuditLog written inside the same DB transaction as the mutation

**Context:** TZ §10.5 requires every mutation to leave a record in `AuditLog`. If the audit insert is a best-effort follow-up after the mutation commits, an audit-write failure leaves the system in a "mutated but unaudited" state — not acceptable.
**Decision:** A method-level `@Audit({ action, targetType, … })` decorator opts a handler into a `prisma.$transaction` opened by `AuditInterceptor`. The interceptor stores the transaction client in `AsyncLocalStorage` so the request's repository methods all use the same `Prisma.TransactionClient` (via `prisma.active()`), and writes the audit row inside that transaction after the handler resolves. Handler throw → tx rolls back, no audit, no half-applied mutation. Target id resolution falls back through `params[targetIdParam]` → `result.id` → `result.{document,entity,…}.id`.
**Alternatives:** Fire-and-forget audit log after `res.send()` (loses atomicity); separate audit DB (overkill for single-tenant); explicit per-service tx wrapping (boilerplate, easy to forget).
**Status:** Accepted.

## ADR-0007 — Sessions: Redis-backed, signed cookie

**Context:** Phase 1 needs admin sessions for the Web UI flow, plus Bearer tokens for MCP/CLI clients (TZ §10.2). Single-tenant deploy, but we want easy logout + future session listing.
**Decision:** Generate a 32-byte random session id, sign the value into the `mnela_session` HttpOnly cookie via `cookie-parser`, and store `{ adminUserId, createdAt }` in Redis under `mnela:session:<id>` with `SESSION_TTL_SECONDS` TTL. Logout calls `DEL`.
**Alternatives:** Stateless JWT (revocation requires a denylist — same Redis dependency, more code); Postgres-backed sessions (extra table, slower than Redis, and we already need Redis for BullMQ in Phase 2).
**Status:** Accepted.

## ADR-0006 — i18n: next-intl with English-first dictionaries

**Context:** TZ §7.3 calls for RU + EN UI. User asked for high-quality translations and "English first" defaults.
**Decision:** `next-intl` with JSON dictionaries under `apps/web/src/i18n/messages/{en,ru}.json`. Default locale `en`. `ru` translated by hand for key flows; for less critical strings we'll start with auto-translation pass and refine.
**Alternatives:** `next-i18next` (older, weaker App Router story); `react-intl` (more boilerplate); custom hook (reinventing the wheel).
**Status:** Accepted.

## ADR-0005 — Tokenizer: `gpt-tokenizer`

**Context:** Chunker needs to count tokens for 700–1200-token chunks. Server runs Node.
**Decision:** `gpt-tokenizer` (pure-JS BPE, no native deps, broad encoding support including `cl100k_base` and `o200k_base`). Token counts won't match Claude's tokenizer 1:1 but are close enough for chunk-size targeting; we don't bill on these counts.
**Alternatives:** `tiktoken` (WASM, heavier install, runs in worker thread fine); `js-tiktoken` (similar to gpt-tokenizer but slower).
**Status:** Accepted. Revisit if Anthropic publishes a JS tokenizer.

## ADR-0004 — Confidence scoring: model-emitted, not computed

**Context:** TZ §3.3, §4 require every entity/edge to carry `confidence ∈ [0,1]`, with thresholds 0.5 / 0.8 routing to reject / review / auto-confirm. TZ doesn't specify how the number is produced.
**Decision:** Confidence is emitted by server-side Claude per the rubric in `infra/claude/CLAUDE.md.template`. Mnela treats it as an opaque score, applies thresholds, and logs the raw value in `Edge.metadata.confidence_raw` for later calibration. The CLAUDE.md rubric will define anchors (1.0 = explicit in text; 0.9 = strongly implied; 0.7 = plausible inference; 0.5 = speculative; <0.5 = drop).
**Alternatives:** Compute heuristically from co-occurrence frequency or embedding similarity (no LLM); blend LLM score with co-occurrence prior. Both viable later, but require pgvector or co-occurrence stats we don't have in MVP.
**Status:** Accepted for MVP. Revisit when calibration data accumulates.

## ADR-0003 — Postgres image: `pgvector/pgvector:pg16`

**Context:** TZ §2 requires Postgres 16 with `pg_trgm`, `unaccent`, `pgvector` (reserved for future). `postgres:16-alpine` ships pg_trgm + unaccent but not pgvector; pgvector image is built on the official Postgres image.
**Decision:** Use `pgvector/pgvector:pg16` as the dev and prod base. No custom Dockerfile needed for db.
**Alternatives:** Build a custom Dockerfile from `postgres:16-alpine` adding pgvector. Rejected — extra maintenance for no benefit.
**Status:** Accepted.

## ADR-0002 — Node 22 LTS

**Context:** TZ §2 says "Node.js 20+ LTS". Node 22 entered LTS in October 2024 and is the current Active LTS. Dev machine has Node 22.17 already installed.
**Decision:** Pin engines to `^22.0.0`. Use Node 22 in CI and Docker.
**Alternatives:** Node 20 LTS (still maintained but older). Sticking to a single supported LTS reduces matrix.
**Status:** Accepted.

## ADR-0001 — Stack baseline (locked by TZ §2)

The TZ pre-locks: NestJS 10+, Prisma, Postgres 16+, Redis 7+, BullMQ, Pino, Next.js 15, Tailwind, shadcn/ui, Cytoscape.js, TanStack Query, Zustand, Socket.io, `@modelcontextprotocol/sdk`, Caddy 2+, optional whisper.cpp, optional Cloudflare Tunnel. We follow as specified. Versions chosen at install time will be the latest stable in each line.
**Status:** Accepted (inherited from TZ).

---

## Template

```
## ADR-NNNN — Title

**Context:** What problem we're solving.
**Decision:** What we're doing.
**Alternatives:** What we considered and rejected (with reason).
**Status:** Proposed | Accepted | Superseded by ADR-XXXX | Reverted.
```
