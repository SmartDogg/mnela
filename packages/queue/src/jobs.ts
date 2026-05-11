/**
 * BullMQ job-data shapes per queue.
 *
 * Job types mirror Prisma enum `JobType` where they overlap:
 *   ingestion → ingest_file, parse_document
 *   enrichment → enrich_document, refresh_project_context
 *   indexing → rebuild_index, export_vault
 *   maintenance → backup, cleanup (cron-driven)
 *   transcription → transcribe_audio
 *
 * Each job carries the matching DB Job row id (`dbJobId`) when one exists,
 * so the worker can sync status back to Postgres.
 */

export type IngestionJobName = 'ingest_file' | 'parse_document';
export type EnrichmentJobName = 'enrich_document' | 'refresh_project_context';
export type IndexingJobName = 'rebuild_index' | 'export_vault';
export type MaintenanceJobName = 'backup' | 'cleanup';
export type TranscriptionJobName = 'transcribe_audio';

export interface IngestFileJob {
  dbJobId: string;
  filePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  contentHash: string;
  origin: 'upload' | 'dropbox' | 'api_ingest';
  importBatchId?: string;
}

export interface ParseDocumentJob {
  dbJobId: string;
  documentId: string;
}

export interface EnrichmentJob {
  dbJobId: string;
  documentId?: string;
  projectSlug?: string;
}

export interface IndexingJob {
  dbJobId: string;
  scope: 'all' | 'document';
  documentId?: string;
}

export interface MaintenanceJob {
  task: 'backup' | 'cleanup';
  triggeredAt: string;
}

export interface TranscribeAudioJob {
  dbJobId: string;
  documentId: string;
}
