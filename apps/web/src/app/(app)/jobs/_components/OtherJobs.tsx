'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { JobStatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { jobLastActivityAt, type JobSummary, type Paginated } from '@/lib/api/types';
import { relativeTime } from '@/lib/utils';

const REFRESH_MS = 5_000;
// Enrichment jobs render in the EnrichmentSection live view above; this list
// covers everything else (MCP work, transcription, refresh_project_context,
// rebuild_index, export_vault, …).
const ENRICHMENT_TYPES = new Set([
  'enrich_document',
  'refresh_project_context',
  'analyze_attachment',
]);

/**
 * Compact list of non-enrichment jobs. Shows the most-recent N (active +
 * historical) grouped just enough to scan: type, status badge, when. Keeps
 * /jobs useful for MCP/chat/transcription work that has no /imports/:id home.
 */
export function OtherJobs(): JSX.Element {
  const query = useQuery({
    queryKey: ['jobs', 'list', 'other'],
    queryFn: () => api.get<Paginated<JobSummary>>('/jobs', { query: { page: 1, limit: 30 } }),
    refetchInterval: REFRESH_MS,
  });

  const items = (query.data?.items ?? []).filter((j) => !ENRICHMENT_TYPES.has(j.type));

  return (
    <section className="rounded-md border bg-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Other jobs
        </h2>
        {query.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />}
      </div>
      {query.isLoading && <Skeleton className="h-16 w-full" />}
      {!query.isLoading && items.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No recent non-enrichment jobs. Anything from MCP, transcription, or maintenance will show
          here.
        </p>
      )}
      {items.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {items.map((job) => (
            <li
              key={job.id}
              className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/30"
            >
              <span className="w-44 shrink-0 truncate font-mono text-[11px]">{job.type}</span>
              <JobStatusBadge status={job.status} />
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {relativeTime(jobLastActivityAt(job))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
