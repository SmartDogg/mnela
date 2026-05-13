-- ADR-0051: Auto-suggested projects.
--
-- 1. ProjectStatus + ProjectSource enums; convert Project.status (String) to
--    ProjectStatus with archived/paused folded into 'active' for now (only
--    `active` and the new `suggested`/`dismissed` are meaningful going
--    forward — operators who used 'archived'/'paused' will surface those
--    again via metadata if needed).
-- 2. Project columns: source, autoFill, signature, signatureMetrics,
--    batchId.
-- 3. DocumentProjectLinkSource enum + DocumentProject.linkSource +
--    DocumentProject.createdAt.
-- 4. JobType additions: project_suggest, project_autofill.

-- 1. ProjectStatus
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'suggested', 'dismissed');
CREATE TYPE "ProjectSource" AS ENUM ('manual', 'suggested_batch', 'suggested_cluster');

-- Drop the default first so the column can change type without coercion
-- ambiguity, then re-add the default afterwards.
ALTER TABLE "Project"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Project"
  ALTER COLUMN "status" TYPE "ProjectStatus" USING (
    CASE
      WHEN "status" IN ('suggested', 'dismissed') THEN "status"::"ProjectStatus"
      ELSE 'active'::"ProjectStatus"
    END
  );

ALTER TABLE "Project"
  ALTER COLUMN "status" SET DEFAULT 'active';

-- 2. New columns
ALTER TABLE "Project"
  ADD COLUMN "source"           "ProjectSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "autoFill"         BOOLEAN         NOT NULL DEFAULT FALSE,
  ADD COLUMN "signature"        TEXT,
  ADD COLUMN "signatureMetrics" JSONB,
  ADD COLUMN "batchId"          TEXT;

CREATE INDEX "Project_status_idx"    ON "Project"("status");
CREATE INDEX "Project_signature_idx" ON "Project"("signature");
CREATE INDEX "Project_batchId_idx"   ON "Project"("batchId");

-- 3. DocumentProject
CREATE TYPE "DocumentProjectLinkSource" AS ENUM ('manual', 'suggested', 'autoFill');

ALTER TABLE "DocumentProject"
  ADD COLUMN "linkSource" "DocumentProjectLinkSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "createdAt"  TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. JobType — add the two new values.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'project_suggest';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'project_autofill';
