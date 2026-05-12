// Mirrors `MnelaEvent` from packages/queue/src/events.ts. Hand-rolled here
// to avoid coupling apps/web to @mnela/queue's runtime deps (ioredis, bullmq).
// Keep this file in lockstep with that union.

export interface JobCreatedEvent {
  type: 'job.created';
  payload: { jobId: string; jobType: string; createdAt: string };
}
export interface JobStartedEvent {
  type: 'job.started';
  payload: { jobId: string; jobType: string; startedAt: string };
}
export interface JobProgressEvent {
  type: 'job.progress';
  payload: { jobId: string; progress: number; message?: string };
}
export interface JobCompletedEvent {
  type: 'job.completed';
  payload: { jobId: string; result?: unknown; completedAt: string };
}
export interface JobFailedEvent {
  type: 'job.failed';
  payload: { jobId: string; error: string; failedAt: string };
}
export type JobEvent =
  | JobCreatedEvent
  | JobStartedEvent
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent;

export interface DocumentCreatedEvent {
  type: 'document.created';
  payload: { jobId: string; documentId: string; status: string; title: string };
}
export interface DocumentParsedEvent {
  type: 'document.parsed';
  payload: { jobId: string; documentId: string; chunkCount: number };
}
export interface DocumentEnrichedEvent {
  type: 'document.enriched';
  payload: { jobId: string; documentId: string; addedEntities: number; addedEdges: number };
}

export interface LiveImportDocument {
  id: string;
  title: string;
  status: string;
  chunkCount?: number;
}
export type DocumentEvent = DocumentCreatedEvent | DocumentParsedEvent | DocumentEnrichedEvent;

export interface GraphEntityLike {
  id: string;
  name: string;
  type: string;
}
export interface GraphEdgeLike {
  id: string;
  fromId: string;
  toId: string;
  relationType: string;
}

export interface GraphNodeAddedEvent {
  type: 'graph.node_added';
  payload: { entity: GraphEntityLike };
}
export interface GraphEdgeAddedEvent {
  type: 'graph.edge_added';
  payload: { edge: GraphEdgeLike };
}
export interface GraphNodeUpdatedEvent {
  type: 'graph.node_updated';
  payload: { entityId: string; changes: Record<string, unknown> };
}
export interface GraphEdgeUpdatedEvent {
  type: 'graph.edge_updated';
  payload: {
    edgeId: string;
    changes: { relationType?: string; status?: string; reviewedBy?: string };
  };
}
export interface GraphEdgeRemovedEvent {
  type: 'graph.edge_removed';
  payload: { edgeId: string };
}
export type GraphEvent =
  | GraphNodeAddedEvent
  | GraphEdgeAddedEvent
  | GraphNodeUpdatedEvent
  | GraphEdgeUpdatedEvent
  | GraphEdgeRemovedEvent;

export interface InboxItemAddedEvent {
  type: 'inbox.item_added';
  payload: { itemId: string; itemType: string; title: string };
}
export interface InboxItemResolvedEvent {
  type: 'inbox.item_resolved';
  payload: {
    itemId: string;
    itemType: string;
    status: 'accepted' | 'rejected';
    resolvedBy: string;
    batchId?: string;
  };
}
export type InboxEvent = InboxItemAddedEvent | InboxItemResolvedEvent;

export interface SystemClaudeStatusChangedEvent {
  type: 'system.claude_status_changed';
  payload: { available: boolean; reason?: string };
}
export type SystemEvent = SystemClaudeStatusChangedEvent;

/**
 * Enrichment-specific live signals. Mirrors `EnrichmentEvent` from
 * packages/queue/src/events.ts. Additive on top of the existing job.* /
 * document.* events; the existing import view keeps working unchanged.
 */
export interface EnrichmentDocumentStartedEvent {
  type: 'enrichment.document.started';
  payload: {
    jobId: string;
    documentId: string;
    title?: string;
    kind: 'document' | 'image' | 'project';
    startedAt: string;
  };
}
export interface EnrichmentDocumentFinishedEvent {
  type: 'enrichment.document.finished';
  payload: {
    jobId: string;
    documentId: string;
    addedEntities: number;
    addedEdges: number;
    durationMs: number;
    ok: boolean;
    reason?: string;
  };
}
export interface EnrichmentQueueTickEvent {
  type: 'enrichment.queue.tick';
  payload: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completedLastHour: number;
    ratePerMinute: number;
    p50DurationMs: number;
    parallelism: number;
    useSlot: boolean;
    slotHolder: 'ask' | 'enrichment' | null;
    paused: boolean;
    userPaused: boolean;
    rateLimitedUntil: string | null;
  };
}
export type EnrichmentEvent =
  | EnrichmentDocumentStartedEvent
  | EnrichmentDocumentFinishedEvent
  | EnrichmentQueueTickEvent;

export type MnelaEvent =
  | JobEvent
  | DocumentEvent
  | GraphEvent
  | InboxEvent
  | SystemEvent
  | EnrichmentEvent;

export type MnelaEventType = MnelaEvent['type'];

export const ALL_EVENT_TYPES: readonly MnelaEventType[] = [
  'job.created',
  'job.started',
  'job.progress',
  'job.completed',
  'job.failed',
  'document.created',
  'document.parsed',
  'document.enriched',
  'graph.node_added',
  'graph.edge_added',
  'graph.node_updated',
  'graph.edge_updated',
  'graph.edge_removed',
  'inbox.item_added',
  'inbox.item_resolved',
  'system.claude_status_changed',
  'enrichment.document.started',
  'enrichment.document.finished',
  'enrichment.queue.tick',
] as const;

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'unavailable';

export interface RecordedEvent {
  ts: number;
  event: MnelaEvent;
}

export interface EventFilter {
  jobId?: string;
  types?: MnelaEventType[];
}
