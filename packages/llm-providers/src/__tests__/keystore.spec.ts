import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createKeystore, keystoreFromBuffer } from '../keystore.js';

describe('keystore', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mnela-keystore-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('round-trips a key via env', async () => {
    const k = await createKeystore({
      envSecret: 'a'.repeat(64),
      dataDir,
    });
    expect(k.source).toBe('env');
    const blob = k.encrypt('sk-secret');
    expect(k.decrypt(blob)).toBe('sk-secret');
  });

  it('falls back to file-backed keystore and persists across calls', async () => {
    const k1 = await createKeystore({ envSecret: undefined, dataDir });
    expect(k1.source).toBe('file');
    expect(k1.keyPath).toBeDefined();
    const blob = k1.encrypt('hello');

    const k2 = await createKeystore({ envSecret: undefined, dataDir });
    expect(k2.decrypt(blob)).toBe('hello');
  });

  it('rejects tampered ciphertext', () => {
    const buf = Buffer.alloc(32, 7);
    const k = keystoreFromBuffer(buf);
    const blob = k.encrypt('secret');
    // Flip a byte in the ciphertext region.
    blob[blob.length - 1] = (blob[blob.length - 1]! ^ 0xff) & 0xff;
    expect(() => k.decrypt(blob)).toThrow();
  });
});
