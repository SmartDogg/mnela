import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import {
  AttachmentRepository,
  DocumentRepository,
  JobRepository,
  PrismaService,
  SystemConfigRepository,
} from '@mnela/db';
import { chunkText, countTokens, createWhisperClient, type WhisperClient } from '@mnela/ingestion';
import {
  QUEUE_NAMES,
  type TranscribeAudioJob,
  createQueueConnection,
  publishEvent,
} from '@mnela/queue';
import { Prisma } from '@prisma/client';
import { Worker, type Job as BullJob } from 'bullmq';
import { type Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';
import { EnrichmentEnqueueService } from '../shared/enrichment-enqueue.service.js';
import { WhisperStatusService } from './whisper-status.service.js';

interface TranscriptionMetadata {
  engine: 'whisper.cpp';
  model: string;
  durationSec?: number;
  language: string;
  segments?: { start: number; end: number; text: string }[];
  completedAt: string;
}

@Injectable()
export class TranscriptionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptionConsumer.name);
  private worker?: Worker<TranscribeAudioJob>;
  private bullConnection?: Redis;
  private whisper?: WhisperClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly documents: DocumentRepository,
    private readonly attachments: AttachmentRepository,
    private readonly jobs: JobRepository,
    private readonly status: WhisperStatusService,
    private readonly enrichmentEnqueue: EnrichmentEnqueueService,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.bullConnection = createQueueConnection(env.REDIS_URL);
    this.whisper = createWhisperClient({
      baseUrl: env.WHISPER_URL,
      timeoutMs: env.WHISPER_TIMEOUT_MS,
    });
    const concurrency = await readRegistryValue<number>(
      this.systemConfig,
      'worker.transcription.concurrency',
    );
    this.worker = new Worker<TranscribeAudioJob>(
      QUEUE_NAMES[4],
      async (bullJob) => this.handleJob(bullJob),
      { connection: this.bullConnection, concurrency },
    );
    this.worker.on('failed', (bullJob, err) => {
      this.logger.error(
        `transcription job ${bullJob?.id ?? '?'} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await this.worker.waitUntilReady();
    this.logger.log(`transcription worker ready (concurrency=${concurrency})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
  }

  private async handleJob(bullJob: BullJob<TranscribeAudioJob>): Promise<{
    documentId: string;
    language: string;
    durationSec?: number;
  }> {
    const { dbJobId, documentId } = bullJob.data;
    if (!this.whisper) throw new Error('whisper client not initialized');
    const env = loadEnv();

    await this.markRunning(dbJobId);
    await publishEvent(this.redis.client, {
      type: 'job.started',
      payload: {
        jobId: dbJobId,
        jobType: 'transcribe_audio',
        startedAt: new Date().toISOString(),
      },
    });

    try {
      const whisperStatus = await this.status.get();
      if (!whisperStatus.available) {
        throw new Error(`whisper unavailable: ${whisperStatus.reason ?? 'unknown'}`);
      }

      const doc = await this.documents.findById(documentId);
      if (!doc) throw new Error(`document ${documentId} not found`);
      if (doc.type !== 'audio') {
        throw new Error(`document ${documentId} is not audio (type=${doc.type ?? 'null'})`);
      }

      const atts = await this.attachments.listForDocument(documentId);
      const audioAtt = atts.find((a) => a.mimeType.startsWith('audio/')) ?? atts[0];
      if (!audioAtt) throw new Error(`document ${documentId} has no attachment to transcribe`);

      await bullJob.updateProgress(10);
      await this.publishProgress(dbJobId, 10, `calling whisper on ${audioAtt.filename}`);

      const result = await this.whisper.transcribe({
        filePath: audioAtt.path,
        language: env.MNELA_TRANSCRIPTION_LANGUAGE,
      });

      await bullJob.updateProgress(80);
      await this.publishProgress(dbJobId, 80, `transcribed ${result.text.length} chars`);

      const meta: TranscriptionMetadata = {
        engine: 'whisper.cpp',
        model: env.MNELA_WHISPER_MODEL,
        language: result.language,
        completedAt: new Date().toISOString(),
      };
      if (result.durationSec !== undefined) meta.durationSec = result.durationSec;
      if (result.segments) meta.segments = result.segments;

      const tokenCount = countTokens(result.text);
      const chunks = chunkText(result.text);

      await this.prisma.client.$transaction(async (tx) => {
        const existingMeta =
          doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
            ? (doc.metadata as Record<string, unknown>)
            : {};
        await tx.document.update({
          where: { id: documentId },
          data: {
            rawText: result.text,
            language: result.language,
            tokenCount,
            status: 'parsed',
            metadata: {
              ...existingMeta,
              transcription: meta,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.documentChunk.deleteMany({ where: { documentId } });
        if (chunks.length > 0) {
          await tx.documentChunk.createMany({
            data: chunks.map((c) => ({
              documentId,
              chunkIndex: c.index,
              text: c.text,
              tokenCount: c.tokenCount,
            })),
          });
        }
      });

      const transcribedPayload: {
        jobId: string;
        documentId: string;
        language: string;
        durationSec?: number;
        model?: string;
      } = {
        jobId: dbJobId,
        documentId,
        language: result.language,
        model: env.MNELA_WHISPER_MODEL,
      };
      if (result.durationSec !== undefined) transcribedPayload.durationSec = result.durationSec;
      await publishEvent(this.redis.client, {
        type: 'document.transcribed',
        payload: transcribedPayload,
      });
      await publishEvent(this.redis.client, {
        type: 'document.parsed',
        payload: { jobId: dbJobId, documentId, chunkCount: chunks.length },
      });

      const enrichResult = await this.enrichmentEnqueue.maybeEnqueue(documentId);
      this.logger.log(
        `transcribed ${documentId} (lang=${result.language}, ${result.text.length} chars, enrichment ${enrichResult.enqueued ? 'enqueued' : 'skipped:' + (enrichResult.reason ?? '?')})`,
      );

      const jobResult = {
        documentId,
        language: result.language,
        ...(result.durationSec !== undefined ? { durationSec: result.durationSec } : {}),
      };
      await this.markCompleted(dbJobId, jobResult);
      await bullJob.updateProgress(100);
      await publishEvent(this.redis.client, {
        type: 'job.completed',
        payload: { jobId: dbJobId, result: jobResult, completedAt: new Date().toISOString() },
      });
      return jobResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markFailed(dbJobId, message).catch(() => undefined);
      await publishEvent(this.redis.client, {
        type: 'job.failed',
        payload: { jobId: dbJobId, error: message, failedAt: new Date().toISOString() },
      }).catch(() => undefined);
      // Re-throw so BullMQ honours `attempts` and retries with backoff.
      throw err;
    }
  }

  private async markRunning(dbJobId: string): Promise<void> {
    await this.jobs.setStatus(dbJobId, 'running').catch(() => undefined);
  }

  private async markCompleted(
    dbJobId: string,
    result: { documentId: string; language: string; durationSec?: number },
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
