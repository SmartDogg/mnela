import { describe, expect, it } from 'vitest';

import { rebuildIndex } from '../tools/rebuild-index.js';
import { buildMockCtx } from './helpers.js';

describe('rebuildIndex', () => {
  it('creates a rebuild_index Job and enqueues an IndexingJob', async () => {
    const bag = buildMockCtx();
    const out = await rebuildIndex({}, bag.ctx);
    expect(out.jobId).toBeTruthy();
    expect(bag.jobsCreated).toHaveLength(1);
    expect(bag.jobsCreated[0]?.type).toBe('rebuild_index');
    expect(bag.indexingJobsAdded).toHaveLength(1);
    expect(bag.indexingJobsAdded[0]?.data).toEqual({ dbJobId: out.jobId, scope: 'all' });
  });
});
