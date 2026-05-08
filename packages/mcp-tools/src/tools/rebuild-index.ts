import type { McpToolContext } from '../context.js';
import {
  type RebuildIndexInput,
  RebuildIndexInputSchema,
  type RebuildIndexOutput,
  RebuildIndexOutputSchema,
} from '../schemas.js';

export const REBUILD_INDEX_TOOL = {
  name: 'mnela_rebuild_index',
  description: 'Enqueue a full search-index rebuild.',
  scope: 'admin' as const,
  inputSchema: RebuildIndexInputSchema,
  outputSchema: RebuildIndexOutputSchema,
  audit: {
    action: 'mcp.rebuild_index',
    targetType: 'System',
    targetIdFrom: 'output' as const,
    targetIdPath: 'jobId',
  },
};

export async function rebuildIndex(
  _input: RebuildIndexInput,
  ctx: McpToolContext,
): Promise<RebuildIndexOutput> {
  const job = await ctx.jobs.create({
    type: 'rebuild_index',
    payload: { scope: 'all' },
  });
  await ctx.indexingQueue.add('rebuild-index', { dbJobId: job.id, scope: 'all' });
  return { jobId: job.id };
}
