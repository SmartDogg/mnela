# Mnela — Personal Second Brain как MCP сервер

## Полное техническое задание для Claude Code

> **Инструкция для Claude Code (читай первым):** Это ТЗ для построения большого продукта. Перед началом ОБЯЗАТЕЛЬНО создай детальный план в `PLAN.md` с разбивкой на фазы и задачи. Используй subagents для параллельной работы над независимыми частями. Используй TodoWrite для трекинга. Каждая фаза должна заканчиваться рабочим состоянием — не оставляй проект в полусломанном виде. Если упираешься в архитектурное решение — задокументируй варианты в `DECISIONS.md` и спроси пользователя, не выбирай сам.

---

## 1. Идея и позиционирование

**Mnela** — открытая система персональной памяти, которая разворачивается одной командой на любом VPS и становится MCP-сервером для подключения к Claude Code, ChatGPT (через клиенты с MCP), Cursor и любому другому AI-инструменту.

**Слоган:** «Ваш второй мозг становится MCP в один клик»

**Целевая аудитория:**

- Разработчики и technical knowledge workers с тысячами AI-чатов и проектов
- Бизнес — для поиска по корпоративным документам
- Обычные люди — порядок в личном хаосе

**Ключевые отличия от существующих решений:**

- Self-hosted, single-tenant, как 3x-UI (один сервер = один пользователь)
- Не требует API-ключей AI-провайдеров (использует подписку Claude Max через Claude Code на сервере)
- Markdown-совместимая (генерирует vault для Obsidian read-only viewing)
- Полнофункциональный Web UI с первого дня
- MCP-first архитектура — главный интерфейс это MCP, а не proprietary API

**Принципы:**

1. **Markdown — для человека, PostgreSQL — для системы.** Источник истины — БД, markdown vault генерируется как экспорт.
2. **Никаких внешних AI API.** Mnela сама не использует никаких сторонних LLM сервисов. Вся «умная» обработка делается через Claude Code subprocess на сервере (использует подписку пользователя).
3. **Работает на $5 VPS.** 1GB RAM, 1 CPU, 20GB SSD достаточно. Тяжёлые модули (whisper, embedding) — опциональные.
4. **Деградация в Dumb Mode.** Если Claude Code не установлен или не залогинен — работает как умный Obsidian-replacement с FTS поиском без обогащения.
5. **Live progress.** Импорт показывается «в прямом эфире» с растущим графом, очередью, ETA.
6. **Идемпотентность.** Повторный импорт того же файла не дублирует (content_hash).
7. **Confidence-based linking.** Связи имеют статус (auto/needs_review/manual/rejected). Низкая confidence не пишется молча — идёт в Inbox для review.
8. **Open-source ready.** Архитектура такая, что в будущем можно сделать публичным без переделки. **Но в первой версии не оптимизируем под open-source** (не делаем landing-page, contributor docs, multi-language UI). Только под одного пользователя — автора.

---

## 2. Стек технологий (зафиксировано)

### Backend

- **Node.js 20+ LTS** (TypeScript)
- **NestJS 10+** для API, MCP сервера, worker'а
- **Prisma ORM** для работы с Postgres
- **BullMQ** для очередей задач (Redis backend)
- **Pino** для логирования (structured JSON)

### Frontend

- **Next.js 15+** (App Router, RSC)
- **TailwindCSS** + **shadcn/ui** для компонентов
- **Cytoscape.js** для графа
- **TanStack Query** для server state
- **Zustand** для client state
- **Socket.io-client** для real-time updates

### Storage

- **PostgreSQL 16+** с расширениями:
  - `pg_trgm` (нечёткий поиск)
  - `pgvector` (зарезервировано для будущего, не используется в MVP)
  - `unaccent` (нормализация текста)
- **Redis 7+** для очередей и кеша
- **Файловая система** для attachments и vault

### MCP сервер

- **@modelcontextprotocol/sdk** (официальный TS SDK)
- **HTTP transport** для удалённого подключения
- **stdio transport** для локального Claude Code на сервере

### Reverse proxy

- **Caddy 2+** (auto HTTPS, простой конфиг)

### Опциональные модули (env-флаги, не в дефолте)

- **whisper.cpp** — транскрипция голоса
- **Cloudflare Tunnel** — для серверов без публичного IP

### Claude Code

- Устанавливается на сервер
- `claude login` через interactive flow
- Запускается как subprocess через `claude -p ... --add-dir ... --mcp-config ...`

---

## 3. Архитектура

### 3.1 Структура контейнеров (docker-compose)

```yaml
services:
  postgres: # БД
  redis: # Очереди и pub/sub
  api: # REST API + WebSocket gateway
  mcp: # MCP сервер (HTTP transport)
  web: # Next.js Web UI
  worker: # BullMQ воркеры
  orchestrator: # Сервис управляющий Claude Code subprocesses
  caddy: # Reverse proxy + HTTPS

  # Опциональные (поднимаются через profile)
  whisper: # whisper.cpp HTTP API
  cloudflared: # Cloudflare Tunnel
```

### 3.2 Структура монорепо

```
mnela/
├── apps/
│   ├── api/                    # NestJS REST API + WS gateway
│   ├── mcp/                    # NestJS MCP server
│   ├── web/                    # Next.js Web UI
│   ├── worker/                 # NestJS BullMQ workers
│   ├── orchestrator/           # NestJS Claude Code orchestrator
│   └── cli/                    # Mnela CLI (для админских команд)
├── packages/
│   ├── core/                   # Domain models, DTOs, schemas (Zod)
│   ├── db/                     # Prisma schema + migrations + repositories
│   ├── ingestion/              # Парсеры: chatgpt, claude, docx, pdf, image
│   ├── search/                 # FTS, trigram, hybrid search adapters
│   ├── graph/                  # Entity/edge management, Cytoscape data builders
│   ├── claude-runner/          # Обёртка над Claude Code CLI
│   ├── mcp-tools/              # Определения MCP tools (используются в apps/mcp)
│   ├── shared-types/           # TypeScript types общие для backend и frontend
│   └── ui/                     # Shared React components (shadcn)
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml
│   │   ├── docker-compose.optional.yml  # whisper, etc
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.mcp
│   │   ├── Dockerfile.worker
│   │   ├── Dockerfile.orchestrator
│   │   └── Dockerfile.whisper
│   ├── caddy/
│   │   └── Caddyfile.template
│   └── claude/
│       ├── CLAUDE.md.template          # Глобальный промпт для серверного Claude Code
│       └── claude-mcp-config.json      # MCP конфиг для серверного Claude Code
├── scripts/
│   ├── install.sh                      # bash <(curl -Ls ...) entrypoint
│   ├── setup-wizard.sh
│   ├── update.sh
│   ├── backup.sh
│   └── restore.sh
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── MCP_INTEGRATION.md
│   ├── EXPORT_GUIDES/
│   │   ├── chatgpt.md
│   │   ├── claude.md
│   │   ├── notion.md
│   │   └── obsidian.md
│   └── TROUBLESHOOTING.md
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── PLAN.md                              # создаёт Claude Code в начале работы
```

