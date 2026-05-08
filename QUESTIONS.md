# Open Questions

Questions for the user that came up during implementation. Each gets answered, then archived to a "Resolved" section with the answer and the date.

---

## Open

### 2026-05-08 — Phase 4 assumptions worth flagging (not blockers)

| #   | Question                                                                                | Working assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 12  | "Resume" import — separate `/imports/:id/resume` endpoint, or alias of `/start`?        | UI button "Resume" calls existing `POST /imports/:id/start`. No new endpoint. If a user disagrees, add resume as a thin alias.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 13  | "Prioritize project" control on `/imports/:id` (TZ §7.2 mentions it)?                   | Deferred — not in PLAN.md Phase 4 acceptance, no concrete UX in TZ. Revisit in Phase 7 alongside Inbox bulk-actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 14  | Should `Document` appear as a graph node in Phase 4 without polluting the Entity table? | Hybrid. Project entities are persisted as real `Entity(type=project)` rows (upsert by normalized slug) and emitted via `graph.node_added`. Document nodes are emitted as **live-only synthetic nodes** with `entity.type='document'` and `entity.id=documentId` — payload shape only, no DB row. `Edge.fromId/toId` schema requires real Entity refs, so Document→Project edges are **also live-only synthetic** payloads (no Edge row). `/graph` REST endpoint thus only returns persisted Project entities for Phase 4. Phase 5 replaces synthetic document nodes with real Entity extraction. Frontend transform in `@mnela/ui` treats live-only and persisted nodes identically. |

---

## Resolved

### 2026-05-08 — Phase 4 wire format

| #   | Question                                                                    | Resolution                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | Should `document.created` / `document.parsed` event payloads carry `jobId`? | Yes. Extended `DocumentCreatedEvent`, `DocumentParsedEvent`, and `DocumentEnrichedEvent` payloads to include `jobId` in `packages/queue/src/events.ts`. Worker passes `dbJobId` through. Web socket cache sync now does in-place `setQueryData<LiveImportDocument[]>(['imports', jobId, 'documents'], …)` upsert instead of predicate-invalidate. |

### 2026-05-07 — Initial scope clarifications

| #   | Question                      | Resolution                                                                                                        |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Where does the repo live?     | `https://github.com/SmartDogg/mnela`                                                                              |
| 2   | License?                      | MIT                                                                                                               |
| 3   | Dev env?                      | Windows 11 for Phase 0; dedicated Linux VPS arrives by Phase 10                                                   |
| 4   | Test data?                    | Claude.ai export ZIP in repo dir; ChatGPT export not yet provided                                                 |
| 5   | UI design source?             | Use `frontend-design` skill / shadcn defaults; avoid generic AI aesthetic                                         |
| 6   | Library versions?             | Latest stable / current LTS, picked at install time                                                               |
| 7   | Tokenizer?                    | `gpt-tokenizer` (see ADR-0005)                                                                                    |
| 8   | Confidence scoring algorithm? | Emitted by Claude per CLAUDE.md rubric (see ADR-0004)                                                             |
| 9   | Let's Encrypt email?          | Not required — wizard will skip if user declines                                                                  |
| 10  | Upload size limits?           | Implementer's call — see ADR (TBD: documents 10MB / attachments 100MB / import ZIP 1GB are the proposed defaults) |
| 11  | i18n approach?                | next-intl with EN first + RU dictionaries (see ADR-0006)                                                          |

---

## How to use

When you hit something ambiguous in the TZ that isn't a hard blocker, write a question here, make a reasonable assumption to keep moving, and surface it to the user at the next natural checkpoint.

If it _is_ a hard blocker, stop and ask before proceeding.
