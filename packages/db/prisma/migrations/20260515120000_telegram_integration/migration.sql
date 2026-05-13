-- ADR-0053: Telegram bot integration.
--
-- 1. TelegramBot — singleton config row holding the encrypted bot token,
--    transport mode, webhook URL, default scope, and cached bot identity
--    (botUsername / botId). The `id` column is forced to the literal
--    'singleton' so the API can always upsert by a known primary key.
-- 2. TelegramAllowedUser — whitelist of Telegram user IDs the bot accepts
--    messages from. Anyone else is silently ignored (with at most one
--    "not authorized" reply per chat).
-- 3. TelegramChatLink — per-Telegram-chat mapping to a Mnela Conversation
--    + sticky project scope. Created lazily on first message in a chat.

CREATE TYPE "TelegramTransport" AS ENUM ('polling', 'webhook');

CREATE TABLE "TelegramBot" (
  "id"                 TEXT                NOT NULL PRIMARY KEY,
  "enabled"            BOOLEAN             NOT NULL DEFAULT FALSE,
  "tokenEnc"           BYTEA,
  "tokenLast4"         TEXT,
  "botUsername"        TEXT,
  "botId"              BIGINT,
  "transport"          "TelegramTransport" NOT NULL DEFAULT 'polling',
  "webhookUrl"         TEXT,
  "bundleWindowMs"     INTEGER             NOT NULL DEFAULT 4000,
  "defaultProjectSlug" TEXT,
  "createdAt"          TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TelegramAllowedUser" (
  "tgUserId"  BIGINT       NOT NULL PRIMARY KEY,
  "label"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TelegramChatLink" (
  "tgChatId"       BIGINT       NOT NULL PRIMARY KEY,
  "conversationId" TEXT,
  "scopeSlug"      TEXT,
  "lastTurnAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TelegramChatLink_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL
);

CREATE INDEX "TelegramChatLink_conversationId_idx" ON "TelegramChatLink"("conversationId");

INSERT INTO "TelegramBot" ("id", "enabled", "bundleWindowMs", "transport")
VALUES ('singleton', FALSE, 4000, 'polling')
ON CONFLICT ("id") DO NOTHING;