### 3.3 Поток данных при ingestion

```
Источник (upload/API/folder watch)
   │
   ▼
[1] API принимает файл/payload
   │   ├── Считает content_hash
   │   ├── Проверяет дубликаты по hash
   │   └── Сохраняет raw в attachments/, метадату в БД (status=raw)
   │
   ▼
[2] Worker подхватывает из очереди ingestion-pipeline
   │   ├── Распознаёт тип (chatgpt-export / claude-export / docx / image / md / txt)
   │   ├── Парсит в Document records (один файл может породить много docs — например chat = много sub-conversations)
   │   ├── Извлекает текст
   │   ├── Чанкует (700-1200 токенов, overlap 100-150)
   │   └── Обновляет статус → 'parsed'
   │
   ▼
[3] FTS index sync (синхронно, очень быстро)
   │   └── Документы становятся доступны для поиска
   │
   ▼ (живой UI обновляется через WebSocket после каждого шага)
   │
[4] Orchestrator решает: есть Claude Code? rate limit OK?
   │   ├── ДА → ставит задачу 'enrich' в очередь Claude
   │   └── НЕТ → status='raw_indexed', можно искать через FTS, но без обогащения
   │
   ▼
[5] Claude Code worker (один subprocess за раз, rate-limited)
   │   ├── Читает документ через MCP tool 'mnela.get_document'
   │   ├── Извлекает: summary, entities, projects, decisions, ideas, tasks
   │   ├── Ищет похожие документы через MCP tool 'mnela.find_similar'
   │   ├── Предлагает links с confidence score
   │   └── Записывает обратно через MCP tools 'mnela.add_entities', 'mnela.add_links'
   │
   ▼
[6] Confidence routing
   │   ├── confidence > 0.8 → auto_confirmed, в граф
   │   ├── 0.5 < confidence <= 0.8 → needs_review, в Inbox
   │   └── confidence <= 0.5 → отбрасывается (логируется)
   │
   ▼
[7] WebSocket emit — UI получает event → анимация на графе
```

### 3.4 Структура Claude Code на сервере

**Установка:** часть `install.sh`. Если пользователь пропустил — Mnela работает в Dumb Mode.

**Конфигурация:**

- `~/.claude/CLAUDE.md` (на сервере) — глобальные инструкции (см. infra/claude/CLAUDE.md.template)
- `/etc/mnela/claude-mcp-config.json` — MCP конфиг для серверного Claude
- Подключённые MCP servers:
  - `mnela` (stdio, локальный) — наш сервер
  - `filesystem` (stdio, ограничен `/var/lib/mnela/vault`)

**Запуск:**

```bash
claude -p "<task-specific-prompt>" \
  --add-dir /var/lib/mnela/vault \
  --mcp-config /etc/mnela/claude-mcp-config.json \
  --output-format json \
  --dangerously-skip-permissions  # в контролируемом окружении ОК
```

**Orchestrator service (apps/orchestrator):**

- Запускает `claude` subprocesses
- Управляет concurrency (1 одновременный по умолчанию)
- Rate limiting (X задач/час, настраивается)
- Перехватывает stdout/stderr, парсит JSON output
- Retry с exponential backoff при ошибках
- Если упёрся в rate limit подписки — ставит задачу на паузу до следующего окна

---

## 4. Схема БД (Prisma)

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// === Источники и сырые данные ===

enum SourceType {
  chatgpt_export
  claude_export
  obsidian_vault
  manual_upload
  api_ingest
  telegram        // через будущий бот
  voice_note
  email           // на будущее
  web_clip        // на будущее
}

enum DocumentStatus {
  raw             // только что создан, ещё не парсили
  parsed          // распарсен, FTS-доступен
  enriching       // Claude Code в процессе обработки
  enriched        // обработан (entities извлечены, links созданы)
  failed
  archived
}

model Document {
  id           String         @id @default(cuid())

  // Источник
  source       SourceType
  sourceId     String?        // ID в исходной системе (chat_id chatgpt и т.д.)

  // Контент
  title        String
  rawText      String         @db.Text
  cleanText    String?        @db.Text  // нормализованный
  contentHash  String         @unique   // sha256 для дедупликации
  tokenCount   Int?

  // Метаданные
  language     String?        // ru, en, mixed
  type         String?        // chat, doc, decision, daily, idea, code, image
  metadata     Json?

  // Жизненный цикл
  status       DocumentStatus @default(raw)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  ingestedAt   DateTime       @default(now())
  enrichedAt   DateTime?
  archivedAt   DateTime?

  // Связи с другими таблицами
  chunks            DocumentChunk[]
  attachments       Attachment[]
  documentEntities  DocumentEntity[]
  documentProjects  DocumentProject[]
  edgesAsEvidence   Edge[]            @relation("EdgeEvidence")
  decisions         Decision[]

  // Markdown export
  vaultPath    String?        // относительный путь в /vault

  @@index([source, sourceId])
  @@index([status])
  @@index([type])
  @@index([createdAt])
  // FTS индекс создаётся миграцией: tsvector(rawText) с весами
}

model DocumentChunk {
  id           String   @id @default(cuid())
  documentId   String
  chunkIndex   Int
  text         String   @db.Text
  tokenCount   Int
  metadata     Json?

  // Зарезервировано для будущего векторного поиска
  // embedding    Unsupported("vector(1024)")?

  document     Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, chunkIndex])
}

model Attachment {
  id           String   @id @default(cuid())
  documentId   String?
  filename     String
  mimeType     String
  size         Int
  path         String   // путь в /var/lib/mnela/attachments/
  contentHash  String
  metadata     Json?    // ширина/высота для картинок, дата съёмки и т.д.
  ocrText      String?  @db.Text  // если применимо
  description  String?  @db.Text  // от Claude Code, если был задействован

  createdAt    DateTime @default(now())

  document     Document? @relation(fields: [documentId], references: [id], onDelete: SetNull)

  @@index([contentHash])
}

// === Граф знаний ===

enum EntityType {
  project
  person
  organization
  technology
  concept
  product
  service
  bug
  feature
  custom
}

model Entity {
  id           String      @id @default(cuid())
  name         String
  normalizedName String    // lowercase, без пробелов — для merge
  type         EntityType
  description  String?     @db.Text
  aliases      String[]    // массив альтернативных имён
  metadata     Json?

  // Soft merge: можно объединить duplicates
  mergedIntoId String?
  mergedInto   Entity?     @relation("EntityMerge", fields: [mergedIntoId], references: [id])
  mergedFrom   Entity[]    @relation("EntityMerge")

  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  documentEntities  DocumentEntity[]
  edgesFrom         Edge[]            @relation("EdgeFrom")
  edgesTo           Edge[]            @relation("EdgeTo")

  @@unique([normalizedName, type])
  @@index([type])
}

