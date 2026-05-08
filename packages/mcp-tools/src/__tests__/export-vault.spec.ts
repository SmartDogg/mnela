import { describe, expect, it } from 'vitest';

import { exportVault } from '../tools/export-vault.js';
import { buildMockCtx } from './helpers.js';

describe('exportVault', () => {
  it('returns destinationPath when provided', async () => {
    const bag = buildMockCtx();
    const out = await exportVault({ destinationPath: '/tmp/custom' }, bag.ctx);
    expect(out.exportPath).toBe('/tmp/custom');
  });

  it('falls back to a /tmp/mnela-vault-<ts> path when omitted', async () => {
    const bag = buildMockCtx();
    const out = await exportVault({}, bag.ctx);
    expect(out.exportPath).toMatch(/^\/tmp\/mnela-vault-\d+$/);
  });
});
