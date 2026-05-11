# Architectural Decisions Log

Each entry: context, decision, alternatives considered, status. Reverse-chronological.

---

## ADR-0046 — Audio attachment streaming: Range-aware Express handler on `GET /documents/:id/attachment`

**Context:** Phase 9 adds an audio player to `/documents/:id`. The web client uses native `<audio controls preload="metadata" src="/_api/documents/:id/attachment">`. The element issues a `HEAD` (or `GET` with `Range: bytes=0-`) to read duration, then partial `Range` requests when the user seeks. Without proper `206 Partial Content` support, seek silently breaks in Chrome/Safari for files > a few MB. The codebase had no binary-streaming pattern yet (recon: no `createReadStream`, `StreamableFile`, or `Range`/`Content-Range` usage outside `apps/api/src/modules/search/search.controller.ts` SSE writes).

**Decision:** Implement Range parsing inline in the controller method (≈30 LOC):

1. Resolve `Document` by `:id`, verify `type === 'audio'` (or any future binary type), load its single `Attachment` row, resolve filesystem path inside `${MNELA_DATA_DIR}/attachments/`.
2. `stat` for `byteSize`; set `Accept-Ranges: bytes`, `Content-Type: attachment.mimeType`, `Content-Disposition: inline; filename="..."`.
3. Parse `Range: bytes=START-END?` header. Missing → `200 OK` with full body, `Content-Length: byteSize`, `fs.createReadStream(path)`. Present → clamp `END` to `byteSize - 1`, emit `206 Partial Content`, `Content-Range: bytes START-END/byteSize`, `Content-Length: END-START+1`, `createReadStream(path, { start, end })`.
4. Malformed Range → `416 Range Not Satisfiable` with `Content-Range: bytes */byteSize`.
5. Auth via the existing session+bearer guard pipeline (every other documents route uses the same). No `@RequiredScope('admin')` — single-tenant; logged-in user owns everything.

Implementation lives in `apps/api/src/modules/documents/documents.controller.ts`, uses Express `Response` via `@Res({ passthrough: false })` exactly like `search.controller.ts` does for SSE — keeps the pattern consistent across binary/streaming endpoints. `@nestjs/common`'s `StreamableFile` is rejected because it does not natively support `Range` in NestJS 10 — it sets `Content-Length` and writes the full body, breaking seek.

**Alternatives:** (a) `StreamableFile` for the no-Range path + manual handler only for Range — duplicate code paths, marginal benefit; (b) Serve attachments behind Caddy `file_server` in production — works prod-only, dev (`pnpm dev`) loses the route; (c) Generate signed short-lived URLs to a separate static handler — extra surface area for one binary type.

**Status:** Accepted.

## ADR-0045 — Whisper container: build whisper.cpp server from source, ggml-base model, language-locked at boot

**Context:** Phase 9 needs a transcription engine reachable by HTTP from `apps/worker`. The TZ §3.1 names `whisper.cpp HTTP API` — implies a self-built container, not OpenAI's API or a managed service. whisper.cpp ships a built-in HTTP server (`examples/server`) since v1.5.x; building from source gives us version pinning and CPU-only operation (Mnela's target VPS has no GPU). Three model tiers exist: `ggml-tiny` (~75MB), `ggml-base` (~140MB), `ggml-small` (~466MB), `ggml-medium` (~1.5GB). The user is bilingual RU/EN; `ggml-base` multilingual is acceptable for short voice memos on a $5 VPS.

**Decision:** Multi-stage `infra/docker/Dockerfile.whisper`. Stage 1 (`builder`, `debian:bookworm-slim`): apt-install `build-essential cmake git ca-certificates curl`; `git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git /src`; `cmake -B build -DWHISPER_BUILD_SERVER=ON`; `cmake --build build --target whisper-server -j$(nproc)`; `curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin -o /models/ggml-${MODEL}.bin`. Stage 2 (`runtime`, `debian:bookworm-slim`): apt-install `libgomp1 ca-certificates`; copy `whisper-server` + `/models`. `ENTRYPOINT ["/usr/local/bin/whisper-server","-m","/models/ggml-${MODEL}.bin","--host","0.0.0.0","--port","8080","--language","${LANGUAGE}"]`. Build ARGs `MODEL=base`, `LANGUAGE=ru` (defaults match TZ §14 `MNELA_TRANSCRIPTION_LANGUAGE=ru`).