enum LinkStatus {
  auto_confirmed   // confidence > 0.8
  needs_review     // 0.5 < confidence <= 0.8
  manual           // создано пользователем
  rejected         // отклонено
}

model Edge {
  id           String      @id @default(cuid())
  fromId       String
  toId         String
  relationType String      // "related_to", "depends_on", "competes_with", и т.д.
  confidence   Float       @default(1.0)
  status       LinkStatus  @default(auto_confirmed)

  // Откуда взялась связь
  evidenceDocumentId String?
  evidenceChunkId    String?

  // Темпоральная информация (на будущее, простая версия Graphiti-like)
  validFrom    DateTime    @default(now())
  validUntil   DateTime?   // если связь устарела
  invalidatedById String?  // ID документа который опроверг

  createdAt    DateTime    @default(now())
  reviewedAt   DateTime?
  reviewedBy   String?     // 'user' | 'claude' | 'system'

  from         Entity      @relation("EdgeFrom", fields: [fromId], references: [id], onDelete: Cascade)
  to           Entity      @relation("EdgeTo", fields: [toId], references: [id], onDelete: Cascade)
  evidenceDoc  Document?   @relation("EdgeEvidence", fields: [evidenceDocumentId], references: [id], onDelete: SetNull)

  @@unique([fromId, toId, relationType])
  @@index([status])
}

model DocumentEntity {
  documentId   String
  entityId     String
  mentions     Int      @default(1)
  context      String?  @db.Text

  document     Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  entity       Entity   @relation(fields: [entityId], references: [id], onDelete: Cascade)

  @@id([documentId, entityId])
}

// === Проекты, решения, дневник ===

model Project {
  id           String     @id @default(cuid())
  slug         String     @unique
  name         String
  description  String?    @db.Text
  status       String     @default("active")  // active, paused, archived
  contextMd    String?    @db.Text  // живой README, обновляется Claude Code

  metadata     Json?

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  documents    DocumentProject[]
  decisions    Decision[]
}

model DocumentProject {
  documentId   String
  projectId    String

  document     Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([documentId, projectId])
}

model Decision {
  id           String   @id @default(cuid())
  projectId    String?
  title        String
  decision     String   @db.Text
  context      String?  @db.Text
  consequences String?  @db.Text
  status       String   @default("active")  // active, superseded, reverted
  supersededById String?

  sourceDocumentId String?

  decidedAt    DateTime @default(now())
  createdAt    DateTime @default(now())

  project      Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)
  sourceDoc    Document? @relation(fields: [sourceDocumentId], references: [id], onDelete: SetNull)

  @@index([projectId, decidedAt])
}

model DailyNote {
  id           String   @id @default(cuid())
  date         DateTime @unique @db.Date
  contentMd    String   @db.Text
  mood         String?
  metadata     Json?

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

// === Inbox (review queue) ===

enum InboxItemType {
  link_suggestion
  entity_merge_suggestion
  duplicate_detection
  enrichment_failed
  conflicting_decision
}

model InboxItem {
  id           String        @id @default(cuid())
  type         InboxItemType
  title        String
  description  String        @db.Text
  payload      Json          // данные для применения если accept

  // Связи на сущности
  documentId   String?
  edgeId       String?
  entityId     String?

  status       String        @default("pending")  // pending, accepted, rejected
  resolvedAt   DateTime?
  resolvedBy   String?

  createdAt    DateTime      @default(now())

  @@index([status, createdAt])
}

// === Задачи и job queue ===

enum JobType {
  ingest_file
  parse_document
  enrich_document
  refresh_project_context
  rebuild_index
  export_vault
}

enum JobStatus {
  queued
  running
  paused
  completed
  failed
  cancelled
}

model Job {
  id           String    @id @default(cuid())
  type         JobType
  status       JobStatus @default(queued)
  priority     Int       @default(50)

  payload      Json
  result       Json?
  error        String?   @db.Text

  // Связи
  documentId   String?

  attempts     Int       @default(0)
  maxAttempts  Int       @default(3)

  createdAt    DateTime  @default(now())
  startedAt    DateTime?
  completedAt  DateTime?

  // Rate limit metadata
  costEstimate Int?      // примерное число LLM вызовов / токенов

  @@index([status, priority, createdAt])
  @@index([documentId])
}

// === Audit log ===

model AuditLog {
  id           String   @id @default(cuid())
  action       String   // 'create_entity', 'update_edge', 'reject_inbox', etc
  actor        String   // 'user', 'claude', 'system'
  targetType   String   // 'entity', 'edge', 'document', 'inbox_item'
  targetId     String
  before       Json?
  after        Json?
  metadata     Json?

  createdAt    DateTime @default(now())

  @@index([targetType, targetId])
  @@index([createdAt])
}

// === Системные таблицы ===

model SystemConfig {
  key          String   @id
  value        Json
  updatedAt    DateTime @updatedAt
}

model AuthToken {
  id           String    @id @default(cuid())
  name         String
  tokenHash    String    @unique
  scope        String    // 'admin', 'mcp', 'api'

  lastUsedAt   DateTime?
  expiresAt    DateTime?
  createdAt    DateTime  @default(now())
  revokedAt    DateTime?
}

model AdminUser {
  id           String    @id @default(cuid())
  username     String    @unique
  passwordHash String

  createdAt    DateTime  @default(now())
  lastLoginAt  DateTime?
}
```

**FTS migration (raw SQL после prisma migrate):**

```sql
-- Postgres FTS с русским словарём
ALTER TABLE "Document"
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce("rawText", '')), 'B')
  ) STORED;

CREATE INDEX document_search_idx ON "Document" USING GIN(search_vector);

-- Trigram для нечёткого поиска
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX document_title_trgm_idx ON "Document" USING GIN(title gin_trgm_ops);

-- pgvector reserved (для будущего)
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## 5. MCP Tools (полный список)

Все tools реализуются в `packages/mcp-tools` и подключаются в `apps/mcp`.

### Read tools

```typescript
// Поиск
mnela_search({
  query: string,
  filters?: {
    projects?: string[],
    types?: string[],
    sources?: SourceType[],
    dateFrom?: string,
    dateTo?: string,
    languages?: string[],
  },
  limit?: number  // default 20
}) -> { documents: DocumentSummary[], totalCount: number }

mnela_get_document({ id: string }) -> Document
mnela_get_chunks({ documentId: string }) -> Chunk[]

// Проекты
mnela_list_projects() -> Project[]
mnela_get_project_context({ slug: string }) -> {
  project: Project,
  recentDocuments: DocumentSummary[],
  decisions: Decision[],
  entities: Entity[],
  openQuestions: string[],
}

// Решения
mnela_get_decisions({ projectSlug?: string, limit?: number }) -> Decision[]

// Граф
mnela_find_similar({ text: string, limit?: number }) -> DocumentSummary[]
mnela_get_entity({ name: string, type?: EntityType }) -> Entity & {
  documents: DocumentSummary[],
  edges: Edge[]
}
mnela_traverse_graph({
  fromEntity: string,
  maxDepth?: number,
  relationTypes?: string[]
}) -> { nodes: Entity[], edges: Edge[] }

// Дневник
mnela_get_daily_note({ date: string }) -> DailyNote | null
mnela_recent_activity({ days?: number }) -> {
  documents: DocumentSummary[],
  decisions: Decision[],
  notes: DailyNote[]
}
```

