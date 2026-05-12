import { runClaude } from '@mnela/claude-runner';
import { readRegistryValue } from '@mnela/core';
import {
  AttachmentRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EntityRepository,
  SystemConfigRepository,
  normalizeEntityName,
} from '@mnela/db';
import { peekSlot, publishEvent, recordEnrichmentCompletion } from '@mnela/queue';
import { Injectable, Logger } from '@nestjs/common';

import { ClaudeStatusService } from '../claude-status/claude-status.service.js';
import { loadEnv, mcpConfigPath, vaultDir } from '../env.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { RedisService } from '../redis.service.js';
import { anthropicApiImageBackend } from './image-analysis/anthropic-api-backend.js';
import {
  type ImageAnalysisBackend,
  type ImageAnalysisInput as BackendInput,
} from './image-analysis/backend.js';
import { claudeCodeImageBackend } from './image-analysis/claude-code-backend.js';
import { enrichmentPromptFor, projectContextRefreshPromptFor } from './prompts.js';

export interface EnrichmentInput {
  dbJobId: string;
  documentId: string;
}

export interface ProjectContextRefreshInput {
  dbJobId: string;
  projectSlug: string;
}

export interface EnrichmentOutcome {
  status: 'enriched' | 'rate-limited' | 'auth-error' | 'skipped' | 'failed';
  addedEntities: number;
  addedEdges: number;
  droppedLowConfidence: number;
  reason?: string;
}

const STRUCTURED_RE = /\{[\s\S]*"addedEntitiesCount"[\s\S]*\}/;

export interface ImageAnalysisInput {
  dbJobId: string;
  attachmentId: string;
}

@Injectable()
export class EnrichmentPipeline {
  private readonly logger = new Logger(EnrichmentPipeline.name);

