import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  AttachmentRepository,
  DocumentRepository,
  EntityRepository,
  JobRepository,
  PrismaService,
  normalizeEntityName,
  type CreateDocumentInput,
} from '@mnela/db';
import {
  type ParseContext,
  type ParsedAttachment,
  type ParsedDocument,
  chunkText,
  countTokens,
  detectLanguage,
  resolveParser,
  sha256Hex,
} from '@mnela/ingestion';
import {
  type IngestFileJob,
  type TranscribeAudioJob,
  createQueueConnection,
  publishEvent,
  QUEUE_NAMES,
  readWhisperStatus,
} from '@mnela/queue';
import { Prisma, type DocumentStatus, type SourceType } from '@prisma/client';
import { Queue, Worker, type Job as BullJob } from 'bullmq';
import { type Redis } from 'ioredis';

import { attachmentsDir, loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';
import { EnrichmentEnqueueService } from '../shared/enrichment-enqueue.service.js';

@Injectable()
export class IngestionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionConsumer.name);
  private worker?: Worker<IngestFileJob>;
  private bullConnection?: Redis;
  private transcriptionQueue?: Queue<TranscribeAudioJob>;
  private transcriptionConnection?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly documents: DocumentRepository,
    private readonly attachments: AttachmentRepository,
    private readonly jobs: JobRepository,
    private readonly entities: EntityRepository,
    private readonly enrichmentEnqueue: EnrichmentEnqueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    // BullMQ requires a dedicated connection because it issues blocking
    // commands (BRPOPLPUSH); sharing with the pubsub-publishing client
    // causes "Connection in subscriber mode" / "already connecting" races.
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.worker = new Worker<IngestFileJob>(
      QUEUE_NAMES[0], // 'ingestion'
      async (bullJob) => this.handleJob(bullJob),
      {
        connection: this.bullConnection,
        concurrency: env.WORKER_INGESTION_CONCURRENCY,
      },
    );

    this.worker.on('failed', (bullJob, err) => {
      this.logger.error(
        `ingestion job ${bullJob?.id ?? '?'} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.transcriptionConnection = createQueueConnection(env.REDIS_URL);
    this.transcriptionQueue = new Queue<TranscribeAudioJob>(QUEUE_NAMES[4], {
      connection: this.transcriptionConnection,
    });

    await this.worker.waitUntilReady();
    this.logger.log(`ingestion worker ready (concurrency=${env.WORKER_INGESTION_CONCURRENCY})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
    await this.transcriptionQueue?.close().catch(() => undefined);
    if (this.transcriptionConnection && this.transcriptionConnection.status !== 'end') {
      await this.transcriptionConnection.quit().catch(() => undefined);
    }
  }

  private async handleJob(bullJob: BullJob<IngestFileJob>): Promise<{
    documentIds: string[];
    duplicates: number;
  }> {
    const data = bullJob.data;
    const { dbJobId } = data;

    await this.markRunning(dbJobId);
    await publishEvent(this.redis.client, {
      type: 'job.started',
      payload: { jobId: dbJobId, jobType: 'ingest_file', startedAt: new Date().toISOString() },
    });

    try {
      const buf = await fs.readFile(data.filePath);
      const baseAttachments = attachmentsDir();
      await fs.mkdir(baseAttachments, { recursive: true });
      const ctx: ParseContext = {
        mimeType: data.mimeType,
        extension: path.extname(data.originalName).toLowerCase(),
        filename: path.basename(data.originalName),
        origin: 'manual_upload',
        workdir: await fs.mkdtemp(path.join(baseAttachments, '.work-')),
      };

      const { parser } = await resolveParser(buf, ctx);
      this.logger.log(`job ${dbJobId}: parser=${parser.name} file=${data.originalName}`);
      await bullJob.updateProgress(5);
      await this.publishProgress(dbJobId, 5, `parser ${parser.name} selected`);

      const parsed = await parser.parse(buf, ctx);
      await bullJob.updateProgress(30);
      await this.publishProgress(dbJobId, 30, `parsed ${parsed.length} document(s)`);

      const documentIds: string[] = [];
      let duplicates = 0;

      const total = parsed.length;
      for (let i = 0; i < parsed.length; i += 1) {
        const doc = parsed[i];
        if (!doc) continue;
        const result = await this.persistDocument(doc, data);
        if (result.duplicate) {
          duplicates += 1;
        } else {
          documentIds.push(result.documentId);
        }
        const pct = 30 + Math.floor(((i + 1) / Math.max(1, total)) * 60);
        await bullJob.updateProgress(pct);
        await this.publishProgress(
          dbJobId,
          pct,
          `${i + 1}/${total} (${duplicates} duplicates so far)`,
        );
      }

      await fs.rm(ctx.workdir, { recursive: true, force: true }).catch(() => undefined);

      const result = { documentIds, duplicates };
      await this.markCompleted(dbJobId, result);
      await bullJob.updateProgress(100);
      await publishEvent(this.redis.client, {
        type: 'job.completed',
        payload: { jobId: dbJobId, result, completedAt: new Date().toISOString() },
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markFailed(dbJobId, message).catch(() => undefined);
      await publishEvent(this.redis.client, {
        type: 'job.failed',
        payload: { jobId: dbJobId, error: message, failedAt: new Date().toISOString() },
      }).catch(() => undefined);
      throw err;
    }
  }

  private async persistDocument(
    doc: ParsedDocument,
    job: IngestFileJob,
  ): Promise<{ documentId: string; duplicate: boolean }> {
    const { dbJobId } = job;
    // Dedup key:
    //   - With a stable sourceId (ChatGPT/Claude conversation uuid) the hash
    //     is sha256(rawText :: source :: sourceId) so the same conversation
    //     re-uploaded inside another archive collapses to one row.
    //   - Without sourceId (markdown/txt/etc) the hash is sha256(rawText)
    //     alone — different filenames around the same body still dedupe.
    const seed = doc.sourceId
      ? `${doc.source}::${doc.sourceId}::${sha256Hex(doc.rawText)}`
      : sha256Hex(doc.rawText);
    const contentHash = sha256Hex(seed);

    const existing = await this.documents.findByContentHash(contentHash);
    if (existing) {
      return { documentId: existing.id, duplicate: true };
    }

    const language = detectLanguage(doc.rawText);
    const tokenCount = doc.rawText ? countTokens(doc.rawText) : 0;
    const status: DocumentStatus = doc.rawText.trim().length > 0 ? 'parsed' : 'raw';
    // Stamp the originating import Job id + batch id into metadata so the
    // /imports/:id/documents endpoint (Phase 4 wire format) and any reverse
    // navigation from a Document back to its import can resolve without a
    // separate join table. Stored under `__import` to avoid colliding with
    // parser-emitted metadata keys.
    const parserMeta = (doc.metadata ?? {}) as Record<string, unknown>;
    const enrichedMeta: Record<string, unknown> = {
      ...parserMeta,
      __import: {
        jobId: dbJobId,
        batchId: job.importBatchId ?? null,
        origin: job.origin,
      },
    };
    const input: CreateDocumentInput = {
      source: doc.source as SourceType,
      sourceId: doc.sourceId ?? null,
      title: doc.title,
      rawText: doc.rawText,
      contentHash,
      tokenCount,
      language,
      type: doc.type ?? null,
      status,
      metadata: enrichedMeta as Prisma.InputJsonValue,
    };

    const created = await this.documents.create(input);

    if (doc.rawText.trim().length > 0) {
      const chunks = chunkText(doc.rawText);
      if (chunks.length > 0) {
        await this.prisma.client.documentChunk.createMany({
          data: chunks.map((c) => ({
            documentId: created.id,
            chunkIndex: c.index,
            text: c.text,
            tokenCount: c.tokenCount,
          })),
        });
      }
      await publishEvent(this.redis.client, {
        type: 'document.parsed',
        payload: { jobId: dbJobId, documentId: created.id, chunkCount: chunks.length },
      });
    }

    if (doc.attachments && doc.attachments.length > 0) {
      await this.persistAttachments(created.id, doc.attachments);
    }

    await publishEvent(this.redis.client, {
      type: 'document.created',
      payload: {
        jobId: dbJobId,
        documentId: created.id,
        status: created.status,
        title: created.title,
      },
    });

    await this.emitGraphEventsForDocument(created.id, created.title, doc.metadata ?? {});

    if (doc.rawText.trim().length > 0) {
      await this.enrichmentEnqueue.maybeEnqueue(created.id);
    } else if (doc.type === 'audio') {
      await this.maybeEnqueueTranscription(created.id);
    }

    return { documentId: created.id, duplicate: false };
  }

  private async maybeEnqueueTranscription(documentId: string): Promise<void> {
    if (!this.transcriptionQueue) return;
    const status = await readWhisperStatus(this.redis.client);
    if (!status.available) {
      this.logger.debug(
        `transcription skipped for ${documentId}: whisper unavailable (${status.reason ?? 'unknown'})`,
      );
      return;
    }
    const dbJob = await this.jobs.create({
      type: 'transcribe_audio',
      payload: { documentId },
      documentId,
    });
    await this.transcriptionQueue.add(
      'transcribe-audio',
      { dbJobId: dbJob.id, documentId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }

  /**
   * Phase 4 pseudo-graph events. The Document itself is emitted as a
   * **live-only synthetic node** (no Entity row — `Edge.fromId/toId` schema
   * forbids it; QUESTIONS.md #14). For parsers that capture project linkage
   * (currently only `claude_export` via `metadata.projectName/projectUuid`),
   * the project is upserted as a real `Entity(type=project)` row and an
   * `id="syn-..."` edge ties the document to it. Phase 5 enrichment will
   * replace the synthetic document nodes with real Entity extraction.
   */
  private async emitGraphEventsForDocument(
    documentId: string,
    title: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await publishEvent(this.redis.client, {
        type: 'graph.node_added',
        payload: { entity: { id: documentId, name: title, type: 'document' } },
      });

      const projectName =
        typeof metadata['projectName'] === 'string' ? metadata['projectName'] : undefined;
      const projectUuid =
        typeof metadata['projectUuid'] === 'string' ? metadata['projectUuid'] : undefined;
      if (!projectName) return;

      const normalized = normalizeEntityName(projectName);
      let projectEntity = await this.entities.findByNormalized(normalized, 'project');
      if (!projectEntity) {
        projectEntity = await this.entities.create({
          name: projectName,
          normalizedName: normalized,
          type: 'project',
          ...(projectUuid ? { metadata: { sourceUuid: projectUuid } } : {}),
        });
        await publishEvent(this.redis.client, {
          type: 'graph.node_added',
          payload: { entity: { id: projectEntity.id, name: projectEntity.name, type: 'project' } },
        });
      }

      await publishEvent(this.redis.client, {
        type: 'graph.edge_added',
        payload: {
          edge: {
            id: `syn-${documentId}-${projectEntity.id}`,
            fromId: documentId,
            toId: projectEntity.id,
            relationType: 'belongs_to',
          },
        },
      });
    } catch (err) {
      // Pseudo-graph emission must never abort ingestion.
      this.logger.warn(
        `graph events for ${documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async persistAttachments(documentId: string, atts: ParsedAttachment[]): Promise<void> {
    const baseDir = attachmentsDir();
    await fs.mkdir(baseDir, { recursive: true });

    for (const att of atts) {
      const buf = await fs.readFile(att.tempPath);
      const hash = sha256Hex(buf);
      const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const finalPath = path.join(baseDir, `${hash.slice(0, 16)}-${safeName}`);
      await fs.copyFile(att.tempPath, finalPath);
      await this.attachments.create({
        documentId,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        path: finalPath,
        contentHash: hash,
        metadata: (att.metadata ?? {}) as Prisma.InputJsonValue,
      });
    }
  }

  private async markRunning(dbJobId: string): Promise<void> {
    await this.jobs.setStatus(dbJobId, 'running').catch(() => undefined);
  }

  private async markCompleted(
    dbJobId: string,
    result: { documentIds: string[]; duplicates: number },
  ): Promise<void> {
    await this.prisma.client.job.update({
      where: { id: dbJobId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async markFailed(dbJobId: string, error: string): Promise<void> {
    await this.prisma.client.job.update({
      where: { id: dbJobId },
      data: { status: 'failed', error, completedAt: new Date() },
    });
  }

  private async publishProgress(jobId: string, progress: number, message: string): Promise<void> {
    await publishEvent(this.redis.client, {
      type: 'job.progress',
      payload: { jobId, progress, message },
    });
  }
}