### Write tools

```typescript
mnela_save_note({
  content: string,
  type?: string,
  source?: SourceType,
  projects?: string[],
  metadata?: Record<string, any>
}) -> { documentId: string }

mnela_save_decision({
  projectSlug: string,
  title: string,
  decision: string,
  context?: string,
  consequences?: string,
  sourceDocumentId?: string
}) -> { decisionId: string }

mnela_add_entities({
  documentId: string,
  entities: Array<{
    name: string,
    type: EntityType,
    aliases?: string[],
    confidence: number
  }>
}) -> { added: Entity[], merged: Entity[] }

mnela_add_links({
  links: Array<{
    fromEntity: { name: string, type: EntityType },
    toEntity: { name: string, type: EntityType },
    relationType: string,
    confidence: number,
    evidenceDocumentId?: string
  }>
}) -> { added: Edge[], queuedForReview: Edge[] }

mnela_update_project_context({
  slug: string,
  contextMd: string
}) -> { project: Project }

mnela_archive_document({ id: string }) -> { ok: true }
```

### Admin tools (только с admin scope)

```typescript
mnela_trigger_enrichment({ documentId: string }) -> { jobId: string }
mnela_rebuild_index() -> { jobId: string }
mnela_export_vault({ destinationPath?: string }) -> { exportPath: string }
```

### Авторизация

Каждый MCP tool вызов проверяет Bearer token из Authorization header:

- `admin` scope — все tools
- `mcp` scope — read + write (default scope для подключения Claude Code)
- `read_only` scope — только read

---

## 6. REST API (для Web UI и внешних клиентов)

База URL: `https://mnela.example.com/api/v1`

### Auth

```
POST   /auth/login                  { username, password } -> { sessionCookie }
POST   /auth/logout
GET    /auth/me
POST   /auth/tokens                 создать API token { name, scope } -> { token } (показывается ОДИН раз)
GET    /auth/tokens
DELETE /auth/tokens/:id
```

### Documents

```
GET    /documents                   ?status&source&project&type&q&page&limit
GET    /documents/:id
POST   /documents/upload            multipart, любые файлы
DELETE /documents/:id
PATCH  /documents/:id                { type?, projects?, archived? }
POST   /documents/:id/reenrich
GET    /documents/:id/chunks
GET    /documents/:id/related
```

### Search

```
POST   /search                       { query, filters, mode: 'fts'|'fuzzy'|'hybrid' }
POST   /search/ask                   { question, context? } -> SSE stream от Claude Code (если есть)
```

### Graph

```
GET    /graph                        ?center&depth&types -> { nodes, edges } для Cytoscape
GET    /graph/entities               ?q&type
GET    /graph/entities/:id
PATCH  /graph/entities/:id
POST   /graph/entities/merge         { sourceId, targetId }
GET    /graph/edges
PATCH  /graph/edges/:id              { status, relationType }
DELETE /graph/edges/:id
```

### Projects

```
GET    /projects
POST   /projects                     { slug, name, description }
GET    /projects/:slug
PATCH  /projects/:slug
DELETE /projects/:slug
GET    /projects/:slug/context
POST   /projects/:slug/refresh-context  → job
```

### Decisions

```
GET    /decisions                    ?projectSlug&page
POST   /decisions
GET    /decisions/:id
PATCH  /decisions/:id
```

### Daily

```
GET    /daily                        ?from&to
GET    /daily/:date
PUT    /daily/:date
```

### Inbox

```
GET    /inbox                        ?type&status
POST   /inbox/:id/accept
POST   /inbox/:id/reject
POST   /inbox/:id/edit               { changes } -> модифицирует payload и accept
```

### Jobs (live progress)

```
GET    /jobs                         ?status&type
GET    /jobs/:id
POST   /jobs/:id/cancel
POST   /jobs/:id/retry
GET    /jobs/stats                   агрегаты: queued, running, completed today, etc
```

### Imports (multi-step process)

```
POST   /imports                      загрузить ZIP (chatgpt/claude export)
GET    /imports
GET    /imports/:id                  статус с прогрессом
POST   /imports/:id/start            запустить ingestion
POST   /imports/:id/pause
POST   /imports/:id/cancel
```

### System

```
GET    /system/health
GET    /system/stats                 кол-во docs, entities, edges, размер БД
GET    /system/config
PATCH  /system/config                { key: value }
GET    /system/claude-status         logged in? rate limit window?
POST   /system/claude-test           проверка работоспособности Claude Code
```

### WebSocket events (Socket.io namespace `/live`)

```typescript
// Events FROM server
'job.created'      { jobId, type, payload }
'job.started'      { jobId, type }
'job.progress'     { jobId, progress: 0-100, message }
'job.completed'    { jobId, result }
'job.failed'       { jobId, error }

'document.created' { documentId, status }
'document.parsed'  { documentId }
'document.enriched' { documentId, addedEntities, addedEdges }

'graph.node_added' { entity }
'graph.edge_added' { edge }
'graph.node_updated' { entityId, changes }

'inbox.item_added' { item }

'system.claude_status_changed' { available, reason }
```

---

## 7. Web UI — детальные требования

### 7.1 Структура страниц

```
/login                      форма логина
/setup                       wizard первой настройки
/                            Dashboard
/search                      Поиск
/ask                         Ask Brain (chat-style диалог с твоей базой через серверный Claude)
/documents                   Список + фильтры
/documents/:id               Просмотр документа
/projects                    Список проектов
/projects/:slug              Страница проекта
/projects/:slug/edit
/decisions                   Журнал решений
/daily                       Дневник
/daily/:date                 Конкретный день
/graph                       Полный граф
/inbox                       Очередь review
/imports                     Импорты
/imports/new                 Новый импорт
/imports/:id                 Live-прогресс
/jobs                        Очередь задач (admin)
/admin/system                Системные настройки
/admin/tokens                API tokens
/admin/claude                Claude Code status & config
/admin/backup                Backup/restore
```

### 7.2 Главные UX-фичи

**Глобальный поиск (⌘K / Ctrl+K)** — открывает overlay, instant search через FTS + fuzzy. Результаты с highlight matched текста, фильтры, навигация стрелками.

**Live Ingestion View** (`/imports/:id`):

- Progress bar с обработано/всего/skipped/failed
- ETA на основе текущего rate
- Splitscreen:
  - Слева: список файлов с цветовой индикацией статуса (raw/parsed/enriched/failed). Клик открывает документ в модалке.
  - Справа: **граф растёт в реальном времени**. Cytoscape с force-directed layout. Новые ноды прилетают с fadeIn анимацией, рёбра появляются с пульсацией. Можно панорамировать и зумить.
