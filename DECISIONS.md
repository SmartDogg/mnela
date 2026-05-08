# Architectural Decisions Log

Each entry: context, decision, alternatives considered, status. Reverse-chronological.

---

## ADR-0034 — MCP tool naming: `mnela_<verb>_<target>` snake_case, locked to TZ §5

**Context:** Phase 5 shipped four tools with names like `mnela_get_document`. Phase 6 adds ~14 more (TZ §5). The wire-name is a public contract: once Claude Code, Cursor, and Cline clients have it cached, renaming is breaking. We need to fix the convention before the registry doubles in size.
**Decision:** All tools are named `mnela_<verb>_<target>` (snake_case, project prefix). Names match TZ §5 verbatim — `mnela_search`, `mnela_get_document`, `mnela_get_chunks`, `mnela_list_projects`, `mnela_get_project_context`, `mnela_get_decisions`, `mnela_find_similar`, `mnela_get_entity`, `mnela_traverse_graph`, `mnela_get_daily_note`, `mnela_recent_activity`, `mnela_save_note`, `mnela_save_decision`, `mnela_add_entities`, `mnela_add_links`, `mnela_update_project_context`, `mnela_archive_document`, `mnela_trigger_enrichment`, `mnela_rebuild_index`, `mnela_export_vault`. Future tool additions follow the same convention. Schema changes to existing tools must be non-breaking (additive optional fields only); breaking changes require a new tool name.
**Alternatives:** camelCase (clashes with MCP ecosystem norms — most servers use snake_case); namespaced like `mnela.search` (TZ uses snake_case in §5); drop prefix (collisions with other MCP servers in a user's session).
**Status:** Accepted.

## ADR-0033 — MCP authentication: Bearer-only, per-call DB verify, no cache

**Context:** apps/mcp serves CLI clients (Claude Code, Cursor, Cline) over HTTP. Web sessions (ADR-0007) don't apply: there is no browser, no cookie, no CSRF surface. We need a minimal verify path that's both unambiguous in TZ §10.2 and revoke-immediate.
**Decision:** Bearer token only — `Authorization: Bearer mn_<32rand>` on every JSON-RPC request. Verification: `sha256Hex(token)` → `AuthTokenRepository.findByHash` → resolve scope → reject 401 (no/invalid token) or 403 (scope insufficient). No Redis cache layer: each call hits Postgres. Token format `mn_<base64url(32 bytes)>` is unchanged from Phase 1 (`apps/api/src/auth/auth.service.ts:11,57-58`). The auth/scope module in `apps/mcp/src/auth/` reuses `AuthTokenRepository` from `@mnela/db` and `scopeAllows()` from a shared helper (factor out from `apps/api/src/auth/types.ts:3-7` into `@mnela/db` or a tiny `@mnela/core/auth` module). Failures land in AuditLog with `actor='unknown'`, `action='mcp.auth.<failure_kind>'`.
**Alternatives:** Redis-cached verify (TTL 60s — bounded revoke window, plus invalidation hook on revoke; rejected because single-tenant MCP traffic is low-frequency and the cost of a Postgres query is dwarfed by tool execution; revisit in Phase 11 if profiling shows otherwise); session cookies for MCP (CLI clients don't have a cookie jar — they hold the bearer literal); JWT with short expiry (revocation requires denylist — same Redis dep, more code, no real win).
**Status:** Accepted.

## ADR-0032 — Admin tool `mnela_trigger_enrichment` enqueues unconditionally; orchestrator skips on Dumb Mode

**Context:** TZ §5 lists `mnela_trigger_enrichment({ documentId }) → { jobId }` as an admin tool. When Claude is unavailable (no binary, not logged in, rate-limited — see ADR-0029), three behaviours are possible: (a) tool returns 503 immediately; (b) tool enqueues the job and the orchestrator skips/fails it; (c) tool waits in-process for Claude to come back. Each has a different operator UX; (a) duplicates the gate decision (which already lives in worker per ADR-0027 and orchestrator pipeline guard); (c) is unbounded.
**Decision:** Tool always enqueues `enrich-document` to the `enrichment` queue with `attempts: 3, backoff: { type: 'exponential', delay: 1000 }` (same shape as worker's enqueue per ADR-0027) and returns `{ jobId }`. Orchestrator's pipeline guard reads `mnela:claude:status` (per ADR-0029); when `available === false`, it fails-fast the BullMQ job (move-to-failed with reason `'dumb-mode'`), so the operator sees the failure in the dashboard and can retry once Claude returns via `POST /documents/:id/reenrich` (Phase 5 endpoint). The MCP tool itself does not read `mnela:claude:status`. Symmetric with the worker enqueue path (ADR-0027) — the gate decision lives in exactly one place: at the moment of consumption, not the moment of enqueueing.
**Alternatives:** (a) tool returns 503 — duplicates the dumb-mode gate, drift risk; (b) tool waits — unbounded latency, MCP client times out; (c) tool returns success-with-warning string — defeats the structured `{ jobId }` contract.
**Status:** Accepted.

## ADR-0031 — Audit for MCP tool calls: opt-in `audit` metadata on ToolDefinition + same-tx wrap in registry

**Context:** ADR-0008 mandates AuditLog rows written in the same DB transaction as the mutation. The HTTP `AuditInterceptor` (`apps/api/src/audit/audit.interceptor.ts`) is request-bound (reads `req.headers`, `req.method`, `req.originalUrl`, `req.params`) — it doesn't transfer to MCP, where the unit of work is a tool invocation, not an HTTP route. We need same-tx audit for write/admin MCP tools without coupling them to Express.
**Decision:** Extend `ToolDefinition` (in `@mnela/mcp-tools/src/registry.ts`) with an optional `audit?: { action: string; targetType: string; targetIdFrom: 'input' | 'output'; targetIdPath: string }` field. `McpToolContext` gains a `principal: { id: string; name: string; scope: TokenScope }` field, populated by the apps/mcp host after Bearer verify. `invokeTool()` (or a new `runTool()` wrapper) opens `prisma.runInTx(...)` (now exported from `@mnela/db`, see ADR-0008 follow-up below) when `audit` is set, runs the handler, resolves `targetId` via `dot-prop`-style path, and writes the audit row through `AuditRepository.create()` inside the same transaction. Read-only tools declare no `audit` and skip the wrap. The actor string is `principal.kind=='token'` formatted as `token:<name>` (matches `apps/api/src/audit/audit.interceptor.ts:53`). On handler throw → tx rolls back, no audit, no half-applied mutation.

**ADR-0008 follow-up (PrismaService relocation):** `PrismaService` (with `runInTx` and `active()` plus the `AsyncLocalStorage<TransactionClient>`) currently lives in `apps/api/src/prisma.service.ts`. Phase 6 relocates it to `@mnela/db` so apps/api and apps/mcp share one source of truth. The repository factory injection (`() => prisma.active()` per `apps/api/src/repositories.module.ts:42`) ports verbatim. No semantic change — apps/api's `RepositoriesModule` simply re-imports from `@mnela/db`.
**Alternatives:** (a) Per-tool manual `prisma.$transaction` + audit write — boilerplate, easy to forget, drift from `@Audit` semantics; (b) HTTP-level audit interceptor on the MCP route — too coarse (one audit row per JSON-RPC call regardless of inner method, can't resolve `targetId` from tool input); (c) Decouple audit from the same-tx invariant for MCP — violates ADR-0008.
**Status:** Accepted.

## ADR-0030 — MCP HTTP transport: StreamableHTTPServerTransport (stateless), single POST /mcp route

**Context:** Phase 6 needs an HTTP MCP host. `@modelcontextprotocol/sdk@1.29.0` (the version pinned via Phase 5) ships three server transports: `StdioServerTransport` (Phase 5 already uses), `SSEServerTransport` (`server/sse.d.ts:35` — `@deprecated`), and `StreamableHTTPServerTransport` (the current MCP spec, rev 2025-03). Stateful sessionful mode requires `sessionIdGenerator` + per-session `Mcp-Session-Id` header tracking; stateless mode treats every request as independent. Mnela is single-tenant with low-frequency MCP traffic and no client-side session resumption needs.
**Decision:** Use `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`. **Stateless** mode: `sessionIdGenerator: undefined` — no `Mcp-Session-Id` tracking. Single Express route `POST /mcp` mounted via `@nestjs/platform-express` (per ADR-0010). The transport instance is constructed per-request inside the route handler so Bearer verify + scope context can be injected into the `McpServer` (per-tool registration is shared, but the principal is request-scoped). Health endpoint `GET /health` returns `{ status: 'ok' }` for docker-compose healthcheck and Caddy probing. SSE transport is **not** mounted — clients that don't speak Streamable HTTP either upgrade or the user files an issue.
**Alternatives:** (a) Stateful Streamable HTTP — adds session-tracking machinery (Redis-backed session store, GET handler for resumption, DELETE handler for explicit close) for marginal benefit in single-tenant; (b) Mount both Streamable HTTP and SSE — doubles auth/audit coverage and tests for a deprecated path; (c) Build a custom Express handler around the protocol (without SDK transports) — reinvents framing, error mapping, and is divergent from Phase 5's stdio host that uses the same SDK.
**Status:** Accepted.

## ADR-0029 — Dumb Mode flagging: single Redis key as the source of truth

**Context:** Phase 5 introduces server-side Claude. Mnela must keep working without it (Dumb Mode, FTS-only — TZ §1). Three subsystems need to know "is Claude usable right now?": (a) ingestion-consumer to decide whether to enqueue an `enrichment` job, (b) `GET /system/claude-status` to render the admin badge, (c) orchestrator's enrichment pipeline to short-circuit before spawning a subprocess. They must agree, can't drift, and must reflect dynamic events (a rate-limit hit mid-job needs to flip the flag without a redeploy).
**Decision:** A single Redis key `mnela:claude:status` stores `{ available: boolean, reason?: 'no-binary' | 'not-logged-in' | 'rate-limit' | 'orchestrator-not-running', checkedAt: ISO, resetAt?: ISO, version?: string }`. No TTL — last writer wins, the value is read-on-demand. Writers: orchestrator boot (calls `claudeTest()`, persists), `POST /system/claude-test` (api or admin trigger), enrichment pipeline on rate-limit detection. Readers: ingestion-consumer (gate enqueue), `/system/claude-status`, orchestrator pipeline guard. Every write also `publishEvent('system.claude_status_changed', { available, reason })` so the web UI's `setQueryData(['system','claude-status'])` (per ADR-0023) reflects within one tick. Helpers `readClaudeStatus(redis)` / `writeClaudeStatus(redis, state)` live in `@mnela/queue` so api/worker/orchestrator share one implementation.
**Alternatives:** Per-subsystem polling of `claudeAvailable()` (each subprocess check costs ~50ms — bad for ingestion throughput); env var (static, can't reflect mid-runtime rate-limit); database row (slower than Redis, no real benefit since this is ephemeral state); per-job `claude --version` probe (same cost as polling).
**Status:** Accepted.

## ADR-0028 — Synthetic Document graph nodes survive Phase 5 (live-only, hybrid kept)

**Context:** Q14 in QUESTIONS.md established a hybrid for Phase 4: persisted Project entities go to DB, Document graph nodes are emitted as live-only synthetic payloads (`entity.type='document'`, `entity.id=documentId`, no DB row). Phase 5 starts producing real entities (`person`, `technology`, `concept`, …) from server-side Claude. Question: do synthetic Document nodes still belong, get replaced, or get persisted?
**Decision:** Keep synthetic Document nodes as live-only payloads (no schema change, no DB row). Phase 5 emits real entities and real edges _additionally_ — both reach the UI through the same `@mnela/ui` `toCytoscapeElements` transform (ADR-0024). IDs cannot collide: synthetic nodes use the `documentId` (cuid produced by the Document model), real entity IDs are independent cuids from the Entity model. The `/imports/:id` live graph thus shows two strata: documents-as-anchors (synthetic) and the knowledge graph growing around them (real). The persisted `/graph` REST endpoint keeps returning only real Entity rows — synthetic Document nodes are import-time visualization only.
**Alternatives:** (a) Drop synthetic Document nodes when real entities arrive — harder UX (the document the user just dropped vanishes from the picture); (b) Persist synthetic nodes as `Entity(type=document)` — pollutes the entity merge surface, breaks `@@unique(normalizedName, type)` for chats whose titles repeat, doubles the row count for every imported document; (c) Replace synthetic with the real entities Phase 5 extracts — confuses live UX (an item the user identifies on screen disappears mid-import).
**Status:** Accepted.

## ADR-0027 — Enrichment trigger: worker enqueue on persist, atomic with `document.parsed`

**Context:** Phase 5 needs to kick the enrichment pipeline once a document is parsed. Two options: (a) `apps/worker/src/ingestion/ingestion.consumer.ts` calls `enrichmentQueue.add()` at the end of `persistDocument()`, alongside the `document.parsed` event; (b) `apps/orchestrator` subscribes to `mnela:events` for `document.parsed` and enqueues from there. Option (b) decouples ingestion from the existence of the orchestrator app, but introduces a window where the worker has emitted `document.parsed` and the orchestrator hasn't received-and-enqueued — a crash inside that window leaves the document parsed-but-never-enriched, requiring a backfill cron.
**Decision:** Worker enqueues. After the worker writes the Document row and emits `document.parsed`, it reads `mnela:claude:status` (per ADR-0029); if `available === true`, it calls `enrichmentQueue.add('enrich-document', { dbJobId, documentId })` with `attempts: 3, backoff: { type: 'exponential', delay: 1000 }`. If `available === false`, it logs `enrichment skipped (dumb mode)` and the document stays at `status='parsed'` — searchable via FTS, no Inbox traffic. Worker already imports `@mnela/queue` for the `ingestion` queue itself, so the coupling is one extra `Queue('enrichment')` injection — no new app boundary crossed.
**Alternatives:** Pubsub-driven enqueue from orchestrator (loses never-miss guarantee); hybrid worker-enqueue + reconcile cron in orchestrator (overkill for single-tenant — the worker enqueue path is already at-least-once via BullMQ, and the rare failure window is recoverable manually via `/documents/:id/reenrich` once that endpoint comes alive in Phase 5); transactional outbox pattern (heavy machinery for a single Redis-backed queue).
**Status:** Accepted.

## ADR-0026 — Rate-limit detection: stream-json frames + best-effort regex on reset text

**Context:** `claude -p` does not expose a structured `resetAt` / `retryAfter` field for subscription rate-limit hits. Three signals are observable instead: (a) `--output-format stream-json` emits `{type:'system',subtype:'api_retry',error:'rate_limit',error_status:429,attempt,max_retries,retry_delay_ms}` frames before the CLI gives up; (b) the final `{type:'result'}` frame's `result` text contains a human-readable marker like `"You've hit your session limit · resets 3:45pm"` or `"You've hit your weekly limit · resets Mon 12:00am"`; (c) the CLI internally retries up to `CLAUDE_CODE_MAX_RETRIES` (default 10) before failing. We need to (1) detect rate-limit fast, (2) extract a `resetAt` if possible, (3) pause the BullMQ enrichment queue accordingly.
**Decision:** Run `claude` with `--output-format stream-json --verbose --include-partial-messages` and `CLAUDE_CODE_MAX_RETRIES=0` (so the orchestrator owns the retry loop, not the CLI). Parse NDJSON line-by-line. Rate-limit signal: any `system/api_retry` frame with `error === 'rate_limit'`, OR the final `result.result` text matching `/You've hit your (session|weekly|Opus) limit/`. `parseRateLimitReset(text)` extracts the reset clock with two regexes — `\bresets (\d{1,2}):(\d{2})(am|pm)\b` (next occurrence today/tomorrow at that local clock) and `\bresets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}):(\d{2})(am|pm)\b` (next occurrence of that weekday). If neither matches, fallback to `Date.now() + 5 * 60 * 60 * 1000` (Claude Max's documented 5-hour rolling window). On detection: `rateLimit.pause(resetAt)` calls BullMQ `queue.pause()`, persists `mnela:claude:rate-limit = { resetAt }` in Redis, schedules `queue.resume()` via a single `setTimeout` (orchestrator is concurrency-1, in-process scheduling is fine), updates `mnela:claude:status` (per ADR-0029), and emits `system.claude_status_changed`.
**Alternatives:** Plain `--output-format json` (loses the early `api_retry` frame, only sees the final result — Claude has already burned 10 retry-delays by then); rely solely on the marker string in `stderr` (the docs are inconsistent about which channel carries it); a pre-flight `claude api status` probe (no such command exists in the CLI as of 2026-05); a heuristic count of how many requests Mnela has made in the rolling window (Mnela can't see the user's other Claude Max usage outside the server, so the count is unsafe).
**Status:** Accepted.

## ADR-0025 — MCP in Phase 5: minimal stdio host, tools shared with Phase 6

**Context:** TZ §3.3 step [5] says enrichment must call `mnela.find_similar` and write through `mnela.add_entities` / `mnela.add_links`, i.e. the server-side Claude expects an MCP channel. Phase 6 builds the HTTP MCP server (`apps/mcp`), but Phase 5 needs MCP _now_, served by stdio (`claude --mcp-config` only takes stdio servers in this position). Two paths: (i) build a small stdio MCP host in Phase 5 and let Phase 6 reuse the tool implementations under HTTP, or (ii) skip MCP, inline the document into the prompt, parse Claude's JSON answer, and write through repositories directly — losing `find_similar` graph-traversal at extraction time but moving faster.
**Decision:** Build the minimal stdio MCP. Tool implementations live in `@mnela/mcp-tools` as a transport-neutral registry: each tool is `(input, ctx) => Promise<output>` with Zod input/output schemas and a declared scope (`admin` | `mcp` | `read_only`). Phase 5 ships **four** tools — `mnela_get_document`, `mnela_find_similar`, `mnela_add_entities`, `mnela_add_links`. Confidence routing (>0.8 auto, 0.5–0.8 needs_review + InboxItem, ≤0.5 drop) lives inside `add_links` so the rule is not duplicated in the orchestrator. The stdio host is a small module at `apps/orchestrator/src/mcp/stdio-host.ts`, spawned by `claude` as a child via the `claude-mcp-config.json` entry — it imports the registry, builds a `McpToolContext` (Prisma + repositories + Redis publisher), and wraps everything in `@modelcontextprotocol/sdk`'s `Server` + `StdioServerTransport`. Phase 6's `apps/mcp` will mount the same registry under HTTP transport, adding bearer-token auth + scope checking + the remaining ~11 tools from TZ §5.
**Alternatives:** (a) Inline-prompt without MCP — fastest path, but drops `find_similar` and forces Mnela-side similarity in a separate post-hoc step, defeating the original "Claude does the reasoning, Mnela stores the result" architecture; (b) Stdio MCP in a separate app `apps/mcp-stdio` — cleanly factored but adds another package.json/tsconfig/build target for one entry file in Phase 5 — overkill since the orchestrator is the only consumer; (c) Build the full Phase 6 HTTP server now and run it locally over loopback — Claude CLI's `--mcp-config` doesn't natively prefer HTTP over stdio for local servers in this version, and it forces the auth/scope work earlier than Phase 6.
**Status:** Accepted.

## ADR-0024 — Graph payload: server denormalized, UI owns Cytoscape transform

**Context:** Phase 4 needs both (a) GET `/graph` returning a snapshot for the page-load and (b) `graph.*` Socket.io events streaming Entity/Edge as they appear. Cytoscape expects elements shaped `{ data: { id, source, target, ... }, classes: [...] }`. We could (a) keep API in domain shape (Entity/Edge with `confidence`, `status`, `relationType`) and transform inside `@mnela/ui`, (b) have the API emit pre-Cytoscape elements, (c) introduce a normalized view-model package between them.
**Decision:** API stays in domain shape — `GET /graph` returns `{ nodes: Entity[], edges: Edge[], stats }`; live events carry the same Entity/Edge objects. `@mnela/ui` owns a single transform function `toCytoscapeElements(node | edge)` that maps domain → Cytoscape elements and assigns CSS classes from `entity.type` and `edge.status` (`auto_confirmed` solid, `needs_review` dashed). The transform is exported from `@mnela/ui` so consumers can pre-shape during SSR if needed. Confidence is encoded both as a class (`high|mid|low`) and as a numeric data attribute for tooltip rendering.
**Alternatives:** Pre-Cytoscape elements from API (couples API to a UI library — bad for the MCP-frontable contract); normalized view-model package (drift risk between API and UI for marginal benefit in single-tenant).
**Status:** Accepted.

## ADR-0023 — Live event → TanStack Query: per-event-type sync strategy

**Context:** TanStack Query owns server state (ADR-0018); Socket.io streams live events. Two ways to keep the cache fresh: (a) `queryClient.invalidateQueries(...)` on every event — triggers refetch, canonical, but extra HTTP; (b) `queryClient.setQueryData(...)` patch from the event payload — zero HTTP, but only safe when payload is sufficient. Picking the wrong policy per event causes flicker, drift, or wasted bandwidth.
**Decision:** Per-event-type table:

- `job.created/started/progress/completed/failed` → `setQueryData` on `['jobs', id]` and `['imports', id]`. Payload self-sufficient.
- `document.created/parsed` → `setQueryData` on `['imports', jobId, 'documents']` (append/update item).
- `document.enriched` (Phase 5+) → `invalidateQueries` — payload only counts; canonical refetch needed.
- `graph.node_added/edge_added` → **bypasses** TanStack Query — streamed directly into the Zustand `liveStore`/Cytoscape imperative ref. `/graph` page does a one-shot `useQuery` on mount; the live store appends after.
- `graph.node_updated` → `invalidateQueries` on `['graph', 'entities', entityId]`.
- `inbox.item_added` (Phase 7) → `invalidateQueries` on `['inbox']`.
- `system.claude_status_changed` (Phase 5) → `setQueryData` on `['system', 'claude-status']`.
  **Alternatives:** Invalidate everywhere (HTTP storm during heavy ingestion, /graph flickers on every node added); patch everywhere (drift on enrichment which sends only deltas).
  **Status:** Accepted.

## ADR-0022 — Cytoscape lives in `@mnela/ui` as a direct dep, layout plugins lazy-loaded

**Context:** `<MnelaGraph>` is the first real export of `@mnela/ui`. Cytoscape core is ~200 KB minified; `cytoscape-cose-bilkent` adds ~80 KB; a navigator (mini-map) plugin adds ~20 KB. The web app should not pay for the cose-bilkent layout on routes that don't need it (e.g. `/imports/:id` defaults to the lighter cose layout).
**Decision:** `cytoscape` is a direct `dependency` of `@mnela/ui` (not peer) — single resolved copy via the shared package, no version-skew risk in a single-app monorepo. `cytoscape-cose-bilkent` and the navigator plugin are direct deps too, but loaded via dynamic `await import('cytoscape-cose-bilkent')` inside `<MnelaGraph>` only when their layout/feature is first activated. React 18+ goes as a `peerDependency`. Bundle budget for `/graph`: ≤ 350 KB gzip on first load (Cytoscape + plugins) — measured via `next build` analyzer in Phase 11.
**Alternatives:** `cytoscape` as peer (forces every consumer to install — fine when there are many consumers; we have one); plugins as peers (no benefit, same risk); Cytoscape direct in `apps/web` (defeats the purpose of a shared `@mnela/ui`).
**Status:** Accepted.

## ADR-0021 — Socket.io transport: direct connect to `MNELA_API_ORIGIN`, not via Next rewrites

**Context:** Web runs on `:3001`, API on `:3000`. ADR-0020 routes HTTP through Next.js `rewrites()` (`/_api/*` → API), which works because rewrites preserve cookies and method/body. Next 15 rewrites do NOT preserve the `Upgrade: websocket` handshake — Socket.io would silently fall back to long-polling, defeating the live-progress UX. In production behind Caddy, the same origin serves both HTTP and WS, so direct same-origin connect is identity.
**Decision:** Browser opens `io(NEXT_PUBLIC_MNELA_API_ORIGIN, { withCredentials: true, transports: ['websocket'], path: '/socket.io' }).of('/live')`. `NEXT_PUBLIC_MNELA_API_ORIGIN` defaults to `http://localhost:3000` in dev; in prod it's the public origin (same one the page is served from, so the connect is same-origin and cookies flow). The `mnela_session` signed cookie auto-attaches because of `withCredentials: true` — no bearer token needed for the Web UI; the live gateway's existing dual auth (ADR-0017) accepts it. API CORS is already permissive enough (`{ origin: true, credentials: true }` on the gateway). Polling fallback (HTTP `/jobs/:id` every 2 s) kicks in when the Zustand `liveStatus` stays `'unavailable'` >5 s after the first connect attempt.
**Alternatives:** Custom Next.js server with WS proxy (extra hop, breaks `next start`/static export, more failure modes); Caddy-only WS in dev (forces dev devs to run Caddy locally — nope); Server-Sent Events (one-way, would force a separate channel for control messages).
**Status:** Accepted.

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
