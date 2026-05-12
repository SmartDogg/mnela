'use client';

import { PageHeader } from '@/components/page-header';

import { EnrichmentSection } from './_components/EnrichmentSection';
import { FailedJobs } from './_components/FailedJobs';
import { OtherJobs } from './_components/OtherJobs';
import { StatsPanel } from './_components/StatsPanel';
import { useEnrichmentQueueState } from './_components/useEnrichmentQueueState';

/**
 * Single home for everything queue-related that's NOT tied to a specific
 * import. The per-import live view stays at /imports/:id (extended in this
 * change with an Enrichment-phase strip); this page covers:
 *
 *   - Enrichment queue live view (counters, ETA, in-flight docs, pause)
 *   - Other job types (MCP, transcription, refresh, …)
 *   - Failed jobs with retry — collapsed when count is 0
 *   - Stats panel — collapsed by default; lazy-loaded
 *
 * The old /admin/jobs metrics page redirects here.
 */
export default function JobsPage(): JSX.Element {
  const queue = useEnrichmentQueueState();
  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="Background work happening outside of a specific import — enrichment, MCP, transcription."
      />
      <div className="space-y-3 px-8 py-6">
        <EnrichmentSection state={queue.data} isLoading={queue.isLoading} />
        <OtherJobs />
        <FailedJobs />
        <StatsPanel />
      </div>
    </div>
  );
}