`infra/docker/docker-compose.optional.yml` exposes the service as `whisper`, attached to the default compose network. `profiles: [optional]` so plain `docker compose up` does not start it. Healthcheck `wget -qO- http://localhost:8080/ || exit 1`, `start_period: 30s` (whisper-server cold-loads the model).

Env knobs:

- `MNELA_TRANSCRIPTION=enabled|disabled` (TZ §14) — gates the worker's enqueue path and the boot probe.
- `MNELA_TRANSCRIPTION_LANGUAGE=ru` (TZ §14) — passed to whisper-server via Dockerfile ARG, also passed per-request as `language` form field for override safety.
- `MNELA_WHISPER_MODEL=base|small|medium` (new) — Dockerfile ARG default, overridable when the operator rebuilds the image.
- `WHISPER_URL=http://whisper:8080` (new) — worker + api read this. Default uses compose service-DNS.

Model swap is rebuild-only (Dockerfile downloads at build time, not runtime). Acceptable for an optional module — operators flip the env, rerun `docker compose build whisper`, restart.

**Alternatives:** (a) Public prebuilt image (e.g., `ggerganov/whisper.cpp:latest` if it exists) — supply-chain risk + opaque versioning; (b) Pin model in a sidecar volume + runtime download — startup-time download bloats `up` and surfaces network failure as a healthcheck flap; (c) Use the Python `whisper`/`faster-whisper` server — heavier image (~1GB base), slower CPU inference, doesn't match TZ wording; (d) Ship `ggml-tiny` to fit lowest-end VPS — too noisy for Russian, TZ user's primary language; (e) Default `ggml-small` — 3× slower on CPU, breaks the "$5 VPS" promise. Memory: `ggml-base` resident set ≈250 MB during inference, well under 1 GB.

**Status:** Accepted.

## ADR-0044 — `transcription` BullMQ queue: dedicated, concurrency-1, parallel to `enrichment`

**Context:** Phase 9 routes audio uploads through whisper.cpp asynchronously. The existing queues (`ingestion / enrichment / indexing / maintenance`) don't fit: ingestion already finished its work (Document+Attachment row written), enrichment is Claude's domain (single shared rate limit, slot-lock per ADR-0041), and indexing is for FTS rebuilds. Folding transcription into `ingestion` would couple file-parse concurrency (4) to whisper's natural single-call serialization. Folding into `enrichment` would force whisper jobs through Claude's rate-limit gate (per ADR-0029) which has no relation to whisper availability.

**Decision:** New BullMQ queue `transcription`, concurrency-1 (single whisper container, sequential to keep its memory bounded), retry `attempts: 3` with exponential backoff `1000ms` (mirrors enrichment per ADR-0027). Job payload:

```ts
interface TranscribeAudioJob {
  dbJobId: string; // FK to Job(type='transcribe_audio')
  documentId: string;
}
```

Job-name string `'transcribe_audio'` matches the Prisma enum value (new in this phase).

Consumer flow (in `apps/worker/src/transcription/transcription.consumer.ts`):

