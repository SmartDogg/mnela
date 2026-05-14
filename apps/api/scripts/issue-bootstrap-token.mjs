#!/usr/bin/env node
/**
 * scripts/issue-bootstrap-token.mjs — INSERT an AuthToken row for the
 * install-time MNELA_INTERNAL_TOKEN.
 *
 * Background:
 *   - apps/tg-bot calls /search/ask and /documents/upload with the
 *     Bearer token in MNELA_INTERNAL_TOKEN env.
 *   - apps/api verifies inbound bearer tokens by sha256-hashing the
 *     plaintext and looking up `AuthToken.tokenHash`.
 *   - install.sh generates the plaintext but until this script runs,
 *     no DB row exists → every tg-bot call returns 401 → bot crash-
 *     loops on first deploy.
 *
 * Idempotent: if a row with the same hash exists, no-op.
 *
 * Usage (from inside the api container):
 *   node scripts/issue-bootstrap-token.mjs "$MNELA_INTERNAL_TOKEN"
 */

import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const plaintext = process.argv[2] || process.env.MNELA_INTERNAL_TOKEN;
if (!plaintext || plaintext.length < 20) {
  console.error('usage: node scripts/issue-bootstrap-token.mjs <token>');
  console.error('       (or set MNELA_INTERNAL_TOKEN env)');
  process.exit(2);
}
if (!plaintext.startsWith('mn_')) {
  console.error(`✘ token must start with 'mn_' prefix; got: ${plaintext.slice(0, 6)}…`);
  process.exit(2);
}

const tokenHash = createHash('sha256').update(plaintext).digest('hex');
const prisma = new PrismaClient();

try {
  const existing = await prisma.authToken.findUnique({ where: { tokenHash } });
  if (existing) {
    if (existing.revokedAt) {
      console.error(
        `✘ matching AuthToken exists but is revoked (id=${existing.id}). Rotate MNELA_INTERNAL_TOKEN in .env.`,
      );
      process.exit(1);
    }
    console.log(`✓ AuthToken already issued (id=${existing.id})`);
    process.exit(0);
  }
  const row = await prisma.authToken.create({
    data: {
      name: 'install:tg-bot',
      tokenHash,
      scope: 'mcp',
    },
  });
  console.log(`✓ issued AuthToken id=${row.id} scope=mcp`);
} catch (err) {
  console.error(`✘ failed to issue AuthToken: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
