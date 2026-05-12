-- Phase: image attachment analysis pipeline (ADR-0048).

-- 1) New job type for the analyze_attachment pipeline.
ALTER TYPE "JobType" ADD VALUE 'analyze_attachment';

-- 2) Image attachments are promoted to a standalone Document(type=image).
--    `linkedDocumentId` points the Attachment row at that companion document
--    so the gallery on /documents/:id can show the original image and the
--    /documents listing can expose images as first-class entries. NULL for
--    non-image / non-promoted attachments.
ALTER TABLE "Attachment"
  ADD COLUMN "linkedDocumentId" TEXT,
  ADD COLUMN "analyzedAt"       TIMESTAMP(3);

-- 3) FK so the linked document being deleted nulls the pointer without
--    cascading the Attachment itself (the owner Document still relates via
--    the existing `documentId` column).
ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_linkedDocumentId_fkey"
  FOREIGN KEY ("linkedDocumentId") REFERENCES "Document"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Lookups: "which document was this image promoted into" and the reverse.
CREATE INDEX "Attachment_linkedDocumentId_idx" ON "Attachment"("linkedDocumentId");
