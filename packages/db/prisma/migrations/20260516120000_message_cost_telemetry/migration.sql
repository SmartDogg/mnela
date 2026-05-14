-- Phase 11: per-message cost telemetry (Bucket C).
--
-- Adds three columns to Message:
--   * costUsd      — derived in the api at message-persist time from
--                    tokensIn/tokensOut + a hard-coded per-model rate
--                    table (see apps/api/src/modules/search/cost-rates.ts).
--                    Numeric(10, 6) gives us cents-and-microcents up to
--                    ~$9999 per message, plenty.
--   * providerId   — soft FK (no constraint) so a provider deletion
--                    doesn't cascade-rewrite history.
--   * model        — breadcrumb of the model name at the time of the
--                    call. Survives provider rename / model swap.
--
-- All three are nullable: CLI-backed turns (built-in claude-cli) don't
-- emit usage frames, and earlier messages have no telemetry to backfill.

ALTER TABLE "Message"
  ADD COLUMN "costUsd"    DECIMAL(10, 6),
  ADD COLUMN "providerId" TEXT,
  ADD COLUMN "model"      TEXT;