1. Read `mnela:whisper:status` — if `available === false`, throw so BullMQ retries; after `attempts` exhausted, the Job row lands `status='failed'` with `reason='whisper-down'`.
2. Load `Document(type='audio')` + its `Attachment`. If `Document.status !== 'raw'` and the trigger came from `/admin/transcribe-pending`, skip (idempotent).
3. Call `whisperClient.transcribe({ filePath, language: env.MNELA_TRANSCRIPTION_LANGUAGE })`.
4. In one `runInTx`: write `Document.rawText`, `Document.language`, `Document.metadata.transcription = { engine, model, durationSec, segments? }`, set `Document.status = 'parsed'`, run the existing chunker, persist `DocumentChunk` rows.
5. After commit: `publishEvent('document.transcribed', { jobId, documentId, language, durationSec })` AND `publishEvent('document.parsed', { jobId, documentId })` (so Phase 5+'s `setQueryData` listener and the Phase-4 live-graph wire format see the same shape they already understand).
6. Call shared `maybeEnqueueEnrichment(documentId)` (extracted from `ingestion.consumer.ts` to `apps/worker/src/shared/enrichment-enqueue.ts`). The `mnela:claude:status` gate decides — Dumb Mode keeps the document at `status='parsed'`, searchable via FTS per ADR-0014.

Worker imports `@mnela/queue` and registers `new Queue<TranscribeAudioJob>('transcription', ...)` next to its existing `ingestion`/`enrichment` queue handles. Concurrency 1 is enforced on the BullMQ `Worker` constructor.

**Alternatives:** (a) Reuse `ingestion` queue with a new job-name variant — couples concurrency to file-parse fan-out; whisper would spawn 4 concurrent jobs, swamp the container; (b) Reuse `enrichment` queue — forces a Claude availability check on a non-Claude job, drift from ADR-0029's invariant ("one signal per subsystem"); (c) Per-document direct HTTP call from `ingestion.consumer` (no queue) — no retry, no rate observation, no operator visibility in `/admin/jobs`; whisper outages would surface as ingest failures rather than recoverable retries.

**Status:** Accepted.

## ADR-0043 — Transcription owner: `apps/worker` extension, not orchestrator or a new app

**Context:** Phase 9 needs to put whisper.cpp HTTP calls somewhere. Three candidates: (a) worker — already owns ingestion follow-ups (parse → attachment → enqueue enrichment); (b) orchestrator — already owns "external AI availability" semantics (`mnela:claude:status`, slot-lock per ADR-0041, retry-with-backoff); (c) new `apps/transcriber` for clean separation. Whisper differs from Claude on three load-bearing axes: it is HTTP-only (no subprocess lifecycle), it has no rate-limit budget (just container memory), and it does not contend with Claude for any resource. The orchestrator's bespoke machinery (Claude binary discovery, stream-json frame parsing, BullMQ pause/resume on rate-limit windows) buys nothing for an HTTP call.

**Decision:** Worker owns transcription. New `apps/worker/src/transcription/` module: `transcription.module.ts`, `transcription.consumer.ts`, `whisper-status.boot.ts`, `whisper-status.service.ts`. Registered alongside the existing `ingestion` module in `apps/worker/src/worker.module.ts`. Worker is already a NestJS application context (per ADR-0016) — DI for Prisma, Redis, repositories, BullMQ workers is in place; adding one more consumer is free.

`mnela:whisper:status` lives in `packages/queue/src/whisper-status.ts` mirroring `claude-status.ts` exactly (same `read/write` helpers, same JSON shape, same "no TTL, last writer wins" semantics per ADR-0029). Boot probe runs `whisperClient.health()` on worker `OnModuleInit` when `env.MNELA_TRANSCRIPTION === 'enabled'`; otherwise writes `{ available: false, reason: 'not-enabled' }` and skips. Status is consumed by:

- `apps/worker/src/shared/enrichment-enqueue.ts` `maybeEnqueueTranscription(documentId)` — the enqueue gate.
- `apps/api/src/modules/system/whisper.service.ts` — `GET /system/whisper-status` route handler.
- (Future) `apps/web` setup wizard — surfaces "needs `--profile optional`" hint when `available === false && reason === 'not-enabled'`.

**Alternatives:** (a) `apps/orchestrator` — drags whisper into a module whose entire mental model is "single concurrent Claude subprocess with rate-limit." Adds shared state (`peekSlot()` would lie about whisper). Wrong place; (b) `apps/transcriber` — a whole NestJS app for a single consumer and a 30-line HTTP client. The repository already has six apps; the marginal cost of another deployment unit (Dockerfile, compose service, healthcheck, env, log channel) is real and the benefit is zero for single-tenant.

**Status:** Accepted.

## ADR-0042 — SSE transport: NestJS streamable response, explicit headers, server-side flush per frame

**Context:** Phase 8's `POST /search/ask` needs to stream tokens + citations + final result over a long-lived HTTP response. NestJS ships `@Sse()` which returns an `Observable<MessageEvent>` and assumes a `GET` route — Ask is `POST` (the user query goes in the body, can't fit in query string for non-trivial questions). The web client also can't use the native `EventSource` (which is GET-only — see Q33), so it uses `fetch` + `ReadableStream` parsing. Headers must defeat any intermediate buffering (Next.js `rewrites()`, Caddy reverse proxy in Phase 10) so the user sees tokens as they arrive, not in one final dump.
**Decision:** Replace the Phase-1 stub at `apps/api/src/modules/search/search.controller.ts` with a controller method that opts out of NestJS's auto-serialization via `@Res({ passthrough: false }) res: Response`, writes headers explicitly:

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

