import { describe, expect, it } from 'vitest';

import { triggerEnrichment } from '../tools/trigger-enrichment.js';
import { buildMockCtx } from './helpers.js';

describe('triggerEnrichment', () => {
  it('creates a Job row and enqueues an EnrichmentJob with retry/backoff', async () => {
    const bag = buildMockCtx();
    const out = await triggerEnrichment({ documentId: 'doc1' }, bag.ctx);
    expect(out.jobId).toBeTruthy();
    expect(bag.jobsCreated).toHaveLength(1);
    expect(bag.jobsCreated[0]?.type).toBe('enrich_document');
    expect(bag.enrichmentJobsAdded).toHaveLength(1);
    const queued = bag.enrichmentJobsAdded[0];
    expect(queued?.data).toEqual({ dbJobId: out.jobId, documentId: 'doc1' });
    expect(queued?.opts?.attempts).toBe(3);
    expect(queued?.opts?.backoff?.type).toBe('exponential');
  });
});
