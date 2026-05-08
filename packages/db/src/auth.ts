export type TokenScope = 'admin' | 'mcp' | 'read_only';

export const SCOPE_HIERARCHY: Record<TokenScope, number> = {
  read_only: 0,
  mcp: 1,
  admin: 2,
};

export function scopeAllows(have: TokenScope, required: TokenScope): boolean {
  return SCOPE_HIERARCHY[have] >= SCOPE_HIERARCHY[required];
}

export interface Principal {
  kind: 'admin' | 'token';
  id: string;
  scope: TokenScope;
  name?: string;
}