then iterates an async-iterator from `AskService.streamAsk(...)` and writes each frame as `event: <name>\ndata: <json>\n\n` + `res.flush?.()` (Express adds `.flush()` via compression middleware — call defensively, gate on `typeof res.flush === 'function'`). On client abort (`req.on('close')`), the iterator's abort signal cancels the Claude subprocess and a partial `Message` row is persisted with `metadata.aborted: true`.

Next.js `rewrites()` in `apps/web/next.config.ts` passes the stream through transparently — confirmed by recon (no Accept-Encoding stripping, no timeout). Caddy in Phase 10 requires `flush_interval -1` on the `/api/v1/search/ask` route — captured in Q28 + DEPLOYMENT.md (Phase 10).

`@Sse()` is **not** used because (a) it forces GET, (b) it wraps every payload in NestJS's `MessageEvent` envelope which adds an extra newline that some SSE clients dislike, (c) manual writes give us per-event `event:` names (`meta`, `token`, `citation`, `done`, `error`) which `@Sse()` defaults can swallow.
**Alternatives:** (a) `@Sse()` + GET with query-string question — fails for questions > ~2 KB; query-string history leaks the question to access logs; (b) WebSocket on `/live` — overkill for one-shot streams, doubles auth surface (already covered by ADR-0007 session cookie on same-origin), and breaks reconnection semantics that SSE has free; (c) chunked JSON-NDJSON over POST — works but requires custom client parser anyway and we lose named events (meta vs token vs citation).
**Status:** Accepted.

## ADR-0041 — Ask Brain shares the Claude rate-limit budget with enrichment via Redis slot lock

**Context:** Phase 5's orchestrator runs concurrency-1 enrichment subprocesses; Phase 8 introduces Ask Brain which spawns `runClaude` from `apps/api` directly (interactive, can't queue through BullMQ — ADR-0027 covers the _enrichment_ path, not interactive Q&A). Both subprocess paths share the same Claude Max account, so they share the same rate-limit footprint (~200 msg / 5h). Without coordination, an active enrichment burst can exhaust the budget mid-Ask, producing a mid-stream `error` SSE frame with `reason: 'rate-limit'`. Conversely, AskService grabbing the runner mid-enrichment could double-spend the budget within a single 5h window.
**Decision:** Introduce a Redis lock key `mnela:claude:slot` (new helper in `packages/queue/src/slot-lock.ts`: `acquireSlot(redis, owner: 'ask'|'enrichment', ttlSec)` / `releaseSlot(redis, owner)` / `peekSlot(redis)`). The value is `{ owner, acquiredAt, sessionId }` stored via `SET key value NX EX ttlSec` (atomic acquire); release is a Lua script (`if GET == value then DEL`) to avoid releasing someone else's lock. Sliding refresh via `SET XX EX ttlSec` for in-flight calls.

**Priority semantics:**

- **Ask is non-blocking:** AskService writes the slot key with `owner: 'ask'` _before_ spawning `runClaude` (TTL 180s, refreshed every 60s while streaming). On `done`/`error`/`abort` → releases.
- **Enrichment yields:** The orchestrator's `EnrichmentPipeline.run()` reads `peekSlot()` on each job pickup _in addition to_ `mnela:claude:status` (ADR-0029). If slot is held by `ask`, the job is _not_ moved to failed — it is re-queued with a 30s delay (`BullMQ moveToDelayed(now+30000)`) so the user's Ask gets the lane. Once Ask releases, the delayed job becomes runnable on the next tick.
- **No preemption of in-flight enrichment subprocess.** If enrichment is already spawning when Ask arrives, both run concurrently for the brief overlap. Q27 captures the reasoning (Claude Max allows concurrent CLI sessions; rate-limit is the shared constraint, not subprocess count). The slot lock prevents _new_ enrichment jobs from starting while Ask streams.