  constructor(
    private readonly documents: DocumentRepository,
    private readonly attachments: AttachmentRepository,
    private readonly entities: EntityRepository,
    private readonly documentEntities: DocumentEntityRepository,
    private readonly redis: RedisService,
    private readonly claudeStatus: ClaudeStatusService,
    private readonly rateLimit: RateLimitService,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  async run(input: EnrichmentInput): Promise<EnrichmentOutcome> {
    const env = loadEnv();
    const status = await this.claudeStatus.get();
    if (!status.available) {
      this.logger.debug(`skip ${input.documentId}: claude unavailable (${status.reason ?? '?'})`);
      return {
        status: 'skipped',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: status.reason ?? 'unavailable',
      };
    }
    const respectRateLimit = await readRegistryValue<boolean>(
      this.systemConfig,
      'enrichment.respectRateLimit',
    );
    if (respectRateLimit && (await this.rateLimit.isPaused())) {
      return {
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'queue-paused',
      };
    }

    const useSlot = await readRegistryValue<boolean>(this.systemConfig, 'enrichment.useSlot');
    if (useSlot) {
      const slot = await peekSlot(this.redis.client);
      if (slot && slot.owner !== 'enrichment') {
        this.logger.debug(`yielding to ${slot.owner} slot for ${input.documentId}`);
        return {
          status: 'skipped',
          addedEntities: 0,
          addedEdges: 0,
          droppedLowConfidence: 0,
          reason: `slot-held-by-${slot.owner}`,
        };
      }
    }

    await this.documents.update(input.documentId, { status: 'enriching' });
    const startedAtMs = Date.now();
    // The web client already has the title cached from `document.created`
    // (emitted at ingestion time and persisted via cacheSync), so this event
    // can stay slim — payload skips title here. Image analysis below does
    // include filename because that path already loaded the attachment.
    await publishEvent(this.redis.client, {
      type: 'enrichment.document.started',
      payload: {
        jobId: input.dbJobId,
        documentId: input.documentId,
        kind: 'document',
        startedAt: new Date(startedAtMs).toISOString(),
      },
    });

    const finish = async (outcome: EnrichmentOutcome): Promise<EnrichmentOutcome> => {
      const durationMs = Date.now() - startedAtMs;
      const ok = outcome.status === 'enriched';
      await publishEvent(this.redis.client, {
        type: 'enrichment.document.finished',
        payload: {
          jobId: input.dbJobId,
          documentId: input.documentId,
          addedEntities: outcome.addedEntities,
          addedEdges: outcome.addedEdges,
          durationMs,
          ok,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        },
      });
      // Only successful runs count toward p50/ratePerMinute — a failed
      // 30-second Claude crash shouldn't drag the success-time stats up.
      if (ok) {
        await recordEnrichmentCompletion(this.redis.client, {
          jobId: input.dbJobId,
          durationMs,
        }).catch(() => undefined);
      }
      return outcome;
    };

    const result = await runClaude({
      prompt: enrichmentPromptFor(input.documentId),
      mcpConfig: mcpConfigPath(env),
      addDirs: [vaultDir(env)],
      bin: env.MNELA_CLAUDE_BIN,
      timeoutMs: env.MNELA_CLAUDE_TIMEOUT_MS,
      outputFormat: 'stream-json',
      env: {
        DATABASE_URL: env.DATABASE_URL,
        REDIS_URL: env.REDIS_URL,
        MNELA_DATA_DIR: env.MNELA_DATA_DIR,
        MNELA_LOG_LEVEL: env.MNELA_LOG_LEVEL,
      },
    });

    if (result.rateLimitHit) {
      await this.rateLimit.pause(result.rateLimitHit.resetAt);
      const reason = 'rate-limit' as const;
      await this.claudeStatus.set({
        available: false,
        reason,
        checkedAt: new Date().toISOString(),
        ...(result.rateLimitHit.resetAt
          ? { resetAt: result.rateLimitHit.resetAt.toISOString() }
          : {}),
      });
      await this.documents.update(input.documentId, { status: 'parsed' });
      return finish({
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason,
      });
    }

    if (result.authError) {
      await this.claudeStatus.set({
        available: false,
        reason: result.authError === 'invalid-key' ? 'no-binary' : 'not-logged-in',
        checkedAt: new Date().toISOString(),
      });
      await this.documents.update(input.documentId, { status: 'parsed' });
      return finish({
        status: 'auth-error',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: result.authError,
      });
    }

    if (result.exitCode !== 0 || result.timedOut) {
      await this.documents.update(input.documentId, { status: 'failed' });
      return finish({
        status: 'failed',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: result.timedOut ? 'timeout' : `exit ${result.exitCode}`,
      });
    }

    const summary = parseStructured(result.result?.result ?? '');
    await this.documents.update(input.documentId, { status: 'enriched' });
    await publishEvent(this.redis.client, {
      type: 'document.enriched',
      payload: {
        jobId: input.dbJobId,
        documentId: input.documentId,
        addedEntities: summary.addedEntitiesCount,
        addedEdges: summary.addedEdgesCount,
      },
    });

    this.logger.log(
      `enriched ${input.documentId}: +${summary.addedEntitiesCount} entities, +${summary.addedEdgesCount} edges`,
    );

    return finish({
      status: 'enriched',
      addedEntities: summary.addedEntitiesCount,
      addedEdges: summary.addedEdgesCount,
      droppedLowConfidence: summary.droppedLowConfidence,
    });
  }

  /**
   * Project context refresh — Claude reads mnela_get_project_context and
   * writes a fresh contextMd back via mnela_update_project_context. Shares
   * the same Claude availability + rate-limit + slot gates as document
   * enrichment so both task families respect the single Max budget.
   */
  async runProjectContext(input: ProjectContextRefreshInput): Promise<EnrichmentOutcome> {
    const env = loadEnv();
    const status = await this.claudeStatus.get();
    if (!status.available) {
      this.logger.debug(
        `skip project ${input.projectSlug}: claude unavailable (${status.reason ?? '?'})`,
      );
      return {
        status: 'skipped',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: status.reason ?? 'unavailable',
      };
    }
    const respectRateLimit = await readRegistryValue<boolean>(
      this.systemConfig,
      'enrichment.respectRateLimit',
    );
    if (respectRateLimit && (await this.rateLimit.isPaused())) {
      return {
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'queue-paused',
      };
    }
    const useSlot = await readRegistryValue<boolean>(this.systemConfig, 'enrichment.useSlot');
    if (useSlot) {
      const slot = await peekSlot(this.redis.client);
      if (slot && slot.owner !== 'enrichment') {
        return {
          status: 'skipped',
          addedEntities: 0,
          addedEdges: 0,
          droppedLowConfidence: 0,
          reason: `slot-held-by-${slot.owner}`,
        };
      }
    }

    const result = await runClaude({
      prompt: projectContextRefreshPromptFor(input.projectSlug),
      mcpConfig: mcpConfigPath(env),
      addDirs: [vaultDir(env)],
      bin: env.MNELA_CLAUDE_BIN,
      timeoutMs: env.MNELA_CLAUDE_TIMEOUT_MS,
      outputFormat: 'stream-json',
      env: {
        DATABASE_URL: env.DATABASE_URL,
        REDIS_URL: env.REDIS_URL,
        MNELA_DATA_DIR: env.MNELA_DATA_DIR,
        MNELA_LOG_LEVEL: env.MNELA_LOG_LEVEL,
      },
    });

    if (result.rateLimitHit) {
      await this.rateLimit.pause(result.rateLimitHit.resetAt);
      await this.claudeStatus.set({
        available: false,
        reason: 'rate-limit',
        checkedAt: new Date().toISOString(),
        ...(result.rateLimitHit.resetAt
          ? { resetAt: result.rateLimitHit.resetAt.toISOString() }
          : {}),
      });
      return {
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'rate-limit',
      };
    }
    if (result.authError) {
      await this.claudeStatus.set({
        available: false,
        reason: result.authError === 'invalid-key' ? 'no-binary' : 'not-logged-in',
        checkedAt: new Date().toISOString(),
      });
      return {
        status: 'auth-error',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: result.authError,
      };
    }
    if (result.exitCode !== 0 || result.timedOut) {
      return {
        status: 'failed',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: result.timedOut ? 'timeout' : `exit ${result.exitCode}`,
      };
    }

    this.logger.log(`refreshed project context: ${input.projectSlug}`);
    return {
      status: 'enriched',
      addedEntities: 0,
      addedEdges: 0,
      droppedLowConfidence: 0,
    };
  }

  /**
   * Vision pipeline for an image Attachment. Routes through the SystemConfig-
   * selected backend, parses the structured output, and writes
   * Attachment.description / ocrText / analyzedAt + entity links on the
   * companion Document(type=image). Status mapping mirrors `run`:
   * `enriched`/`skipped` → DB Job completed; everything else → failed.
   */
  async runImageAnalysis(input: ImageAnalysisInput): Promise<EnrichmentOutcome> {
    const enabled = await readRegistryValue<boolean>(
      this.systemConfig,
      'attachments.imageAnalysisEnabled',
    );
    if (!enabled) {
      return zeroOutcome('skipped', 'image-analysis-disabled');
    }

    const status = await this.claudeStatus.get();
    if (!status.available) {
      return zeroOutcome('skipped', status.reason ?? 'unavailable');
    }
    const respectRateLimit = await readRegistryValue<boolean>(
      this.systemConfig,
      'enrichment.respectRateLimit',
    );
    if (respectRateLimit && (await this.rateLimit.isPaused())) {
      return zeroOutcome('rate-limited', 'queue-paused');
    }
    const useSlot = await readRegistryValue<boolean>(this.systemConfig, 'enrichment.useSlot');
    if (useSlot) {
      const slot = await peekSlot(this.redis.client);
      if (slot && slot.owner !== 'enrichment') {
        return zeroOutcome('skipped', `slot-held-by-${slot.owner}`);
      }
    }

    const attachment = await this.attachments.findById(input.attachmentId);
    if (!attachment) {
      return zeroOutcome('failed', `attachment ${input.attachmentId} not found`);
    }
    if (!attachment.mimeType.startsWith('image/')) {
      return zeroOutcome('skipped', `not an image (${attachment.mimeType})`);
    }

    const linkedDocumentId = attachment.linkedDocumentId ?? input.attachmentId;
    const startedAtMs = Date.now();
    await publishEvent(this.redis.client, {
      type: 'enrichment.document.started',
      payload: {
        jobId: input.dbJobId,
        documentId: linkedDocumentId,
        title: attachment.filename,
        kind: 'image',
        startedAt: new Date(startedAtMs).toISOString(),
      },
    });
    const finishImage = async (outcome: EnrichmentOutcome): Promise<EnrichmentOutcome> => {
      const durationMs = Date.now() - startedAtMs;
      const ok = outcome.status === 'enriched';
      await publishEvent(this.redis.client, {
        type: 'enrichment.document.finished',
        payload: {
          jobId: input.dbJobId,
          documentId: linkedDocumentId,
          addedEntities: outcome.addedEntities,
          addedEdges: outcome.addedEdges,
          durationMs,
          ok,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        },
      });
      if (ok) {
        await recordEnrichmentCompletion(this.redis.client, {
          jobId: input.dbJobId,
          durationMs,
        }).catch(() => undefined);
      }
      return outcome;
    };

    const backendName = await readRegistryValue<'claude-code' | 'anthropic-api'>(
      this.systemConfig,
      'attachments.imageAnalysisBackend',
    );
    const model = await readRegistryValue<'opus' | 'sonnet' | 'haiku'>(
      this.systemConfig,
      'attachments.imageAnalysisModel',
    );
    const backend: ImageAnalysisBackend =
      backendName === 'anthropic-api' ? anthropicApiImageBackend : claudeCodeImageBackend;

    const backendInput: BackendInput = {
      attachmentPath: attachment.path,
      mimeType: attachment.mimeType,
      documentId: attachment.linkedDocumentId ?? '',
      model,
    };

    const result = await backend.analyze(backendInput);
    if (result.status === 'unavailable') {
      return finishImage(zeroOutcome('skipped', `${backend.name}: ${result.reason}`));
    }
    if (result.status === 'failed') {
      return finishImage(zeroOutcome('failed', `${backend.name}: ${result.reason}`));
    }

    const { output } = result;
    await this.attachments.setAnalysis(input.attachmentId, {
      description: output.description,
      ocrText: output.ocrText,
    });

    let addedEntities = 0;
    let droppedLowConfidence = 0;
    if (attachment.linkedDocumentId) {
      // Flip the image Document from raw -> enriched and seed its body so the
      // /documents detail page and search both surface the description.
      await this.documents.update(attachment.linkedDocumentId, {
        rawText: output.description,
        cleanText: output.description,
        status: 'enriched',
      });

      for (const entity of output.entities) {
        if (entity.confidence < 0.5) {
          droppedLowConfidence += 1;
          continue;
        }
        const normalized = normalizeEntityName(entity.name);
        const existing = await this.entities.findByNormalized(normalized, entity.type);
        const entityId =
          existing?.id ??
          (
            await this.entities.create({
              name: entity.name,
              normalizedName: normalized,
              type: entity.type,
              ...(entity.aliases?.length ? { aliases: entity.aliases } : {}),
            })
          ).id;
        if (!existing) {
          await publishEvent(this.redis.client, {
            type: 'graph.node_added',
            payload: { entity: { id: entityId, name: entity.name, type: entity.type } },
          });
          addedEntities += 1;
        }
        await this.documentEntities.upsert(attachment.linkedDocumentId, entityId, 1);
      }
    }

    await publishEvent(this.redis.client, {
      type: 'document.enriched',
      payload: {
        jobId: input.dbJobId,
        documentId: attachment.linkedDocumentId ?? input.attachmentId,
        addedEntities,
        addedEdges: 0,
      },
    });

    this.logger.log(
      `analyzed image ${input.attachmentId} via ${backend.name}: +${addedEntities} entities, -${droppedLowConfidence} dropped`,
    );

    return finishImage({
      status: 'enriched',
      addedEntities,
      addedEdges: 0,
      droppedLowConfidence,
    });
  }
}

function zeroOutcome(status: EnrichmentOutcome['status'], reason: string): EnrichmentOutcome {
  return {
    status,
    addedEntities: 0,
    addedEdges: 0,
    droppedLowConfidence: 0,
    reason,
  };
}

interface StructuredSummary {
  addedEntitiesCount: number;
  addedEdgesCount: number;
  droppedLowConfidence: number;
  notes?: string;
}

function parseStructured(text: string): StructuredSummary {
  const match = STRUCTURED_RE.exec(text);
  if (!match) {
    return { addedEntitiesCount: 0, addedEdgesCount: 0, droppedLowConfidence: 0 };
  }
  try {
    const obj = JSON.parse(match[0]) as Partial<StructuredSummary>;
    return {
      addedEntitiesCount: Number(obj.addedEntitiesCount ?? 0),
      addedEdgesCount: Number(obj.addedEdgesCount ?? 0),
      droppedLowConfidence: Number(obj.droppedLowConfidence ?? 0),
      ...(obj.notes ? { notes: obj.notes } : {}),
    };
  } catch {
    return { addedEntitiesCount: 0, addedEdgesCount: 0, droppedLowConfidence: 0 };
  }
}
