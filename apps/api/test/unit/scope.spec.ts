import { describe, expect, it } from 'vitest';

import { scopeAllows } from '../../src/auth/types.js';

describe('scopeAllows', () => {
  it('admin can do anything mcp can', () => {
    expect(scopeAllows('admin', 'admin')).toBe(true);
    expect(scopeAllows('admin', 'mcp')).toBe(true);
    expect(scopeAllows('admin', 'read_only')).toBe(true);
  });

  it('mcp can do mcp + read_only but not admin', () => {
    expect(scopeAllows('mcp', 'admin')).toBe(false);
    expect(scopeAllows('mcp', 'mcp')).toBe(true);
    expect(scopeAllows('mcp', 'read_only')).toBe(true);
  });

  it('read_only can only read', () => {
    expect(scopeAllows('read_only', 'admin')).toBe(false);
    expect(scopeAllows('read_only', 'mcp')).toBe(false);
    expect(scopeAllows('read_only', 'read_only')).toBe(true);
  });
});
