-- ADR-0050 step 1/2: extend SourceType with values that the next
-- migration depends on. Postgres requires ALTER TYPE ADD VALUE to
-- COMMIT before the new label is usable from a DML statement, so this
-- has to be its own migration file — Prisma wraps each file in one
-- implicit transaction.

ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'chat';
ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'daily';
