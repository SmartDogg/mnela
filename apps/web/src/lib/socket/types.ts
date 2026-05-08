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
  payload: { documentId: string; status: string; title: string };
}
export interface DocumentParsedEvent {
  type: 'document.parsed';
  payload: { documentId: string; chunkCount: number };
}
export interface DocumentEnrichedEvent {
  type: 'document.enriched';
  payload: { documentId: string; addedEntities: number; addedEdges: number };
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
export type GraphEvent = GraphNodeAddedEvent | GraphEdgeAddedEvent | GraphNodeUpdatedEvent;

export interface InboxItemAddedEvent {
  type: 'inbox.item_added';
  payload: { itemId: string; itemType: string; title: string };
}
export type InboxEvent = InboxItemAddedEvent;

export interface SystemClaudeStatusChangedEvent {
  type: 'system.claude_status_changed';
  payload: { available: boolean; reason?: string };
}
export type SystemEvent = SystemClaudeStatusChangedEvent;

export type MnelaEvent = JobEvent | DocumentEvent | GraphEvent | InboxEvent | SystemEvent;

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
  'inbox.item_added',
  'system.claude_status_changed',
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