- Логи внизу (tail последних 50 действий, auto-scroll)
- Управление: Pause / Resume / Cancel / Prioritize project (если выбрать ноду — задачи связанные с этой сущностью повышают приоритет)

**Graph View** (`/graph`):

- Cytoscape.js с force-directed layout
- Сайдбар с фильтрами: типы entity, типы relations, projects, дата
- Клик на ноду → панель с заметками этой сущности
- Hover на edge → tooltip с evidence (документ-источник)
- Поиск ноды (zoom-in animation)
- Toggle: показывать только confirmed / включая needs_review
- Min-map в углу
- Layout switcher: force / circular / hierarchical / cose-bilkent

**Inbox**:

- Карточки suggestions с предпросмотром изменений (diff-style: «было / станет»)
- Один клик: Accept / Reject / Edit
- Bulk actions
- Фильтры по типу

**Ask Brain**:

- Chat-style интерфейс
- Каждое сообщение пользователя триггерит Claude Code subprocess на сервере
- Streaming ответ через SSE
- Каждое утверждение в ответе с inline citation на конкретный документ (клик открывает в боковой панели)
- Кнопка «сохранить вывод как заметку» → создаёт документ типа `synthesis`
- Если Claude Code не доступен — показывает «AI Smart Mode disabled» и режим работает только как FTS поиск

**Daily View**:

- Calendar widget сверху
- Текущий день: markdown editor (отдельный для основного контента, отдельный для mood)
- Под ним: автоматически сгенерированный summary дня (что было создано, какие решения, какие чаты)
- Клик на день в календаре → переход

**Project Page**:

- Tab: Overview (auto-generated context.md, можно править)
- Tab: Documents (фильтрованный список)
- Tab: Decisions (timeline)
- Tab: Entities (мини-граф проекта)
- Tab: Open Questions (TODO список из заметок)
- Кнопка «Refresh context» — запускает Claude Code для re-генерации context.md

### 7.3 Setup Wizard (`/setup`)

Проходится один раз после установки:

1. **Создание admin** — username + password (12+ символов, validation strength)
2. **Базовая конфигурация** — название мозга (используется в title), таймзона, язык интерфейса (RU/EN)
3. **Claude Code** — три варианта:
   - «У меня есть Claude Max — настроить сейчас» → инструкция как запустить `claude login` на сервере + verify
   - «Настрою позже» → Dumb Mode
   - «У меня нет подписки» → Dumb Mode forever (можно объяснить ограничения)
4. **Опциональные модули** — чекбоксы:
   - Voice transcription (whisper) — поднимет дополнительный контейнер
   - Future: embeddings — пока скрыт
5. **Импорт первых данных** — drag-and-drop ZIP экспортов или skip
6. **API Token** — генерируется первый MCP token, показывается команда для подключения Claude Code на ноутбуке. Кнопка «скопировать»

### 7.4 Дизайн-направление

- **Тёмная тема по умолчанию** (для разработчиков), light как опция
- **Чёткая иерархия**: левая навигация, центр — контент, правая панель — контекст
- **Минимум лишнего**: shadcn/ui дефолтные стили, без overdesign
- **Информационная плотность как у Linear/Plane**, не как у Notion (target — техническая аудитория)
- **Анимации только функциональные** (fadeIn новых нод в графе, transition между tabs, skeleton при загрузке)

---

## 8. Установка одной командой

### 8.1 Поток `install.sh`

```bash
bash <(curl -Ls https://get.mnela.io/install)
# Альтернатива: bash <(curl -Ls https://raw.githubusercontent.com/<owner>/mnela/main/scripts/install.sh)
```

Скрипт:

1. **Проверки:**
   - root или sudo
   - Linux (Ubuntu, Debian, CentOS, Alpine)
   - 1+ GB RAM, 10+ GB free disk
   - открытые порты 80, 443 (если используется домен)
2. **Установка зависимостей:**
   - Docker (через `get.docker.com`)
   - Docker Compose plugin
   - curl, jq, git
3. **Clone:**
   - `git clone https://github.com/<owner>/mnela /opt/mnela`
4. **Конфигурация (interactive):**
   - Спрашивает: домен или IP?
   - Если домен — Caddy auto-HTTPS с Let's Encrypt
   - Если IP — self-signed сертификат с warning
   - Опция: использовать Cloudflare Tunnel (нет домена + не хочется открывать порты)
5. **Генерация secrets:**
   - `POSTGRES_PASSWORD`
   - `REDIS_PASSWORD`
   - `JWT_SECRET`
   - `ADMIN_INITIAL_TOKEN` (одноразовый, для wizard)
   - Сохраняются в `/etc/mnela/.env` (chmod 600)
6. **docker compose pull && up -d**
7. **Health check** — ждёт пока api/web/postgres станут healthy
8. **Output:**

   ```
   ✓ Mnela установлена

   Web UI:    https://mnela.example.com
   Setup:     https://mnela.example.com/setup?token=<initial>

   Сохрани этот токен — он понадобится один раз для первой настройки.
   После завершения wizard токен будет инвалидирован.
   ```

### 8.2 Поток обновления

```bash
mnela update
# или
cd /opt/mnela && ./scripts/update.sh
```

- `git pull`
- `docker compose pull`
- `docker compose run --rm api npm run migrate:deploy`
- `docker compose up -d`

### 8.3 Bare-metal без Docker (опционально)

Поддерживаем, но это документируется отдельно для продвинутых. В MVP — только Docker.

---

## 9. Импорт данных

### 9.1 Поддерживаемые форматы

| Формат                                                   | Парсер                                                                              | Особенности                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ChatGPT export ZIP (`conversations.json`)                | `packages/ingestion/chatgpt.ts`                                                     | Распаковывает все диалоги, по одному документу на conversation, frontmatter с moduel, ChatGPT version |
| Claude.ai export ZIP                                     | `packages/ingestion/claude.ts`                                                      | Аналогично, отдельная обработка для Projects                                                          |
| Claude Code session JSONL (`~/.claude/projects/*.jsonl`) | `packages/ingestion/claude-code-session.ts`                                         | Парсит свои локальные сессии Claude Code                                                              |
| `.docx`, `.doc`                                          | `mammoth`                                                                           | text + сохранение базовой структуры                                                                   |
| `.pdf`                                                   | `pdf-parse` + опционально OCR через Claude (если включён)                           | text extraction; для scanned — Claude vision                                                          |
| `.md`                                                    | прямой парсинг, frontmatter через `gray-matter`                                     | Если есть `[[wikilinks]]` — сохраняем                                                                 |
| `.txt`                                                   | прямое чтение                                                                       |
| `.html`                                                  | `turndown` (HTML → Markdown)                                                        |
| `.csv`, `.json`                                          | как есть, метаданные о структуре                                                    |
| Картинки (`.jpg`, `.png`, `.webp`, `.heic`)              | сохранение + при включённом Claude Code → описание + извлечение текста через vision |
| Аудио (`.ogg`, `.mp3`, `.wav`)                           | Если whisper enabled → транскрипция, иначе сохраняется как attachment без обработки |

