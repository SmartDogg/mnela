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
      // Only the first 64 KiB are needed for magic-byte / format detection.
      // Parsers that handle multi-GB ZIPs read entries through `ctx.inputPath`
      // (yauzl.open) instead of the buffer — see ADR-0048. For small files
      // (text/markdown/image), the parser still receives the full buffer.
      const headBuf = await readHead(data.filePath, 64 * 1024);
      const baseAttachments = attachmentsDir();
      await fs.mkdir(baseAttachments, { recursive: true });
      const ctx: ParseContext = {
        mimeType: data.mimeType,
        extension: path.extname(data.originalName).toLowerCase(),
        filename: path.basename(data.originalName),
        origin: 'manual_upload',
        workdir: await fs.mkdtemp(path.join(baseAttachments, '.work-')),
        inputPath: data.filePath,
      };

      const { parser } = await resolveParser(headBuf, ctx);
      this.logger.log(`job ${dbJobId}: parser=${parser.name} file=${data.originalName}`);
      await bullJob.updateProgress(5);
      await this.publishProgress(dbJobId, 5, `parser ${parser.name} selected`);

      // Parsers that need the full body (small files: txt/md/html/json/csv/
      // docx/pdf/image) read it now. ZIP-flavoured parsers (chatgpt/claude)
      // ignore `buf` when `ctx.inputPath` is set.
      const needsFullBody = parser.name !== 'chatgpt' && parser.name !== 'claude';
      const buf = needsFullBody ? await fs.readFile(data.filePath) : headBuf;
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
      await this.persistAttachments(created.id, doc.attachments, doc.source as SourceType, job);
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

  private async persistAttachments(
    parentDocumentId: string,
    atts: ParsedAttachment[],
    parentSource: SourceType,
    job: IngestFileJob,
  ): Promise<void> {
    const baseDir = attachmentsDir();
    await fs.mkdir(baseDir, { recursive: true });

    for (const att of atts) {
      const hash = await streamingSha256(att.tempPath);
      const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const finalPath = path.join(baseDir, `${hash.slice(0, 16)}-${safeName}`);
      await fs.copyFile(att.tempPath, finalPath);

      const attachment = await this.attachments.create({
        documentId: parentDocumentId,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        path: finalPath,
        contentHash: hash,
        metadata: (att.metadata ?? {}) as Prisma.InputJsonValue,
      });

      // Images become first-class Documents so /documents lists them
      // separately and the gallery on /documents/:id can render
      // description + entity links. Audio/PDF/etc stay as plain
      // Attachments — promotion is image-only by design.
      if (att.mimeType.startsWith('image/')) {
        await this.promoteImageToDocument({
          attachmentId: attachment.id,
          parentDocumentId,
          parentSource,
          filename: att.filename,
          contentHash: hash,
          mimeType: att.mimeType,
          attachmentMeta: (att.metadata ?? {}) as Record<string, unknown>,
          job,
        });
      }
    }
  }

  /**
   * Create a Document(type=image, status='raw') companion for an image
   * attachment, link it back via Attachment.linkedDocumentId, and emit live
   * graph events tying it to its parent. Idempotent via contentHash:
   * re-uploading the same image collapses to the existing Document.
   */
  private async promoteImageToDocument(args: {
    attachmentId: string;
    parentDocumentId: string;
    parentSource: SourceType;
    filename: string;
    contentHash: string;
    mimeType: string;
    attachmentMeta: Record<string, unknown>;
    job: IngestFileJob;
  }): Promise<string | null> {
    const promotedHash = sha256Hex(`image::${args.contentHash}`);
    const existing = await this.documents.findByContentHash(promotedHash);

    let imageDocId: string;
    if (existing) {
      imageDocId = existing.id;
    } else {
      const created = await this.documents.create({
        source: args.parentSource,
        sourceId: `attachment::${args.attachmentId}`,
        title: args.filename,
        rawText: '',
        contentHash: promotedHash,
        tokenCount: 0,
        type: 'image',
        status: 'raw',
        metadata: {
          ...args.attachmentMeta,
          __image: {
            attachmentId: args.attachmentId,
            parentDocumentId: args.parentDocumentId,
            mimeType: args.mimeType,
          },
          __import: {
            jobId: args.job.dbJobId,
            batchId: args.job.importBatchId ?? null,
            origin: args.job.origin,
          },
        } as Prisma.InputJsonValue,
      });
      imageDocId = created.id;
      await publishEvent(this.redis.client, {
        type: 'document.created',
        payload: {
          jobId: args.job.dbJobId,
          documentId: imageDocId,
          status: 'raw',
          title: args.filename,
        },
      });
    }

    // Bridge the new Attachment row → image Document. Raw SQL because the
    // Prisma client TS types haven't regenerated yet in this branch (the
    // dev-server holds the .dll on Windows). Drop to typed update once the
    // user restarts the server.
    await this.prisma.client.$executeRawUnsafe(
      `UPDATE "Attachment" SET "linkedDocumentId" = $1 WHERE id = $2`,
      imageDocId,
      args.attachmentId,
    );

    // Synthetic graph wiring: image-doc node + edge `derived_from` chat-doc.
    await publishEvent(this.redis.client, {
      type: 'graph.node_added',
      payload: { entity: { id: imageDocId, name: args.filename, type: 'document' } },
    });
    await publishEvent(this.redis.client, {
      type: 'graph.edge_added',
      payload: {
        edge: {
          id: `syn-img-${imageDocId}-${args.parentDocumentId}`,
          fromId: imageDocId,
          toId: args.parentDocumentId,
          relationType: 'derived_from',
        },
      },
    });

    // Queue the vision pass — orchestrator gates on SystemConfig at consume
    // time, so we don't need to check the toggles here. maybeEnqueueImage
    // already short-circuits when Claude is unavailable.
    await this.enrichmentEnqueue.maybeEnqueueImage(args.attachmentId, imageDocId);

    return imageDocId;
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

/** Read the first N bytes of a file without materializing the rest in RAM. */
async function readHead(filePath: string, bytes: number): Promise<Buffer> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** Streaming sha256 over a file — same shape as the API helper. */
async function streamingSha256(filePath: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.once('end', () => resolve(hash.digest('hex')));
    stream.once('error', reject);
  });
}
