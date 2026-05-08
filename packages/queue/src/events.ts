import type { Redis } from 'ioredis';

export const PUBSUB_CHANNEL = 'mnela:events';

/**
 * Event vocabulary mirrors TZ §6 "WebSocket events".
 * The API gateway forwards these verbatim to Socket.io namespace `/live`.
 */

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

// Reserved for Phase 4–5: emitted but never consumed yet.
export interface GraphNodeAddedEvent {
  type: 'graph.node_added';
  payload: { entity: { id: string; name: string; type: string } };
}
export interface GraphEdgeAddedEvent {
  type: 'graph.edge_added';
  payload: { edge: { id: string; fromId: string; toId: string; relationType: string } };
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

export async function publishEvent(redis: Redis, event: MnelaEvent): Promise<number> {
  return redis.publish(PUBSUB_CHANNEL, JSON.stringify(event));
}

export async function subscribeEvents(
  redis: Redis,
  handler: (event: MnelaEvent) => void,
): Promise<void> {
  await redis.subscribe(PUBSUB_CHANNEL);
  redis.on('message', (channel, raw) => {
    if (channel !== PUBSUB_CHANNEL) return;
    try {
      const parsed = JSON.parse(raw) as MnelaEvent;
      handler(parsed);
    } catch {
      // ignore malformed payloads — pubsub is best-effort
    }
  });
}