### 9.2 Документация по экспорту (в `/docs/EXPORT_GUIDES/`)

**chatgpt.md:**

- Шаги: Settings → Data Controls → Export Data → email со ссылкой → скачать ZIP
- Что внутри: `conversations.json`, `chat.html`, `user.json`
- Какой ZIP грузить в Mnela: целиком, парсер сам найдёт нужные файлы

**claude.md:**

- Шаги: Settings → Privacy → Export data → email с ссылкой (24ч)
- Внутри: JSON-файлы по conversation_id

**obsidian.md:**

- Скопировать папку vault целиком в zip
- Опционально: добавить `_obsidian-attachments/` если хочется attachments
- Frontmatter сохраняется

**notion.md** — на будущее.

### 9.3 Drag-and-drop в Web UI

В `/imports/new`:

- Drop zone принимает ZIP, отдельные файлы, drag целой папки (через File System Access API)
- Превью того, что распознано (типы, кол-во, общий размер)
- Опции:
  - Project tag (применить ко всем)
  - Source type override
  - Skip duplicates by hash (default ON)
- Кнопка Start → создаётся Import job, переход на live-страницу

### 9.4 Folder watch на сервере

Папка `/var/lib/mnela/dropbox/` мониторится. Файлы туда → автоматически попадают в очередь ingestion. Удобно для:

- Telegram-бота (он будет складывать туда)
- rsync/scp вручную с другой машины
- бэкапов

---

## 10. Безопасность

### 10.1 Что защищаем

- Web UI и API (POST/PUT/DELETE)
- MCP endpoint
- Файлы в `/var/lib/mnela/`

### 10.2 Аутентификация

- **Web UI:** session cookie после логина username+password (Argon2 hash, не bcrypt)
- **REST API:** session cookie ИЛИ Bearer token
- **MCP endpoint:** Bearer token обязателен
- **Tokens:** sha256 hash в БД, plaintext только при создании
- **Rate limiting:** 100 req/min на IP для API, 10 attempts на login

### 10.3 Сетевая безопасность

