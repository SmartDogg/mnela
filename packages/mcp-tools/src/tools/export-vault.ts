import type { McpToolContext } from '../context.js';
import {
  type ExportVaultInput,
  ExportVaultInputSchema,
  type ExportVaultOutput,
  ExportVaultOutputSchema,
} from '../schemas.js';

export const EXPORT_VAULT_TOOL = {
  name: 'mnela_export_vault',
  description:
    'Trigger a vault export. Phase 6 stub returns the would-be path; the full Markdown/JSONL export lands in Phase 10 (TZ §13.1).',
  scope: 'admin' as const,
  inputSchema: ExportVaultInputSchema,
  outputSchema: ExportVaultOutputSchema,
  audit: {
    action: 'mcp.export_vault',
    targetType: 'System',
    targetIdFrom: 'output' as const,
    targetIdPath: 'exportPath',
  },
};

export async function exportVault(
  input: ExportVaultInput,
  _ctx: McpToolContext,
): Promise<ExportVaultOutput> {
  // Phase 6 stub. Full export lands in Phase 10 (TZ §13.1).
  const exportPath = input.destinationPath ?? `/tmp/mnela-vault-${Date.now()}`;
  return { exportPath };
}
