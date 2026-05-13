import { readRegistryValue } from '@mnela/core';
import {
  AttachmentRepository,
  DocumentEntityRepository,
  DocumentRepository,
  EntityRepository,
  SystemConfigRepository,
  normalizeEntityName,
} from '@mnela/db';
import { type ClaudeCliProvider, completeProvider, type LLMProvider } from '@mnela/llm-providers';
import { peekSlot, publishEvent, recordEnrichmentCompletion } from '@mnela/queue';
import { Injectable, Logger } from '@nestjs/common';

import { ClaudeStatusService } from '../claude-status/claude-status.service.js';
import { OrchestratorProvidersService } from '../providers/providers.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { RedisService } from '../redis.service.js';
import {
  parseImageAnalysisOutput,
  IMAGE_ANALYSIS_OUTPUT_INSTRUCTION,
} from './image-analysis/output.js';
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
    private readonly providers: OrchestratorProvidersService,
  ) {}

  async run(input: EnrichmentInput): Promise<EnrichmentOutcome> {
    const provider = await this.providers.resolveForFeature('enrichment');
    const usingCli = provider.config.kind === 'claude_cli';
    if (usingCli) {
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
    if (usingCli && useSlot) {
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
      if (ok) {
        await recordEnrichmentCompletion(this.redis.client, {
          jobId: input.dbJobId,
          durationMs,
        }).catch(() => undefined);
      }
      return outcome;
    };

    const { text, final } = await this.runEnrichmentPrompt(
      provider,
      enrichmentPromptFor(input.documentId),
    );

    if (final.type === 'error' && final.reason === 'rate-limit') {
      if (final.resetAt) await this.rateLimit.pause(final.resetAt);
      if (usingCli) {
        await this.claudeStatus.set({
          available: false,
          reason: 'rate-limit',
          checkedAt: new Date().toISOString(),
          ...(final.resetAt ? { resetAt: final.resetAt.toISOString() } : {}),
        });
      }
      await this.documents.update(input.documentId, { status: 'parsed' });
      return finish({
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'rate-limit',
      });
    }
    if (final.type === 'error' && final.reason === 'auth') {
      if (usingCli) {
        await this.claudeStatus.set({
          available: false,
          reason: 'not-logged-in',
          checkedAt: new Date().toISOString(),
        });
      }
      await this.documents.update(input.documentId, { status: 'parsed' });
      return finish({
        status: 'auth-error',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'auth',
      });
    }
    if (final.type === 'error') {
      await this.documents.update(input.documentId, { status: 'failed' });
      return finish({
        status: 'failed',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: final.message ?? final.reason,
      });
    }

    const summary = parseStructured(text);
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
   * Project context refresh — same provider routing as text enrichment,
   * minus the document.update bookkeeping.
   */
  async runProjectContext(input: ProjectContextRefreshInput): Promise<EnrichmentOutcome> {
    const provider = await this.providers.resolveForFeature('projectContext');
    const usingCli = provider.config.kind === 'claude_cli';
    if (usingCli) {
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
    if (usingCli && useSlot) {
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

    const { final } = await this.runEnrichmentPrompt(
      provider,
      projectContextRefreshPromptFor(input.projectSlug),
    );

    if (final.type === 'error' && final.reason === 'rate-limit') {
      if (final.resetAt) await this.rateLimit.pause(final.resetAt);
      if (usingCli) {
        await this.claudeStatus.set({
          available: false,
          reason: 'rate-limit',
          checkedAt: new Date().toISOString(),
          ...(final.resetAt ? { resetAt: final.resetAt.toISOString() } : {}),
        });
      }
      return {
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'rate-limit',
      };
    }
    if (final.type === 'error' && final.reason === 'auth') {
      if (usingCli) {
        await this.claudeStatus.set({
          available: false,
          reason: 'not-logged-in',
          checkedAt: new Date().toISOString(),
        });
      }
      return {
        status: 'auth-error',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'auth',
      };
    }
    if (final.type === 'error') {
      return {
        status: 'failed',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: final.message ?? final.reason,
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
   * Vision pipeline for an image Attachment. Routes through the
   * SystemConfig-selected provider with a single-turn image+text prompt;
   * parses the structured output, writes Attachment.description / ocrText /
   * analyzedAt + entity links.
   */
  async runImageAnalysis(input: ImageAnalysisInput): Promise<EnrichmentOutcome> {
    const enabled = await readRegistryValue<boolean>(
      this.systemConfig,
      'attachments.imageAnalysisEnabled',
    );
    if (!enabled) {
      return zeroOutcome('skipped', 'image-analysis-disabled');
    }

    const provider = await this.providers.resolveForFeature('vision');
    const usingCli = provider.config.kind === 'claude_cli';
    if (usingCli) {
      const status = await this.claudeStatus.get();
      if (!status.available) {
        return zeroOutcome('skipped', status.reason ?? 'unavailable');
      }
    }
    const respectRateLimit = await readRegistryValue<boolean>(
      this.systemConfig,
      'enrichment.respectRateLimit',
    );
    if (respectRateLimit && (await this.rateLimit.isPaused())) {
      return zeroOutcome('rate-limited', 'queue-paused');
    }
    const useSlot = await readRegistryValue<boolean>(this.systemConfig, 'enrichment.useSlot');
    if (usingCli && useSlot) {
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

    // For the CLI we send the absolute path inline (the CLI's filesystem
    // tool reads it); for API providers we attach the image bytes as a
    // user-message image part — handled by the provider's buildArgs.
    const visionPrompt = buildVisionPrompt({
      attachmentPath: attachment.path,
      mimeType: attachment.mimeType,
      documentId: attachment.linkedDocumentId ?? '',
      includePathInPrompt: usingCli,
    });

    const req: Parameters<LLMProvider['stream']>[0] = {
      messages: [{ role: 'user', content: visionPrompt }],
    };
    if (!usingCli) {
      req.image = { path: attachment.path, mimeType: attachment.mimeType };
    }
    const { text, final } = await completeProvider(provider, req);

    if (final.type === 'error') {
      const reason = final.message ?? final.reason;
      if (
        final.reason === 'rate-limit' ||
        final.reason === 'auth' ||
        final.reason === 'unavailable'
      ) {
        return finishImage(zeroOutcome('skipped', `${provider.config.name}: ${reason}`));
      }
      return finishImage(zeroOutcome('failed', `${provider.config.name}: ${reason}`));
    }

    const output = parseImageAnalysisOutput(text);
    if (!output) return finishImage(zeroOutcome('failed', 'unstructured-output'));

    await this.attachments.setAnalysis(input.attachmentId, {
      description: output.description,
      ocrText: output.ocrText,
    });

    let addedEntities = 0;
    let droppedLowConfidence = 0;
    if (attachment.linkedDocumentId) {
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
      `analyzed image ${input.attachmentId} via ${provider.config.name}: +${addedEntities} entities, -${droppedLowConfidence} dropped`,
    );

    return finishImage({
      status: 'enriched',
      addedEntities,
      addedEdges: 0,
      droppedLowConfidence,
    });
  }

  /**
   * For text enrichment / project-context we drain the provider into a
   * single text answer. The CLI path stays subprocess-based via the
   * provider's `.run()` shortcut to avoid the streaming overhead; API
   * providers go through `stream()` and accumulate.
   */
  private async runEnrichmentPrompt(
    provider: LLMProvider,
    prompt: string,
  ): Promise<{
    text: string;
    final: Parameters<typeof completeProvider>[1] extends infer _
      ? Awaited<ReturnType<typeof completeProvider>>['final']
      : never;
  }> {
    if (provider.config.kind === 'claude_cli') {
      const cli = provider as ClaudeCliProvider;
      const r = await cli.run({ prompt });
      return r;
    }
    return completeProvider(provider, {
      messages: [{ role: 'user', content: prompt }],
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

function buildVisionPrompt(args: {
  attachmentPath: string;
  mimeType: string;
  documentId: string;
  includePathInPrompt: boolean;
}): string {
  const lines: string[] = [
    'You are analyzing an image attachment for the Mnela knowledge graph.',
    '',
  ];
  if (args.includePathInPrompt) {
    lines.push('Read the image at this path:');
    lines.push(`  ${args.attachmentPath}`);
    lines.push(`MIME type: ${args.mimeType}`);
    if (args.documentId) {
      lines.push(
        'Companion Document id (for trace only — DO NOT call any MCP tool, just emit JSON):',
      );
      lines.push(`  ${args.documentId}`);
    }
    lines.push('');
  } else if (args.documentId) {
    lines.push(`Companion Document id (for trace only): ${args.documentId}`);
    lines.push('');
  }
  lines.push(
    'Describe what you see. Extract people, organizations, products, technologies, concepts and any other entities visible. Be conservative: only include an entity if you are reasonably confident it is genuinely depicted (vs. coincidentally pattern-matched).',
  );
  lines.push('');
  lines.push(IMAGE_ANALYSIS_OUTPUT_INSTRUCTION);
  return lines.join('\n');
}
