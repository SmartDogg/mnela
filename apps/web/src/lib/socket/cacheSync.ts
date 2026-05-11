import type { QueryClient } from '@tanstack/react-query';

import type { ClaudeStatus, JobSummary } from '@/lib/api/types';

import type {
  JobCompletedEvent,
  JobCreatedEvent,
  JobFailedEvent,
  JobProgressEvent,
  JobStartedEvent,
  LiveImportDocument,
  MnelaEvent,
} from './types';

// Per-event-type cache sync per ADR-0023. Each branch is a no-op when the
// referenced query has not been observed yet — `setQueryData` returns
// undefined in that case and `invalidateQueries` is a cheap broadcast.

export function syncCacheForEvent(qc: QueryClient, event: MnelaEvent): void {
  switch (event.type) {
    case 'job.created':
    case 'job.started':
    case 'job.progress':
    case 'job.completed':
    case 'job.failed': {
      const { jobId } = event.payload;
      qc.setQueryData<JobSummary | undefined>(['jobs', jobId], (old) => mergeJob(old, event));
      qc.setQueryData<JobSummary | undefined>(['imports', jobId], (old) => mergeJob(old, event));
      return;
    }
    case 'document.created': {
      const { jobId, documentId, status, title } = event.payload;
      qc.setQueryData<LiveImportDocument[]>(['imports', jobId, 'documents'], (old) =>
        upsertDocument(old, { id: documentId, status, title }),
      );
      return;
    }
    case 'document.parsed': {
      const { jobId, documentId, chunkCount } = event.payload;
      qc.setQueryData<LiveImportDocument[]>(['imports', jobId, 'documents'], (old) =>
        upsertDocument(old, { id: documentId, chunkCount, status: 'parsed' }),
      );
      return;
    }
    case 'document.enriched': {
      qc.invalidateQueries({ queryKey: ['documents', event.payload.documentId] });
      return;
    }
    case 'graph.node_added':
    case 'graph.edge_added': {
      // Graph stream goes to the Zustand live store; bypass TanStack Query.
      return;
    }
    case 'graph.node_updated': {
      qc.invalidateQueries({ queryKey: ['graph', 'entities', event.payload.entityId] });
      return;
    }
    case 'inbox.item_added': {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      return;
    }
    case 'system.claude_status_changed': {
      qc.setQueryData<ClaudeStatus | undefined>(['system', 'claude-status'], (old) => {
        const reason = event.payload.reason as ClaudeStatus['reason'];
        const next: ClaudeStatus = {
          available: event.payload.available,
          checkedAt: new Date().toISOString(),
          ...(old?.version ? { version: old.version } : {}),
        };
        if (reason) next.reason = reason;
        return next;
      });
      qc.invalidateQueries({ queryKey: ['claude-status'] });
      return;
    }
  }
}

function upsertDocument(
  old: LiveImportDocument[] | undefined,
  patch: Partial<LiveImportDocument> & { id: string },
): LiveImportDocument[] {
  const base = old ?? [];
  const existing = base.find((d) => d.id === patch.id);
  if (!existing) {
    return [...base, { title: '', status: 'raw', ...patch }];
  }
  return base.map((d) => (d.id === patch.id ? { ...d, ...patch } : d));
}

type JobMutationEvent =
  | JobCreatedEvent
  | JobStartedEvent
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent;

function mergeJob(old: JobSummary | undefined, event: JobMutationEvent): JobSummary | undefined {
  if (event.type === 'job.created') {
    if (old) return old;
    return {
      id: event.payload.jobId,
      type: event.payload.jobType as JobSummary['type'],
      status: 'queued',
      priority: 50,
      payload: {},
      result: null,
      error: null,
      documentId: null,
      attempts: 0,
      maxAttempts: 3,
      createdAt: event.payload.createdAt,
      startedAt: null,
      completedAt: null,
      costEstimate: null,
    };
  }
  if (!old) return old;
  switch (event.type) {
    case 'job.started':
      return { ...old, status: 'running', startedAt: event.payload.startedAt };
    case 'job.progress':
      // Progress is a live-only quantity (BullMQ runtime, not DB Job row).
      // Consumers read it directly off the event stream via useLiveEvents.
      return old;
    case 'job.completed':
      return { ...old, status: 'completed', completedAt: event.payload.completedAt };
    case 'job.failed':
      return {
        ...old,
        status: 'failed',
        error: event.payload.error,
        completedAt: event.payload.failedAt,
      };
  }
}
