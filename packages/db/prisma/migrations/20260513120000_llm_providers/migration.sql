-- Phase: pluggable LLM provider abstraction (ADR-0049).
-- Adds the LlmProvider table backing the new /admin/providers panel.
-- The built-in `Claude Code (CLI)` provider is virtual and never lives
-- here; rows are user-configured Anthropic-API or OpenAI-compatible
-- endpoints. apiKeyEnc is AES-256-GCM ciphertext (12B IV ‖ 16B tag ‖ ct).

CREATE TYPE "LlmProviderKind" AS ENUM ('claude_cli', 'anthropic_api', 'openai_compat');

CREATE TABLE "LlmProvider" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "kind"        "LlmProviderKind" NOT NULL,
  "model"       TEXT NOT NULL,
  "baseUrl"     TEXT,
  "apiKeyEnc"   BYTEA,
  "extra"       JSONB,
  "apiKeyLast4" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LlmProvider_kind_idx" ON "LlmProvider"("kind");

-- Provider routing config has moved into the typed SystemConfig registry
-- under the `providers.*` namespace; old vision keys are no longer read.
-- Drop them so the /admin/system UI doesn't show stale "overridden" badges.
DELETE FROM "SystemConfig"
WHERE "key" IN ('attachments.imageAnalysisBackend', 'attachments.imageAnalysisModel');
