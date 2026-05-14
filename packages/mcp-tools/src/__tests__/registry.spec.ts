import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  McpInputError,
  McpScopeError,
  McpUnknownToolError,
  type ToolDefinition,
} from '../index.js';
import { findTool, invokeTool, PHASE_5_TOOLS, runTool } from '../registry.js';
import { buildMockCtx } from './helpers.js';

describe('registry', () => {
  it('exposes the full phase 5 + 6 tool set (read + write + admin)', () => {
    const names = PHASE_5_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      'mnela_add_entities',
      'mnela_add_links',
      'mnela_archive_document',
      'mnela_export_vault',
      'mnela_find_similar',
      'mnela_get_chunks',
      'mnela_get_daily_note',
      'mnela_get_decisions',
      'mnela_get_document',
      'mnela_get_entity',
      'mnela_get_project_context',
      'mnela_list_projects',
      'mnela_rebuild_index',
      'mnela_recent_activity',
      'mnela_save_decision',
      'mnela_save_note',
      'mnela_search',
      'mnela_set_attachment_analysis',
      'mnela_traverse_graph',
      'mnela_trigger_enrichment',
      'mnela_update_project_context',
    ]);
  });

  it('findTool returns undefined for unknown name', () => {
    expect(findTool('mnela_nope')).toBeUndefined();
  });

  it('invokeTool validates input and returns parsed output', async () => {
    const bag = buildMockCtx();
    bag.similar.push({ documentId: 'd1', title: 'A', score: 0.9 });
    const out = await invokeTool('mnela_find_similar', { text: 'q' }, bag.ctx);
    expect(out).toEqual({ documents: [{ id: 'd1', title: 'A', score: 0.9 }] });
  });

  it('invokeTool throws McpInputError on bad input', async () => {
    const bag = buildMockCtx();
    await expect(invokeTool('mnela_find_similar', { text: '' }, bag.ctx)).rejects.toBeInstanceOf(
      McpInputError,
    );
  });

  it('invokeTool throws McpUnknownToolError for missing tool', async () => {
    const bag = buildMockCtx();
    await expect(invokeTool('mnela_does_not_exist', {}, bag.ctx)).rejects.toBeInstanceOf(
      McpUnknownToolError,
    );
  });

  it('rejects when principal scope is below tool scope', async () => {
    const bag = buildMockCtx({ principalScope: 'read_only' });
    await expect(
      invokeTool('mnela_add_entities', { documentId: 'd', entities: [] }, bag.ctx),
    ).rejects.toBeInstanceOf(McpScopeError);
    expect(bag.auditRows).toHaveLength(0);
  });

  it('read_only tools accept any scope', async () => {
    const bag = buildMockCtx({ principalScope: 'read_only' });
    bag.similar.push({ documentId: 'd1', title: 'A', score: 0.9 });
    await expect(invokeTool('mnela_find_similar', { text: 'q' }, bag.ctx)).resolves.toBeDefined();
  });

  it('skips auditTx and audit.create for tools without audit metadata', async () => {
    const bag = buildMockCtx();
    bag.similar.push({ documentId: 'd1', title: 'A', score: 0.9 });
    await invokeTool('mnela_find_similar', { text: 'q' }, bag.ctx);
    expect(bag.auditRows).toHaveLength(0);
    expect(bag.auditTxCalls).toBe(0);
  });

  it('runTool wraps audited tools in auditTx and writes an AuditLog row', async () => {
    const bag = buildMockCtx({ principalName: 'alice' });

    const auditedTool: ToolDefinition<{ id: string }, { ok: boolean }> = {
      name: 'mnela_test_audit',
      description: 'test only',
      scope: 'mcp',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: async (): Promise<{ ok: boolean }> => ({ ok: true }),
      audit: {
        action: 'mcp.test_audit',
        targetType: 'TestTarget',
        targetIdFrom: 'input',
        targetIdPath: 'id',
      },
    };

    const out = await runTool(auditedTool, { id: 'doc_42' }, bag.ctx);
    expect(out).toEqual({ ok: true });
    expect(bag.auditRows).toHaveLength(1);
    expect(bag.auditRows[0]).toMatchObject({
      action: 'mcp.test_audit',
      actor: 'token:alice',
      targetType: 'TestTarget',
      targetId: 'doc_42',
    });
    expect(bag.auditTxCalls).toBe(1);
  });

  it('runTool resolves targetId from output when targetIdFrom=output', async () => {
    const bag = buildMockCtx();

    const tool: ToolDefinition<{ q: string }, { jobId: string }> = {
      name: 'mnela_test_output_target',
      description: 'test',
      scope: 'admin',
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ jobId: z.string() }),
      handler: async (): Promise<{ jobId: string }> => ({ jobId: 'job_99' }),
      audit: {
        action: 'mcp.test_output',
        targetType: 'Job',
        targetIdFrom: 'output',
        targetIdPath: 'jobId',
      },
    };

    await runTool(tool, { q: 'x' }, bag.ctx);
    expect(bag.auditRows[0]?.targetId).toBe('job_99');
  });
});
