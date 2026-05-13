import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import {
  AttachmentRepository,
  DocumentRepository,
  EntityRepository,
  JobRepository,
  PrismaService,
  SystemConfigRepository,
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
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    // BullMQ requires a dedicated connection because it issues blocking
    // commands (BRPOPLPUSH); sharing with the pubsub-publishing client
    // causes "Connection in subscriber mode" / "already connecting" races.
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    const concurrency = await readRegistryValue<number>(
      this.systemConfig,
      'worker.ingestion.concurrency',
      env.WORKER_INGESTION_CONCURRENCY,
    );
    this.worker = new Worker<IngestFileJob>(
      QUEUE_NAMES[0], // 'ingestion'
      async (bullJob) => this.handleJob(bullJob),
      {
        connection: this.bullConnection,
        concurrency,
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
    this.logger.log(`ingestion worker ready (concurrency=${concurrency})`);
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
    updated: number;
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
      const documentIds: string[] = [];
      let duplicates = 0;
      let updated = 0;
      let processed = 0;

      // Streaming sink: parsers that handle huge inputs (chatgpt account
      // export) emit one ParsedDocument at a time through this callback so
      // the worker can persist it immediately and the parser doesn't hold
      // every chat + every image in RAM at once. For small-file parsers
      // that return an array instead, we iterate that array below — the
      // logic is identical, just a different delivery channel.
      const persistOne = async (doc: ParsedDocument): Promise<void> => {
        const result = await this.persistDocument(doc, data);
        if (result.action === 'duplicate') {
          duplicates += 1;
        } else {
          // Both "created" and "updated" land in documentIds so the import's
          // file list shows everything this run touched — the user re-imports
          // a monthly archive to see "my latest stuff", not to debug history.
          documentIds.push(result.documentId);
          if (result.action === 'updated') updated += 1;
        }
        processed += 1;
        // Progress is unknown for streaming parsers (total isn't computable
        // up-front), so we report a heartbeat percent that creeps toward
        // but never reaches 95% until parser.parse() returns.
        const pct = Math.min(95, 30 + Math.floor(processed / 20));
        await bullJob.updateProgress(pct);
        await this.publishProgress(
          dbJobId,
          pct,
          `${processed} parsed (${duplicates} unchanged, ${updated} updated)`,
        );
      };

      const ctx: ParseContext = {
        mimeType: data.mimeType,
        extension: path.extname(data.originalName).toLowerCase(),
        filename: path.basename(data.originalName),
        // Caller-supplied SourceType wins (tg-bot=telegram, scripted ingest=
        // api_ingest, etc.). Legacy web uploads stay at the historical
        // `manual_upload` default — same value as before this change.
        origin: data.source ?? 'manual_upload',
        workdir: await fs.mkdtemp(path.join(baseAttachments, '.work-')),
        inputPath: data.filePath,
        onDocument: persistOne,
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
      await this.publishProgress(
        dbJobId,
        30,
        parsed.length > 0
          ? `parsed ${parsed.length} document(s)`
          : `streamed ${processed} document(s) so far`,
      );

      // Parsers that returned an array haven't been streamed yet — persist
      // each one now. Streaming parsers return [] and have already routed
      // each doc through `persistOne` via `ctx.onDocument`.
      for (const doc of parsed) {
        if (doc) await persistOne(doc);
      }

      await fs.rm(ctx.workdir, { recursive: true, force: true }).catch(() => undefined);

      const result = { documentIds, duplicates, updated };
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
  ): Promise<{ documentId: string; action: 'created' | 'updated' | 'duplicate' }> {
    const { dbJobId } = job;
    // Dedup key:
    //   - With a stable sourceId (ChatGPT/Claude conversation uuid) the hash
    //     is sha256(rawText :: source :: sourceId) so the same conversation
    //     re-uploaded inside another archive collapses to one row.
    //   - With non-empty rawText: sha256(rawText) — different filenames
    //     around the same body still dedupe.
    //   - With empty rawText (audio uploaded pre-transcription, photo
    //     pre-vision): seed off the *file* contentHash from the ingest job.
    //     Without this, every empty-rawText doc hashed to the same value and
    //     every audio after the first deduplicated to whichever voice was
    //     uploaded first — distinct recordings silently merged.
    const seed = doc.sourceId
      ? `${doc.source}::${doc.sourceId}::${sha256Hex(doc.rawText)}`
      : doc.rawText.length > 0
        ? sha256Hex(doc.rawText)
        : `${doc.source}::file::${job.contentHash}`;
    const contentHash = sha256Hex(seed);

    // Re-import path: conversation UUIDs (ChatGPT/Claude) are stable across
    // exports, so a chat that gained new messages since the last upload has
    // the SAME sourceId but a DIFFERENT contentHash. Look up by that pair
    // first; if found, either skip (content unchanged) or update in place
    // (content changed). Without this branch, the old contentHash-only check
    // would silently create a duplicate Document on every monthly re-export.
    if (doc.sourceId) {
      const existingBySource = await this.documents.findBySourceAndSourceId(
        doc.source as SourceType,
        doc.sourceId,
      );
      if (existingBySource) {
        if (existingBySource.contentHash === contentHash) {
          // Same chat, same content — skip silently.
          return { documentId: existingBySource.id, action: 'duplicate' };
        }
        // Same chat, content changed (e.g., new messages). Rewrite body +
        // chunks atomically and re-enqueue enrichment so entities/edges
        // catch up to the new text.
        return this.updateDocumentInPlace(existingBySource.id, doc, contentHash, job);
      }
    }

    // No sourceId, or no existing match — fall back to the original hash
    // dedup so markdown/txt re-uploads still collapse byte-identical files.
    const existingByHash = await this.documents.findByContentHash(contentHash);
    if (existingByHash) {
      // Re-send of audio whose transcript never landed (e.g. user shipped
      // the voice before whisper was online): the dedup branch was
      // historically silent so the voice stayed `status='raw'` with empty
      // rawText forever. If Whisper is now available, kick a fresh
      // transcribe_audio job on the existing Document so subsequent /ask
      // calls actually find the text. Idempotent: a no-op when the doc
      // already has transcribed text.
      if (
        existingByHash.type === 'audio' &&
        (!existingByHash.rawText || existingByHash.rawText.trim().length === 0)
      ) {
        await this.maybeEnqueueTranscription(existingByHash.id);
      }
      return { documentId: existingByHash.id, action: 'duplicate' };
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
      await this.persistAttachments(
        created.id,
        doc.attachments,
        doc.source as SourceType,
        job,
        doc.type ?? null,
      );
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

    return { documentId: created.id, action: 'created' };
  }

  /**
   * Atomic in-place refresh for a re-imported chat whose content changed
   * since the last upload. Replaces body + chunks transactionally, stamps
   * the current import job into metadata (so the latest /imports/:id page
   * shows this doc as "touched by this import"), and re-enqueues enrichment
   * because old entity/edge extractions are now stale against the new body.
   */
  private async updateDocumentInPlace(
    documentId: string,
    doc: ParsedDocument,
    contentHash: string,
    job: IngestFileJob,
  ): Promise<{ documentId: string; action: 'updated' }> {
    const { dbJobId } = job;
    const language = detectLanguage(doc.rawText);
    const tokenCount = doc.rawText ? countTokens(doc.rawText) : 0;
    const status: DocumentStatus = doc.rawText.trim().length > 0 ? 'parsed' : 'raw';
    const parserMeta = (doc.metadata ?? {}) as Record<string, unknown>;
    const enrichedMeta: Record<string, unknown> = {
      ...parserMeta,
      __import: {
        jobId: dbJobId,
        batchId: job.importBatchId ?? null,
        origin: job.origin,
      },
    };
    const chunks =
      doc.rawText.trim().length > 0
        ? chunkText(doc.rawText).map((c) => ({
            chunkIndex: c.index,
            text: c.text,
            tokenCount: c.tokenCount,
          }))
        : [];

    const updated = await this.documents.replaceContent(documentId, {
      rawText: doc.rawText,
      contentHash,
      tokenCount,
      language,
      title: doc.title,
      type: doc.type ?? null,
      status,
      metadata: enrichedMeta as Prisma.InputJsonValue,
      chunks,
    });

    // The web Zustand store + cacheSync handle `document.created` by
    // upserting by id, so re-emitting refreshes the title / status / chunk
    // count for any open /imports page without needing a new event type.
    await publishEvent(this.redis.client, {
      type: 'document.created',
      payload: {
        jobId: dbJobId,
        documentId: updated.id,
        status: updated.status,
        title: updated.title,
      },
    });
    if (chunks.length > 0) {
      await publishEvent(this.redis.client, {
        type: 'document.parsed',
        payload: { jobId: dbJobId, documentId: updated.id, chunkCount: chunks.length },
      });
    }

    if (doc.rawText.trim().length > 0) {
      // Re-enqueue enrichment so the new text gets analysed. The previous
      // DocumentEntity links survive — Claude will upsert by normalized name,
      // so genuinely-still-mentioned entities re-attach and new ones land.
      await this.enrichmentEnqueue.maybeEnqueue(updated.id);
    }

    this.logger.log(`updated ${updated.id} (${doc.sourceId ?? '?'}) on re-import`);
    return { documentId: updated.id, action: 'updated' };
  }

  private async maybeEnqueueTranscription(documentId: string): Promise<void> {
    if (!this.transcriptionQueue) return;
    // Live registry read: toggling transcription.enabled in /admin/system
    // takes effect on the very next ingest — no worker restart required.
    // The boot-time WhisperStatusBoot probe is just for the UI badge.
    const enabled = await readRegistryValue<boolean>(this.systemConfig, 'transcription.enabled');
    if (!enabled) {
      this.logger.debug(`transcription skipped for ${documentId}: transcription.enabled=false`);
      return;
    }
    // The Whisper container may still be physically unreachable; the
    // transcribe_audio consumer surfaces that as a clear job failure when
    // it fires. We deliberately don't gate on whisper-status here so a
    // user who just enabled transcription gets their pending audio
    // queued without first having to manually refresh the status badge.
    const dbJob = await this.jobs.create({
      type: 'transcribe_audio',
      payload: { documentId },
      documentId,
    });
    const attempts = await readRegistryValue<number>(
      this.systemConfig,
      'worker.transcription.attempts',
    );
    const delay = await readRegistryValue<number>(
      this.systemConfig,
      'worker.transcription.backoffMs',
    );
    await this.transcriptionQueue.add(
      'transcribe-audio',
      { dbJobId: dbJob.id, documentId },
      {
        attempts,
        backoff: { type: 'exponential', delay },
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
    parentDocType: string | null,
  ): Promise<void> {
    const baseDir = attachmentsDir();
    await fs.mkdir(baseDir, { recursive: true });

    // When the parent Document is itself type='image' (i.e. produced by
    // imageParser for standalone uploads, or by the account-export parser
    // emitting one Doc per image), the parent IS the image's first-class
    // representation — we just link the Attachment back to it and skip
    // promotion. Otherwise (chat docs with embedded images) we create a
    // companion image Document so /documents lists images separately.
    const parentIsImageDoc = parentDocType === 'image';

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

      if (att.mimeType.startsWith('image/')) {
        if (parentIsImageDoc) {
          // Parent IS the image-doc — point linkedDocumentId back to it and
          // enqueue analysis directly without spawning a second Document.
          await this.prisma.client.attachment.update({
            where: { id: attachment.id },
            data: { linkedDocumentId: parentDocumentId },
          });
          await this.enrichmentEnqueue.maybeEnqueueImage(attachment.id, parentDocumentId);
        } else {
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

    // Bridge the new Attachment row → image Document.
    await this.prisma.client.attachment.update({
      where: { id: args.attachmentId },
      data: { linkedDocumentId: imageDocId },
    });

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
    result: { documentIds: string[]; duplicates: number; updated: number },
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
