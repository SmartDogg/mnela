/**
 * Symmetric encryption for provider API keys at rest.
 *
 * Algorithm: AES-256-GCM with a per-record random 12-byte IV and 16-byte
 * auth tag. Output format (bytes):
 *
 *   ┌──────┬─────────┬────────────┐
 *   │ 12 B │ 16 B    │ N B        │
 *   │  IV  │ authTag │ ciphertext │
 *   └──────┴─────────┴────────────┘
 *
 * The 32-byte master key comes from `MNELA_PROVIDER_SECRET` (preferred) or
 * an auto-generated file in `<data-dir>/keystore/provider.key` (0600 on
 * POSIX). Auto-generation makes the OOTB first-boot experience friction-
 * less; the admin UI surfaces the source + path so users can promote to
 * env when they're ready.
 *
 * Never log or echo the key. The admin UI only ever sees `last4` + a
 * `hasKey: boolean` flag — see api/admin/providers controller.
 */

import { existsSync, promises as fs } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import path from 'node:path';

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export type KeystoreSource = 'env' | 'file' | 'memory';

export class KeyNotConfiguredError extends Error {
  constructor() {
    super(
      'Provider keystore not configured: set MNELA_PROVIDER_SECRET or enable the file fallback.',
    );
    this.name = 'KeyNotConfiguredError';
  }
}

export interface Keystore {
  source: KeystoreSource;
  /** Filesystem path when source === 'file' (for the admin UI hint). */
  keyPath?: string;
  encrypt(plaintext: string): Buffer;
  decrypt(blob: Buffer): string;
}

interface CreateKeystoreOptions {
  /** Plaintext 32-byte secret from `MNELA_PROVIDER_SECRET` (hex or base64). */
  envSecret?: string | undefined;
  /** Directory used for the file fallback. Created on demand with mode 0700. */
  dataDir: string;
  /**
   * Override the per-file mode. Defaults to 0600. On Windows the
   * mode is ignored by the OS but still passed to writeFile.
   */
  fileMode?: number;
}

/**
 * Resolve a keystore. Order: env → file (auto-generate if missing).
 * Never throws unless the file system blocks both writing AND reading.
 */
export async function createKeystore(opts: CreateKeystoreOptions): Promise<Keystore> {
  if (opts.envSecret && opts.envSecret.trim().length > 0) {
    const key = parseEnvSecret(opts.envSecret.trim());
    return makeKeystore(key, 'env');
  }
  const keyPath = path.join(opts.dataDir, 'keystore', 'provider.key');
  const key = await loadOrCreateKeyFile(keyPath, opts.fileMode ?? 0o600);
  return makeKeystore(key, 'file', keyPath);
}

/**
 * Walk up from `start` (default: process.cwd()) looking for a
 * `pnpm-workspace.yaml`. Returns the repo root, or `start` if no marker is
 * found. Used so every Mnela app (api, orchestrator, worker) lands on the
 * SAME keystore file when `MNELA_DATA_DIR` is left at its relative default
 * (`./data`) — otherwise each cwd would carve out its own keystore and
 * encrypted provider keys saved through /admin would be unreadable by the
 * orchestrator.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  // Bound the walk at 8 levels just so a stray "cwd at filesystem root"
  // doesn't spin forever.
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

/**
 * Resolve `MNELA_DATA_DIR` relative to the repo root, not the per-process
 * cwd. Absolute paths are returned as-is.
 */
export function resolveDataDir(rawDataDir: string): string {
  if (path.isAbsolute(rawDataDir)) return rawDataDir;
  return path.resolve(findRepoRoot(), rawDataDir);
}

/**
 * Convenience entry point for tests and CLI scripts that already have a
 * raw 32-byte buffer in hand.
 */
export function keystoreFromBuffer(key: Buffer): Keystore {
  if (key.length !== KEY_LEN) {
    throw new Error(`provider key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
  return makeKeystore(key, 'memory');
}

function makeKeystore(key: Buffer, source: KeystoreSource, keyPath?: string): Keystore {
  const store: Keystore = {
    source,
    encrypt(plaintext: string): Buffer {
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ct]);
    },
    decrypt(blob: Buffer): string {
      if (blob.length < IV_LEN + TAG_LEN) {
        throw new Error('provider keystore: ciphertext truncated');
      }
      const iv = blob.subarray(0, IV_LEN);
      const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const ct = blob.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    },
  };
  if (keyPath) store.keyPath = keyPath;
  return store;
}

/**
 * Accepts either a 64-char hex string or a 44-char base64 (with or
 * without padding). Anything else: SHA-256 the string so users who
 * paste a passphrase still get a deterministic 32-byte key.
 */
function parseEnvSecret(raw: string): Buffer {
  // 64-char hex
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  // 44-char base64 (with optional ==)
  if (/^[A-Za-z0-9+/]{43}=?$/.test(raw)) {
    try {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === KEY_LEN) return buf;
    } catch {
      // fall through to hash
    }
  }
  return createHash('sha256').update(raw).digest();
}

async function loadOrCreateKeyFile(filePath: string, mode: number): Promise<Buffer> {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length !== KEY_LEN) {
      throw new Error(
        `provider keystore: ${filePath} is corrupted (${buf.length}B, expected ${KEY_LEN}B)`,
      );
    }
    return buf;
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') {
      // Corrupt file or permission error — surface to caller.
      throw err;
    }
  }
  const buf = randomBytes(KEY_LEN);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, buf, { mode });
  return buf;
}

/**
 * Helpers used by the admin/providers controller: serialise a freshly-set
 * key for storage; recover it on read. Each takes the Keystore so a
 * caller without it (tests) can stub the source.
 */
export function encryptApiKey(store: Keystore, plaintext: string): Buffer {
  return store.encrypt(plaintext);
}
export function decryptApiKey(store: Keystore, blob: Buffer): string {
  return store.decrypt(blob);
}
