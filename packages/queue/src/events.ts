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
export interface DocumentTranscribedEvent {
  type: 'document.transcribed';
  payload: {
    jobId: string;
    documentId: string;
    language: string;
    durationSec?: number;
    model?: string;
  };
}
export type DocumentEvent =
  | DocumentCreatedEvent
  | DocumentParsedEvent
  | DocumentEnrichedEvent
  | DocumentTranscribedEvent;

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
export interface SystemWhisperStatusChangedEvent {
  type: 'system.whisper_status_changed';
  payload: { available: boolean; reason?: string };
}
/**
 * Telegram config changed — the apps/tg-bot process should re-read
 * TelegramBot.enabled + token and restart its grammY connection. Sent by
 * /admin/telegram on every successful update (ADR-0053).
 */
export interface SystemTelegramReloadEvent {
  type: 'system.telegram_reload';
  payload: { reason: 'config-changed' | 'whitelist-changed' | 'manual' };
}
/**
 * "Restart services" click in /admin/system. Each subsystem that has
 * registry-driven settings flagged `requiresRestart=true` listens for
 * this event and re-bootstraps its workers / pollers in-process (no
 * actual `process.exit` — works the same on docker / systemd / pnpm dev).
 */
export interface SystemServiceReloadEvent {
  type: 'system.service_reload';
  payload: {
    service: 'all' | 'api' | 'worker' | 'orchestrator';
    reason: string;
    requestId: string;
  };
}
/**
 * Reply published by each ReloadService for every registered handler it
 * ran in response to `system.service_reload`. The api collects these for
 * ~2.5s after publishing the reload event so the /admin/system overlay
 * can show real per-subscriber status (✅ worker.ingestion.consumer 240ms,
 * ❌ orchestrator.enrichment.consumer timeout) instead of a blind timer.
 *
 * `requestId` correlates ack ↔ request — multiple Restart Services clicks
 * in quick succession would otherwise interleave their acks.
 */
export interface SystemServiceReloadAckEvent {
  type: 'system.service_reload_ack';
  payload: {
    requestId: string;
    service: 'api' | 'worker' | 'orchestrator';
    subscriber: string;
    status: 'ok' | 'error' | 'noop';
    durationMs: number;
    error?: string;
    note?: string;
  };
}
/**
 * Backup lifecycle frames published by `apps/api/src/modules/system/backups`
 * during a UI-triggered backup. The admin's Backups card subscribes via the
 * existing Socket.io `/live` namespace to render a live progress bar.
 *
 * `jobId` is the cuid generated when the run starts; UI uses it to discard
 * frames from previous (already-done) backups.
 */
export interface BackupStartedEvent {
  type: 'backup.started';
  payload: { jobId: string; startedAt: string };
}
export interface BackupProgressEvent {
  type: 'backup.progress';
  payload: {
    jobId: string;
    stage: 'pg_dump' | 'tar_data' | 'tar_claude' | 'tar_bundle';
    label: string;
  };
}
export interface BackupDoneEvent {
  type: 'backup.done';
  payload: {
    jobId: string;
    filename: string;
    sizeBytes: number;
    durationMs: number;
  };
}
export interface BackupFailedEvent {
  type: 'backup.failed';
  payload: { jobId: string; error: string; durationMs: number };
}
export type SystemEvent =
  | SystemClaudeStatusChangedEvent
  | SystemWhisperStatusChangedEvent
  | SystemTelegramReloadEvent
  | SystemServiceReloadEvent
  | SystemServiceReloadAckEvent
  | BackupStartedEvent
  | BackupProgressEvent
  | BackupDoneEvent
  | BackupFailedEvent;

/**
 * Enrichment-specific live signals. The pipeline already emits
 * `document.enriched` at the end of a run; these add per-doc start markers
 * and a rolling queue-state heartbeat so /jobs and /imports can paint a live
 * "now processing" view without polling. Back-compat with the existing
 * job.* / document.* events is preserved — these are additive.
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