- Только Caddy слушает 80/443
- Все внутренние сервисы (postgres, redis, api, mcp, etc) в Docker network, не доступны снаружи
- Caddy конфиг с security headers (HSTS, X-Frame-Options, CSP)
- HTTPS обязателен (auto Let's Encrypt при наличии домена, self-signed если IP-only)

### 10.4 Хранение

- `/etc/mnela/.env` — chmod 600, owner root
- Postgres password не в коде, только в env
- Backup'ы шифруются (опционально, AES-256 с user-provided passphrase)

### 10.5 MCP tool authorization

Каждый MCP tool вызов:

1. Проверяет Bearer token
2. Проверяет scope (admin/mcp/read_only)
3. Логирует в AuditLog (actor=token name, action, target)

Write tools могут быть отключены через config (`MNELA_MCP_READ_ONLY=true`).

### 10.6 Cloudflare Tunnel mode

Опциональный режим для серверов без публичного IP:

- `install.sh --tunnel` спрашивает Cloudflare token
- Поднимает контейнер `cloudflared`
- Caddy слушает только на 127.0.0.1
- Туннель проксирует на Caddy

---

## 11. Live progress system (детально)

Это критическая фича по требованию пользователя. Раскрываю.

### 11.1 BullMQ структура

Очереди:

- `ingestion` — парсинг файлов (concurrent: 4)
- `enrichment` — Claude Code задачи (concurrent: 1, rate-limited)
- `indexing` — FTS rebuild, vault export (concurrent: 1)
- `maintenance` — backup, cleanup (cron-triggered)

Каждая job имеет:

- Прогресс 0-100 (BullMQ built-in)
- Custom data в `job.data`
- Результат в `job.returnvalue`

### 11.2 Worker эмитит события

```typescript
// в worker'е
worker.on('progress', (job, progress) => {
  redisPubSub.publish('jobs', {
    type: 'progress',
    jobId: job.id,
    progress,
    message: job.data.statusMessage,
  });
});

worker.on('completed', (job, result) => {
  redisPubSub.publish('jobs', { type: 'completed', jobId: job.id, result });
});
```

API сервис подписан на pubsub, форвардит в Socket.io клиентам.

### 11.3 Frontend

`/imports/:id` подключается к Socket.io namespace `/live`, фильтрует события по `importId`. Cytoscape инстанс держит nodes/edges Map. Каждый event:

```typescript
socket.on('graph.node_added', (entity) => {
  cy.add({
    data: { id: entity.id, label: entity.name, type: entity.type },
    style: { opacity: 0 },
  });
  cy.$('#' + entity.id).animate({ style: { opacity: 1 } }, { duration: 400 });
});

socket.on('graph.edge_added', (edge) => {
  cy.add({
    data: { id: edge.id, source: edge.fromId, target: edge.toId, label: edge.relationType },
  });
  // pulse animation
  cy.$('#' + edge.id)
    .animate({ style: { 'line-color': '#ff9900' } }, { duration: 200 })
    .animate({ style: { 'line-color': '#666' } }, { duration: 800 });
});
```

### 11.4 Rate limit visibility

Системная инфо панель в `/admin/claude` показывает:

- Текущее rate limit окно (start/end)
- Использовано в окне / лимит
- Когда обнулится
- График использования за последние 7 дней

При импорте Mnela сама не знает точный rate limit подписки, но трекает свои запросы (в среднем Claude Max 20x = ~200 messages/5h). Если превышение — задачи переходят в paused, юзер видит в UI «Claude rate limit reached, resuming at HH:MM».

---

## 12. Глобальный CLAUDE.md для серверного Claude Code

`infra/claude/CLAUDE.md.template` — устанавливается в `~/.claude/CLAUDE.md` на сервере при `claude login`. Содержит:

```markdown
# Mnela Server Brain Instructions

You are running on a Mnela server. Your role is to enrich incoming notes,
build a knowledge graph, and answer questions about the user's personal data.

## Available MCP servers

- `mnela` — the user's knowledge base (read + write)
- `filesystem` — `/var/lib/mnela/vault` for direct markdown access

## Core Principles

1. NEVER fabricate information. If unsure, say so.
2. ALL relationships you create must include confidence (0.0-1.0).
3. Confidence > 0.8 = auto-confirmed. 0.5-0.8 = suggested for review. <0.5 = don't create.
4. ALL extractions must reference evidence (document_id and chunk if possible).
5. The user is bilingual (Russian primary, English for code/tech). Search and reason in both.
6. NEVER delete user data. Use archive operations.

## Task Types

### Enrich document

When called with a document_id:

1. Use `mnela_get_document` to fetch full content
2. Extract: summary (200 words), entities (people, projects, technologies, concepts),
   decisions (if any), tasks (if any), ideas (if any), key references
3. For each entity, check if it exists via `mnela_get_entity`. Reuse if match. Suggest merge if similar.
4. Find related documents via `mnela_find_similar` (top 10)
5. Propose links between this document's entities and related documents' entities
6. Write back via `mnela_add_entities` and `mnela_add_links`
7. Output JSON summary of what was done

### Refresh project context

When called with project slug:

1. `mnela_get_project_context`
2. Read recent documents (30 days), all decisions, all entities
3. Generate updated context.md (~500 words):
   - Current state and stack
   - Recent decisions
   - Open questions
   - Connected projects/entities
4. Write back via `mnela_update_project_context`

### Answer question

When called with user question:

1. Multi-step search: FTS + similarity + graph traversal
2. Cite sources (document_id) for every claim
3. If conflicting info — surface both with dates
4. If insufficient — say what's missing, don't guess

## Anti-patterns

- Don't create entities for trivial concepts ("computer", "project", "email")
- Don't create transitive edges already implied (if A→B and B→C, don't auto-create A→C)
- Don't update decisions silently — supersede with new entry
- Don't merge entities differing in case sensitivity for code (e.g. "react" vs "React" stay separate if context is code)
```

---

## 13. Backup и восстановление

### 13.1 Backup

`mnela backup` (или cronjob по умолчанию ежедневно):

- `pg_dump` всей БД
- tar архив `/var/lib/mnela/attachments/` и `vault/`
- Optional: encrypt с user passphrase
- Сохраняет в `/var/lib/mnela/backups/YYYY-MM-DD-HHMMSS.tar.gz`
- Опционально: rclone sync в S3/B2/etc (если настроено)

### 13.2 Restore

`mnela restore <backup-file>`:

- Останавливает API/worker (но не postgres/redis)
- Восстанавливает БД
- Восстанавливает файлы
- Запускает migrations
- Перестраивает FTS index
- Запускает API/worker

---

## 14. Конфигурация (`.env` и env vars)

```bash
# Обязательные
MNELA_DOMAIN=mnela.example.com           # или IP
MNELA_BIND_MODE=domain                    # domain | ip | tunnel
MNELA_DATA_DIR=/var/lib/mnela
POSTGRES_PASSWORD=<generated>
REDIS_PASSWORD=<generated>
JWT_SECRET=<generated>
ADMIN_INITIAL_TOKEN=<generated, single-use>

# Claude Code
MNELA_CLAUDE_MODE=enabled                 # enabled | disabled (Dumb Mode)
MNELA_CLAUDE_MAX_CONCURRENT=1
MNELA_CLAUDE_RATE_LIMIT_PER_HOUR=30      # safety, ниже реального лимита Max
MNELA_CLAUDE_TIMEOUT_SECONDS=180

# Опциональные модули
MNELA_TRANSCRIPTION=disabled              # enabled поднимает whisper
MNELA_TRANSCRIPTION_LANGUAGE=ru
MNELA_EMBEDDINGS=disabled                 # на будущее

# MCP
MNELA_MCP_PUBLIC_URL=https://mnela.example.com/mcp
MNELA_MCP_READ_ONLY=false

# Backups
MNELA_BACKUP_ENABLED=true
MNELA_BACKUP_SCHEDULE="0 4 * * *"
MNELA_BACKUP_RETENTION_DAYS=14

# Cloudflare Tunnel (если используется)
CF_TUNNEL_TOKEN=

# Logging
MNELA_LOG_LEVEL=info
```

---

## 15. План разработки по фазам

> Это план для Claude Code. После создания PLAN.md в репо разбей каждую фазу на TodoWrite задачи.

### Фаза 0: Фундамент (1-2 дня)

- [ ] Создать монорепо: pnpm + turbo
- [ ] Настроить ESLint, Prettier, TypeScript strict
- [ ] Настроить commit hooks (husky + lint-staged)
- [ ] Создать структуру каталогов как в п. 3.2
- [ ] CI workflow (GitHub Actions): build, lint, test
- [ ] Базовый docker-compose с postgres + redis
- [ ] Prisma init, schema из п.4, первая миграция
- [ ] FTS migration через raw SQL
- [ ] Seed скрипт с примерами

**Готово когда:** `pnpm dev` запускает все сервисы, миграция применяется, можно сделать `pnpm db:studio`.

### Фаза 1: Core API + базовая БД работа (3-5 дней)

- [ ] `apps/api`: NestJS с модулями Documents, Projects, Decisions, Daily, Entities, Edges, Auth, System
- [ ] Prisma repositories в `packages/db`
- [ ] Базовый CRUD для всех ресурсов
- [ ] FTS поиск через `to_tsquery` с весами
- [ ] Trigram fuzzy search
- [ ] Hybrid search (FTS rank + trigram similarity)
- [ ] Auth через session cookie + Bearer token
- [ ] Argon2 для паролей
- [ ] AuditLog hook на изменения
- [ ] Тесты: unit для repos, integration для API
- [ ] Swagger/OpenAPI

**Готово когда:** через REST API можно создавать документы, искать их, видеть в БД.

### Фаза 2: Ingestion (4-6 дней)

- [ ] `packages/ingestion` — парсеры для всех форматов из п.9.1
- [ ] BullMQ интеграция, очереди ingestion
- [ ] Idempotency через content_hash
- [ ] Chunking стратегия (recursive с overlap)
- [ ] `apps/worker` — BullMQ consumer
- [ ] Pub/sub события Redis
- [ ] WebSocket gateway в API → клиентам
- [ ] Folder watch для `/var/lib/mnela/dropbox/`
- [ ] Тесты с реальными ChatGPT/Claude exports

**Готово когда:** загруженный ZIP экспорта ChatGPT превращается в N документов, доступных через API + поиск.

### Фаза 3: Web UI скелет (5-7 дней)

- [ ] `apps/web` — Next.js 15, App Router, Tailwind, shadcn/ui
- [ ] Layout: sidebar nav + main + right pane
- [ ] Dark theme by default
- [ ] Login + Setup wizard
- [ ] Documents list + detail
- [ ] Search page (с keyboard shortcuts)
- [ ] Projects list + detail (без edit)
- [ ] Decisions journal
- [ ] Daily view с calendar
- [ ] Inbox skeleton
- [ ] Imports list + new + detail (без live progress пока)
- [ ] Admin: tokens, system info

**Готово когда:** все CRUD доступны через UI, можно искать.

### Фаза 4: Live progress + Graph (4-6 дней)

- [ ] Cytoscape.js интеграция в `packages/ui`
- [ ] Graph endpoint в API с query parameters
- [ ] Page `/graph` с фильтрами и interactions
- [ ] Socket.io client в Next.js
- [ ] Live updates на странице imports/:id
- [ ] **Live growing graph** на этой странице
- [ ] Анимации (fadeIn ноды, pulse рёбер)
- [ ] Pause/Resume/Cancel controls
- [ ] Job stats dashboard

**Готово когда:** при импорте видно живой растущий граф, можно паузить.

### Фаза 5: Claude Code Orchestrator (5-7 дней)

- [ ] `apps/orchestrator` — управление subprocess
- [ ] `packages/claude-runner` — обёртка над `claude` CLI
- [ ] Очередь enrichment с rate limiting
- [ ] Health check Claude Code (`mnela claude:test`)
- [ ] Retry с exponential backoff
- [ ] Error handling и logging
- [ ] CLAUDE.md template
- [ ] MCP config для серверного Claude
- [ ] Detection rate limit hit
- [ ] Pause/resume по rate limit окнам

**Готово когда:** новый документ автоматически обрабатывается серверным Claude, появляются entities в графе.

### Фаза 6: MCP сервер (3-4 дня)

- [ ] `apps/mcp` — NestJS с @modelcontextprotocol/sdk
- [ ] HTTP transport
- [ ] Все tools из п.5
- [ ] Bearer token auth
- [ ] Scope checking
- [ ] Connection через `claude mcp add` testing
- [ ] Документация для подключения к Claude Code, Cursor, Cline

**Готово когда:** можно подключить локальный Claude Code к Mnela, получать ответы из MCP tools.

### Фаза 7: Inbox + qualité (3-5 дней)

- [ ] Inbox UI с accept/reject/edit
- [ ] Confidence-based routing
- [ ] Entity merge через UI
- [ ] Edge editing
- [ ] Search highlights
- [ ] Empty states, loading states, error boundaries
- [ ] Keyboard shortcuts (⌘K, навигация)

### Фаза 8: Ask Brain (2-3 дня)

- [ ] Chat UI
- [ ] SSE streaming от Claude Code subprocess
- [ ] Citation parsing и rendering
- [ ] Save synthesis as note
- [ ] History диалогов

### Фаза 9: Опциональные модули (2-3 дня)

- [ ] Whisper container + API
- [ ] Voice upload через UI

### Фаза 10: Deploy & DX (3-4 дня)

- [ ] `install.sh` со всем wizard
- [ ] `update.sh`, `backup.sh`, `restore.sh`
- [ ] `mnela` CLI с командами status/logs/backup/restore
- [ ] Caddyfile template (domain mode + IP mode + tunnel mode)
- [ ] Docker images optimization (multi-stage)
- [ ] README.md
- [ ] DEPLOYMENT.md
- [ ] EXPORT_GUIDES/
- [ ] TROUBLESHOOTING.md
- [ ] Issue templates

### Фаза 11: Polish (2-3 дня)

- [ ] Профилирование производительности
- [ ] Indexes audit
- [ ] Memory limits для контейнеров
- [ ] Healthchecks
- [ ] Sentry integration (optional)
- [ ] E2E тесты с Playwright

**Итого: ~40-55 дней работы Claude Code.**

---

## 16. Тестирование

- **Unit:** Vitest для всех `packages/*`
- **Integration:** Vitest + test containers (postgres, redis) в `apps/api`
- **E2E:** Playwright в `apps/web/e2e`
- **Целевое покрытие:** 70%+ для core packages, 50%+ для apps
- **Smoke test после deploy:** healthcheck + create+search document + connect MCP

---

## 17. Документация (`/docs`)

Минимальный набор для пользователя:

- `README.md` — что такое Mnela, скриншоты, install в одну строку, ссылки
- `ARCHITECTURE.md` — для тех, кто хочет понять
- `DEPLOYMENT.md` — пошаговая установка
- `MCP_INTEGRATION.md` — как подключить из Claude Code, Cursor, Cline, ChatGPT (когда поддержит MCP)
- `EXPORT_GUIDES/chatgpt.md`, `claude.md`, `obsidian.md`, `notion.md`
- `TROUBLESHOOTING.md`
- `CONTRIBUTING.md` — на потом, заглушка

---

## 18. Вне scope первой версии

Чтобы Claude Code не залезал в это:

- Telegram бот — отдельный проект
- Mobile app
- Public landing page
- Multi-language UI (только RU + EN на старте)
- Multi-tenant
- Plugins/extensions API
- Public marketplace для tools
- Federated search across instances
- LLM проксирование (типа OpenAI-compatible API)
- Voice synthesis (TTS)
- Image generation
- Внешние интеграции (Notion API, Google Drive, GitHub, etc) — будут как импорт-источники, но не realtime sync

---

## 19. Финальные инструкции для Claude Code

1. **Прочитай это ТЗ полностью**, прежде чем начинать.
2. **Создай PLAN.md** в корне репо с разбивкой фаз на конкретные задачи.
3. **Создай DECISIONS.md** где будешь логировать архитектурные решения.
4. **Используй TodoWrite** для каждой задачи внутри фазы.
5. **Используй subagents** для параллельных независимых частей (например, parser для chatgpt и parser для docx — параллельно).
6. **После каждой фазы — git commit** с осмысленным сообщением и тегом `phase-N`.
7. **Если упираешься в неясность** — добавь вопрос в `QUESTIONS.md`, продолжай с разумным предположением, но не исчезай молча.
8. **НЕ создавай README с маркетингом** — мы пока строим для одного пользователя.
9. **Тесты пиши параллельно с кодом**, не откладывай.
10. **Каждая фаза заканчивается работающим состоянием.** Не оставляй полусобранную систему.
11. **Code style:** TypeScript strict, no `any`, явные типы для public API. Inline комментарии — только когда логика неочевидна.
12. **Commits атомарные:** одна логическая единица = один commit.
13. **запрет на `Co-Authored-By: Claude`, `🤖 Generated with Claude Code` и подобные подписи.** Не упоминай себя как соавтора никогда и нигде.

---

## Приложение A: Пример MCP подключения для пользователя

После установки Mnela выводит:

```bash
# Скопируй и выполни на своём компьютере с Claude Code:

claude mcp add --scope user --transport http mnela \
  https://mnela.example.com/mcp \
  --header "Authorization: Bearer mn_token_xxxxxxxxxxxxxxxxxxxxx"

# Проверь:
claude mcp list
# Должно показать: mnela (http) ✓ Connected

# Внутри Claude Code:
> /mcp
# Должно показать tools: mnela_search, mnela_get_project_context, etc

# Добавь в свой ~/.claude/CLAUDE.md следующее (вставка):

## My Personal Brain
I have access to my personal knowledge base via the `mnela` MCP server.
Use it whenever:
- I mention "my notes", "my decisions", "we discussed", "remember when"
- Starting a project that may have prior context
- I ask "have I worked on something similar"

Workflow:
1. Always start with `mnela_search` for query terms
2. If a project is identified, fetch `mnela_get_project_context`
3. Cite document IDs in your reasoning
```

---

**Конец ТЗ.**

Когда начнёшь работу, Claude Code, начни с создания `PLAN.md` и подтверждения что понял scope. Не приступай к коду до того, как план будет одобрен пользователем.
