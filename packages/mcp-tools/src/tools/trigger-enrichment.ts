import type { McpToolContext } from '../context.js';
import {
  type TriggerEnrichmentInput,
  TriggerEnrichmentInputSchema,
  type TriggerEnrichmentOutput,
  TriggerEnrichmentOutputSchema,
} from '../schemas.js';

export const TRIGGER_ENRICHMENT_TOOL = {
  name: 'mnela_trigger_enrichment',
  description: 'Manually enqueue a document for Claude enrichment.',
  scope: 'admin' as const,
  inputSchema: TriggerEnrichmentInputSchema,
  outputSchema: TriggerEnrichmentOutputSchema,
  audit: {
    action: 'mcp.trigger_enrichment',
    targetType: 'Document',
    targetIdFrom: 'input' as const,
    targetIdPath: 'documentId',
  },
};

export async function triggerEnrichment(
  input: TriggerEnrichmentInput,
  ctx: McpToolContext,
): Promise<TriggerEnrichmentOutput> {
  const job = await ctx.jobs.create({
    type: 'enrich_document',
    payload: { documentId: input.documentId },
    documentId: input.documentId,
  });
  await ctx.enrichmentQueue.add(
    'enrich-document',
    { dbJobId: job.id, documentId: input.documentId },
    { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  );
  return { jobId: job.id };
}
