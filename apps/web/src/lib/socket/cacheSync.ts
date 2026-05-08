import type { QueryClient } from '@tanstack/react-query';

import type { ClaudeStatus, JobSummary } from '@/lib/api/types';

import type {
  JobCompletedEvent,
  JobCreatedEvent,
  JobFailedEvent,
  JobProgressEvent,
  JobStartedEvent,
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
    case 'document.created':
    case 'document.parsed': {
      // The wire payload does not carry the originating jobId, so we can't
      // target a single ['imports', jobId, 'documents'] cache. Broadcast an
      // invalidation under that prefix; TanStack Query will refetch only the
      // queries currently mounted.
      qc.invalidateQueries({ queryKey: ['imports'], predicate: hasDocumentsLeaf });
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
      const next: ClaudeStatus = {
        available: event.payload.available,
        reason: event.payload.reason ?? '',
        message: '',
      };
      qc.setQueryData<ClaudeStatus>(['system', 'claude-status'], next);
      return;
    }
  }
}

function hasDocumentsLeaf({ queryKey }: { queryKey: readonly unknown[] }): boolean {
  return queryKey[0] === 'imports' && queryKey[queryKey.length - 1] === 'documents';
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
      payload: {},
      progress: 0,
      total: null,
      error: null,
      createdAt: event.payload.createdAt,
      updatedAt: event.payload.createdAt,
      startedAt: null,
      completedAt: null,
    };
  }
  if (!old) return old;
  switch (event.type) {
    case 'job.started':
      return {
        ...old,
        status: 'running',
        startedAt: event.payload.startedAt,
        updatedAt: event.payload.startedAt,
      };
    case 'job.progress':
      return { ...old, progress: event.payload.progress };
    case 'job.completed':
      return {
        ...old,
        status: 'completed',
        completedAt: event.payload.completedAt,
        updatedAt: event.payload.completedAt,
      };
    case 'job.failed':
      return {
        ...old,
        status: 'failed',
        error: event.payload.error,
        updatedAt: event.payload.failedAt,
      };
  }
}