**Implementation surface:** `packages/queue/src/slot-lock.ts` (new file, exports the three helpers + a typed `SlotOwner` union). `apps/api/src/modules/search/ask.service.ts` acquires/releases around `runClaude`. `apps/orchestrator/src/enrichment/pipeline.ts` adds a `peekSlot()` check between the existing `claudeStatus.available` gate and the `runClaude` invocation.
**Alternatives:** (a) Single dedicated BullMQ `ask` queue with concurrency-1 — adds latency (interactive UX feels noticeably worse if the queue has pending jobs) and breaks the "user types question, stream starts in < 1s" goal; (b) Single shared queue for ask + enrichment with priority — same latency issue, plus BullMQ priority doesn't preempt in-flight; (c) Two independent budgets (Ask gets its own Claude account) — single-tenant single-user, no second account; doubles rate-limit cost; (d) Pessimistic mutex on the entire Claude subprocess — serializes Ask and enrichment unnecessarily; Claude Max can handle concurrent calls within the rate-limit envelope.
**Status:** Accepted.

## ADR-0040 — Citation wire format: `<cite doc-id="cuid">snippet</cite>` parsed by a streaming state machine

**Context:** Phase 8 Ask Brain must produce citations that the client can render _inline_ in the assistant's prose — clicking a citation jumps to `/documents/:id?highlight=<snippet>`. Three serialization options exist for Claude → server → client:

