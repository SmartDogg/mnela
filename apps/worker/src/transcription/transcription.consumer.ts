import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
// `ffmpeg-static` is a CommonJS module that default-exports the bundled
// binary path (string) or `null` on unsupported platforms. The dynamic
// import is the cleanest ESM interop on Node 22.
import ffmpegStatic from 'ffmpeg-static';
import { type Redis } from 'ioredis';

import { loadEnv } from '../env.js';
import { RedisService } from '../redis.service.js';
import { ReloadService } from '../reload/reload.service.js';
import { EnrichmentEnqueueService } from '../shared/enrichment-enqueue.service.js';
import { WhisperStatusService } from './whisper-status.service.js';

/**
 * whisper.cpp's HTTP server reads WAV only — when we hand it OGG/OPUS
 * (Telegram voice messages), MP3, M4A etc. it answers 400 with
 * "failed to read audio data as wav". So we pre-decode every non-WAV
 * file to 16 kHz mono PCM-WAV via the bundled ffmpeg binary before
 * shipping. WAV inputs short-circuit and skip the conversion.
 */
const FFMPEG_BIN: string | null = (ffmpegStatic as unknown as string | null) ?? null;
const WAV_MIMES = new Set(['audio/wav', 'audio/wave', 'audio/x-wav']);

function isWavMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return WAV_MIMES.has(mime.toLowerCase());
}

async function convertToWav(srcPath: string): Promise<string> {
  if (!FFMPEG_BIN) {
    throw new Error('ffmpeg-static binary not available on this platform');
  }
  const outPath = path.join(
    tmpdir(),
    `mnela-whisper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-loglevel',
      'error',
      '-y',
      '-i',
      srcPath,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      outPath,
    ];
    const child = spawn(FFMPEG_BIN as string, args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim() || '(no stderr)'}`));
    });
  });
  return outPath;
}

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
    private readonly reload: ReloadService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startWorker();
    this.reload.register('transcription.worker', () => this.restartWorker());
  }

  private async startWorker(): Promise<void> {
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

  private async restartWorker(): Promise<void> {
    this.logger.log('reloading transcription worker');
    await this.shutdown();
    await this.startWorker();
  }

  private async shutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.worker = undefined;
    if (this.bullConnection && this.bullConnection.status !== 'end') {
      await this.bullConnection.quit().catch(() => undefined);
    }
    this.bullConnection = undefined;
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
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

      // whisper.cpp wants WAV. Convert anything else first.
      let inputPath = audioAtt.path;
      let tempWavPath: string | null = null;
      if (!isWavMime(audioAtt.mimeType)) {
        await this.publishProgress(dbJobId, 10, `transcoding ${audioAtt.filename} → wav`);
        try {
          tempWavPath = await convertToWav(audioAtt.path);
          inputPath = tempWavPath;
          this.logger.debug(
            `transcoded ${audioAtt.filename} (${audioAtt.mimeType}) → ${tempWavPath}`,
          );
        } catch (err) {
          throw new Error(
            `ffmpeg failed to decode ${audioAtt.mimeType}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.publishProgress(dbJobId, 20, `calling whisper on ${audioAtt.filename}`);

      // Whisper language + model come from SystemConfig so the user can
      // tune them from /admin/system → Enrichment without redeploying.
      // The model value here is informational metadata (the actual model
      // the whisper container loads is baked at image build time).
      const language = await readRegistryValue<string>(this.systemConfig, 'transcription.language');
      const model = await readRegistryValue<string>(this.systemConfig, 'transcription.model');

      let result;
      try {
        result = await this.whisper.transcribe({
          filePath: inputPath,
          // 'auto' = let whisper detect per file. The whisper.cpp HTTP
          // server treats an empty `language` field as auto-detect.
          language: language === 'auto' ? '' : language,
        });
      } finally {
        if (tempWavPath) {
          await fs.unlink(tempWavPath).catch(() => undefined);
        }
      }

      await bullJob.updateProgress(80);
      await this.publishProgress(dbJobId, 80, `transcribed ${result.text.length} chars`);

      const meta: TranscriptionMetadata = {
        engine: 'whisper.cpp',
        model,
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
        model,
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
