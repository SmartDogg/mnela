-- ADR-0050 step 2/2: MessageKind, pinned back-reference, and the
-- DailyNote → Document(source='daily') data migration. SourceType's new
-- values ('chat','daily') were committed in the previous migration so
-- they're usable here.
--
--   1. MessageKind enum + Message.kind/pinnedDocumentId
--   2. Each DailyNote row → Document(source='daily', status='raw')
--      with metadata.date+mood. We do NOT enqueue enrichment here —
--      that'd flood the queue with the whole backlog. Users can
--      re-enrich on demand from the daily sidebar in /ask.
--   3. DailyNote table is dropped.

-- 1. MessageKind enum + Message column
CREATE TYPE "MessageKind" AS ENUM ('ephemeral', 'pinned');

ALTER TABLE "Message"
  ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'ephemeral',
  ADD COLUMN "pinnedDocumentId" TEXT;

CREATE INDEX "Message_kind_pinnedDocumentId_idx" ON "Message"("kind", "pinnedDocumentId");

-- 2. Migrate DailyNote → Document (source='daily', status='raw').
--    title = "Daily YYYY-MM-DD"; rawText = contentMd (mood folded into
--    metadata only — never into the body so embeddings stay focused on
--    the actual note). contentHash prefix 'daily:' keeps these out of
--    collision with imported documents (which use real sha256 hex) and
--    is unique because DailyNote.date was UNIQUE.
INSERT INTO "Document" (
  "id", "source", "sourceId", "title", "rawText", "contentHash",
  "language", "type", "metadata", "status",
  "createdAt", "updatedAt", "ingestedAt"
)
SELECT
  dn."id",
  'daily'::"SourceType",
  to_char(dn."date", 'YYYY-MM-DD'),
  'Daily ' || to_char(dn."date", 'YYYY-MM-DD'),
  dn."contentMd",
  'daily:' || to_char(dn."date", 'YYYY-MM-DD'),
  NULL,
  'note',
  jsonb_build_object(
    'date', to_char(dn."date", 'YYYY-MM-DD'),
    'mood', dn."mood",
    'migratedFrom', 'DailyNote'
  ) || COALESCE(dn."metadata", '{}'::jsonb),
  'raw'::"DocumentStatus",
  dn."createdAt",
  dn."updatedAt",
  dn."createdAt"
FROM "DailyNote" dn
ON CONFLICT ("id") DO NOTHING;

-- 3. Drop the legacy table.
DROP TABLE "DailyNote";
