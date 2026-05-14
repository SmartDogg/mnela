#!/usr/bin/env node
/**
 * scripts/validate-keystore.mjs — restore.sh safety guard.
 *
 * Verifies that a bundled `keystore/provider.key` can decrypt at least
 * one ciphertext blob from a Postgres dump. If decryption fails — or
 * the file is the wrong length / missing — exits non-zero so restore.sh
 * refuses to wipe the target database.
 *
 * The previous shell-only implementation relied on `openssl enc -d
 * -aes-256-gcm -aead_tag_hex …` which doesn't exist in upstream OpenSSL
 * 1.1.x / 3.x (only LibreSSL / patched builds). On stock Debian/Ubuntu
 * the guard fell through to `exit 1` and the user was forced to
 * `--skip-keystore-check`. This Node script uses `crypto.createDecipheriv`
 * which works everywhere Node 22 runs.
 *
 * Blob layout matches packages/llm-providers/src/keystore.ts:
 *   12B IV  ‖  16B authTag  ‖  ciphertext
 *
 * Usage:
 *   node scripts/validate-keystore.mjs <provider.key> <postgres.sql.gz>
 *
 * Exit codes:
 *   0 — at least one row decrypted, OR no encrypted rows in dump (vault never used a provider)
 *   1 — key length wrong, ciphertext truncated, or decryption failed
 *   2 — usage error
 */

import { readFile, stat } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const [keyPath, dumpPath] = process.argv.slice(2);
if (!keyPath || !dumpPath) {
  console.error('usage: node scripts/validate-keystore.mjs <provider.key> <postgres.sql.gz>');
  process.exit(2);
}

let key;
try {
  key = await readFile(keyPath);
} catch (err) {
  console.error(`✘ cannot read keystore file: ${err.message}`);
  process.exit(1);
}
if (key.length !== 32) {
  console.error(`✘ keystore file is ${key.length} bytes, expected 32 (AES-256-GCM key length).`);
  process.exit(1);
}

// Read dump (may be gzipped).
const dumpStat = await stat(dumpPath);
if (dumpStat.size === 0) {
  console.error('✘ postgres dump is empty.');
  process.exit(1);
}
const dumpRaw = await readFile(dumpPath);
const dump = dumpPath.endsWith('.gz')
  ? gunzipSync(dumpRaw).toString('utf8')
  : dumpRaw.toString('utf8');

// Find the LlmProvider COPY block. Postgres dumps it as:
//   COPY public."LlmProvider" (id, ..., "apiKeyEnc", ...) FROM stdin;
//   <id>\t...\t\\x<hex>\t...\n
//   \.
// We need to locate the column position of apiKeyEnc within the COPY
// header and then pull the corresponding tab-separated field.
const copyHeaderMatch = dump.match(/COPY public\."LlmProvider" \(([^)]+)\) FROM stdin;/);
if (!copyHeaderMatch) {
  console.log('✓ no LlmProvider rows in dump — keystore never used, OK to restore.');
  process.exit(0);
}

const columns = copyHeaderMatch[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
const apiKeyIdx = columns.indexOf('apiKeyEnc');
if (apiKeyIdx === -1) {
  console.error(
    '✘ LlmProvider COPY block has no apiKeyEnc column. Dump may be from a much older schema.',
  );
  process.exit(1);
}

// Scan rows between the COPY header and the trailing `\.`. The dump
// uses literal `\x<hex>` for bytea values; null is `\N`.
const headerEnd = copyHeaderMatch.index + copyHeaderMatch[0].length;
const tail = dump.slice(headerEnd);
const terminator = tail.search(/^\\\.$/m);
const body = terminator === -1 ? tail : tail.slice(0, terminator);
const rows = body.split('\n').filter((line) => line.length > 0);

let testedRow = null;
for (const row of rows) {
  const fields = row.split('\t');
  const value = fields[apiKeyIdx];
  if (!value || value === '\\N') continue;
  // pg dumps bytea as `\x<hex>` (single backslash in the text dump).
  const hexMatch = value.match(/^\\x([0-9a-fA-F]+)$/);
  if (!hexMatch) continue;
  testedRow = hexMatch[1];
  break;
}

if (!testedRow) {
  console.log('✓ LlmProvider table present but all apiKeyEnc are NULL — keystore unused.');
  process.exit(0);
}

const blob = Buffer.from(testedRow, 'hex');
if (blob.length < 12 + 16 + 1) {
  console.error(`✘ apiKeyEnc blob is ${blob.length} bytes (need ≥29). Bundle corrupt.`);
  process.exit(1);
}

const iv = blob.subarray(0, 12);
const tag = blob.subarray(12, 28);
const ct = blob.subarray(28);

try {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  if (plaintext.length === 0) {
    console.error('✘ decryption succeeded but plaintext is empty. Suspicious.');
    process.exit(1);
  }
  console.log(`✓ keystore decrypts LlmProvider row (plaintext: ${plaintext.length} bytes).`);
  process.exit(0);
} catch (err) {
  console.error(`✘ keystore does NOT decrypt LlmProvider rows: ${err.message}`);
  console.error('   The bundle was encrypted with a DIFFERENT master key than the one inside.');
  console.error('   Refusing to restore — that would render every saved API key unusable.');
  process.exit(1);
}