1. **Inline XML tags in the prose** — Claude emits `the user prefers <cite doc-id="cmd123">strict typing</cite> over loose duck typing`. Server parses tags out of the text-delta stream, strips them, replaces with numeric citation markers `[1]`, and emits a separate `event: citation` SSE frame with the metadata.
2. **JSON envelope around prose** — Claude returns a structured JSON object `{ prose, citations: [...] }`. Loses streaming UX (can't render until the whole envelope arrives) unless we add per-field stream parsing.
3. **Markdown footnote syntax `[^1]` + `[^1]: source` blocks at the end** — Streamable, but the footnote definitions only arrive after the prose, so the client has to defer chip rendering or rerender after stream-end; also requires markdown-footnote support in the renderer.

**Decision:** Option 1 — inline XML tags. Server parses the text-delta stream via a small state machine in `apps/api/src/modules/search/citation-parser.ts` (exported back to `packages/claude-runner` if reused elsewhere). The state machine is _not_ a regex over the whole buffer — it processes characters one at a time, tracks states `text | tag-open | attr-name | attr-value | inner | tag-close`, and survives `<cite ` being split across two `stream_event` frames. Snippet length capped per Q26 (model self-truncates to 120 chars; server defensively truncates to 200 in the SSE frame; full snippet preserved in `Message.citations` JSON).

**Wire frames emitted to client:**

- `event: token data: { delta: '...' }` — text-delta chunks with `<cite>` tags **stripped** and replaced by the literal `[N]` marker, where `N` is the ord assigned in citation-emission order.
- `event: citation data: { ord: 1, docId: 'cuid', snippet: '...', chunkId?: 'cuid' }` — emitted at the moment the parser closes a `<cite>` tag. Always emitted _after_ the `token` frame that contained the tag (so the client has the `[N]` marker in the buffer before the chip metadata arrives).

**Validation rules** (server-side):

- `doc-id` must be a syntactically valid cuid (`^c[a-z0-9]{24,}$`); invalid → tag dropped, `[N]` marker not emitted, server logs warning.
- `doc-id` must resolve to an existing Document (lookup against `DocumentRepository.findById`); not-found → same drop behavior, plus a `system` Message row is appended at conversation save with `role: 'system', contentMd: 'Filtered N invalid citations'` (auditable).
- Snippet must be non-empty after trim; empty → drop.
- Nested cites (`<cite ...><cite ...></cite></cite>`) → outer wins, inner content rendered literally minus tags. Logged as a warning.

**CLAUDE.md template change** (per task #8): explicit instruction `Wrap every claim that you ground in a source document in <cite doc-id="<the document's cuid>">verbatim snippet ≤120 chars</cite>. Do not cite the same document twice in adjacent sentences — group claims. Never invent doc-ids.`.

**Alternatives considered:** see Context. JSON envelope rejected because the streaming UX is non-negotiable per TZ §7.2 ("Streaming ответ через SSE"). Markdown footnotes rejected because footnote definitions land after the prose, breaking the streaming-chip UX.
**Status:** Accepted.

## ADR-0039 — Ask Brain conversation persistence: Postgres `Conversation` + `Message` models

**Context:** TZ §7.2 says "история диалогов" — Ask Brain shows a conversations sidebar and lets users reopen past sessions. Three storage options: (a) ephemeral Redis (TTL'd), (b) Postgres normalized (`Conversation` 1-to-many `Message`), (c) single Postgres row per conversation with a `messages: Json[]` column. Conversations are also used for the **save-as-synthesis** flow which references the final assistant message (so we need a stable id for it).
**Decision:** Postgres, normalized. Two new models:

```prisma
model Conversation {
  id                    String   @id @default(cuid())
  adminUserId           String
  title                 String
  synthesisDocumentId   String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  adminUser             AdminUser @relation(fields: [adminUserId], references: [id], onDelete: Cascade)
  synthesisDocument     Document? @relation(fields: [synthesisDocumentId], references: [id], onDelete: SetNull)
  messages              Message[]

  @@index([adminUserId, createdAt(sort: Desc)])
  @@index([adminUserId, updatedAt(sort: Desc)])
}

enum MessageRole {
  user
  assistant
  system
}

model Message {
  id              String       @id @default(cuid())
  conversationId  String
  role            MessageRole
  contentMd       String       @db.Text
  citations       Json         @default("[]")
  tokensIn        Int?
  tokensOut       Int?
  durationMs      Int?
  dumbMode        Boolean      @default(false)
  aborted         Boolean      @default(false)
  metadata        Json?
  createdAt       DateTime     @default(now())

  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}
```

Conversations are scoped to the single admin user (single-tenant — future multi-tenancy in Phase 10+ becomes a one-line FK swap). Title auto-generated from first user query (Q30). `synthesisDocumentId` set when the user clicks "Save as synthesis" — back-reference enables the conversation sidebar to show a "Saved as <doc title>" badge. `Message.citations` is `Json` (array of `{ord, docId, snippet, chunkId?, offsetStart, offsetEnd}`) — denormalized for read speed; we never query _by_ citation, only render.

REST surface (per task #5): no POST endpoint — Conversation is created lazily by the first `/search/ask` call without a `conversationId` in the body, returned in the `meta` SSE frame. PATCH for title rename, DELETE cascade-removes messages and clears `Conversation` row (`synthesisDocumentId` SetNull keeps the saved synthesis Document intact). Cascade on AdminUser deletion is moot in single-tenant but keeps the FK clean.

**Migrating data later:** if Phase 10 introduces multi-tenant or `TENANT_ID`, the column is added next to `adminUserId` with default backfill. Phase 8 doesn't pre-emptively add a tenant column (YAGNI).
**Alternatives:** (a) Redis ephemeral — TZ explicitly says "история диалогов" (long-term); user expectation matches ChatGPT/Claude.ai where conversations persist; (b) Single-row `messages: Json[]` — easier write, but slower partial reads (always load the whole thread to render the last N messages), and `Message.id` becomes synthetic so save-synthesis loses the FK; (c) Append-only event-log table with projections — over-engineered for a single-user single-tenant Q&A flow.
**Status:** Accepted.

---

## ADR-0038 — Keyboard shortcuts in /inbox: `react-hotkeys-hook` with scoped contexts

**Context:** Phase 7 wires j/k/a/r/e/V/Esc/⌘+Enter on `/inbox`. The page must distinguish "list focus" (j/k navigate) from "edit mode focus" (typing into a textarea — letters must reach the input, not trigger actions). Existing ⌘K palette uses raw `addEventListener` (`apps/web/src/components/global-cmdk.tsx:52-61`). Adding more raw listeners across the app risks double-handling and stale-closure bugs.
**Decision:** Install `react-hotkeys-hook` and use its `useHotkeys(key, handler, { enableOnFormTags, scopes })` API. Define two scopes for /inbox: `'inbox-list'` (j/k/a/r/e/V/Esc/⌘+Enter) and `'inbox-edit'` (only Esc/⌘+Enter, the rest fall through to the form). The EditInboxCard activates `inbox-edit` scope while open via `useHotkeysContext().enableScope('inbox-edit')` and disables `inbox-list`. ⌘K palette migrates to the same library on the same pass (scope `'global'`) so we have one keyboard system. A `KeyboardShortcutsOverlay` component (triggered by `?`) lists active shortcuts per scope — implemented as a Dialog rendering a static map.
**Alternatives:** (a) Raw `addEventListener` per page — works but every new shortcut surface re-implements scope handling; (b) `cmdk` alone — designed for palettes, not list-level navigation, and uses portal focus which would steal j/k; (c) `tinykeys` — smaller but no React scope abstraction, would need wrapper.
**Status:** Accepted.

## ADR-0037 — Search highlights: server-emitted `<mark>` via existing `ts_headline`, client-side DOMPurify-sanitize before render

**Context:** TZ §7.2 says "highlight matched text" on `/search` (and Phase 7 wants `/documents/:id` to mark the query terms when arrived from a search). The FTS + Hybrid SQL adapters (`packages/search/src/adapters/{fts,hybrid}.adapter.ts:39-40,49-50`) already select `ts_headline('russian', COALESCE(d."rawText", ''), q.tsq, 'MaxFragments=2,MinWords=8,MaxWords=20,StartSel=<mark>,StopSel=</mark>')` and feed it into `hit.snippet`. The web `SearchHit` type (`apps/web/src/lib/api/types.ts:157-165`) carries `snippet` but the renderer (`search-view.tsx:108-110`) prints it as plain text, dropping the `<mark>` tags. Two issues: (a) the marks never reach the DOM; (b) on `/documents/:id`, no headline exists yet because the detail view renders the full document body.
**Decision:** Server side is already correct — keep `ts_headline` as-is, with the existing `<mark>` start/stop sentinels. Web client renders `hit.snippet` via `dangerouslySetInnerHTML` after passing through `DOMPurify.sanitize(snippet, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] })` — install `isomorphic-dompurify` so the same path works in RSC. For `/documents/:id`, accept a `?highlight=<query>` search param; if present, render the body through a small client-side `highlightTerms(body, query)` utility that splits on case-insensitive token matches and wraps them in `<mark>`. No server round-trip needed for the detail view (the query is already in the user's URL from the search page navigation). The `<mark>` element gets a Tailwind class `bg-yellow-200/40 dark:bg-yellow-500/30 rounded-sm px-0.5` via a global CSS rule.
**Alternatives:** (a) Server-rendered highlights on `/documents/:id` via `ts_headline` against the full body — wastes bandwidth (we'd ship a snippet plus the full body), and stitching the fragments back into the rendered Markdown breaks the layout; (b) Pure client-side highlighting on `/search` (drop `ts_headline`, regex-mark the snippet client-side) — Postgres knows the FTS lexemes (stemming `гулять` → `гуля-` matches `гуляю`); naive client regex would miss morphology; (c) React component that walks the DOM tree and wraps text-node matches — overengineered for a snippet-sized payload.
**Status:** Accepted.

## ADR-0036 — Entity merge deduplicates edges by `(fromId, toId, relationType)`, keeps higher confidence

**Context:** `EntityRepository.merge(sourceId, targetId)` (`packages/db/src/repositories/entity.repository.ts:127-145`) repoints `Edge.fromId` and `Edge.toId` from source to target with bare `UPDATE`s. If both entities had an edge to the same neighbor with the same `relationType` — e.g. `source —related_to→ X` and `target —related_to→ X` — the post-merge state violates the `@@unique([fromId, toId, relationType])` constraint (schema line 441). Today the migration is best-effort and Phase 2 left this for Phase 7.
**Decision:** Wrap the merge in `prisma.runInTx` (per ADR-0008). Inside the tx: (1) collect every Edge touching `sourceId`; (2) for each, compute the post-repoint `(fromId', toId', relationType)` tuple; (3) detect collisions against existing edges on `targetId` with the same tuple; (4) for each collision, keep the row with higher `confidence` (tie-break: prefer `status='auto_confirmed'` > `'manual'` > `'needs_review'`; final tie: lower `id` lexicographically) and `delete()` the loser; (5) repoint the survivors. Self-loops produced by the repoint (`fromId === toId`) are deleted (a node can't relate to itself). All five steps run in the same tx as the `DocumentEntity` repoint and the `mergedIntoId` write, so a failure rolls everything back. A new endpoint contract `POST /graph/entities/merge { sourceId, targetId, dryRun?: boolean }`: when `dryRun: true`, the same transaction runs, returns `{ documentLinks: number, edgeRepoints: number, edgeDedupes: number, selfLoops: number }`, then **rolls back** (throws a sentinel error caught by the controller). The `EntityMergeDialog` in the web app uses this to render preview counts before the user confirms.
**Alternatives:** (a) Repoint with `ON CONFLICT DO NOTHING` and accept the losses — random which edge survives, loses high-confidence data; (b) Pre-compute the conflict set outside the tx and skip the offending edges — race condition with concurrent enrichment writes (single-tenant but the orchestrator + UI both write); (c) Keep the merge non-deduplicating and add a separate "compact" job — leaves the DB in a constraint-violating state between calls.
**Status:** Accepted.

## ADR-0035 — Inbox bulk accept/reject: per-item tx with partial-success report, one audit row per item

**Context:** Phase 7 introduces `POST /inbox/bulk/accept { ids: string[] }` and `…/bulk/reject { ids: string[] }`. The single-item endpoints (`POST /inbox/:id/{accept,reject,edit}`) already exist with `@Audit` decorators that wrap the handler in `prisma.runInTx` (ADR-0008). Two failure modes are possible in a batch: (1) the request hits five `link_suggestion`s and one is already `accepted` (stale UI), and (2) the `entity_merge_suggestion` payload references a `targetId` that was just deleted. A single big tx aborts all five if the sixth fails; a per-item loop survives the failure but produces five tx-commits.
**Decision:** Per-item processing. `POST /inbox/bulk/accept` iterates `ids`, calls the existing `InboxService.accept(id, actor)` once per id (which already opens its own `runInTx` via `@Audit`), catches per-item exceptions and aggregates into `{ accepted: Array<{ id: string }>, failed: Array<{ id: string; reason: string }> }`. Each accepted item produces one `AuditLog` row with `action='inbox.bulk_accept_item'` (so it's filterable apart from manual single-item accepts), `targetType='inbox_item'`, `targetId=id`, `metadata.batchId=<server-generated cuid>` (so all rows for one bulk call group together). The controller emits one `inbox.item_resolved` event per accepted item (web clients invalidate `['inbox']` once per event — debounced by TanStack Query on the client side via `staleTime`/`refetchOnWindowFocus`). HTTP response: `200 OK` if any succeed, `207 Multi-Status` if some fail, `422 Unprocessable Entity` if all fail (with `application/problem+json` body). Symmetric semantics for `bulk/reject`. Bulk merge is **not** in scope — `entity_merge_suggestion` items in a bulk-accept call execute one at a time and may fail individually with a `'merge-conflict'` reason.
**Alternatives:** (a) Single tx — fast and atomic audit, but UX-hostile for stale items in a typical 5–20 item batch; (b) Pre-validate all items, then commit — TOCTOU race during the gap; (c) Single audit row per batch — sacrifices per-id audit traceability that ADR-0008 explicitly preserves.
**Status:** Accepted.

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
