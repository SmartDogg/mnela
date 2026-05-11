import { runClaude } from '@mnela/claude-runner';
import { DocumentRepository } from '@mnela/db';
import { peekSlot, publishEvent } from '@mnela/queue';
import { Injectable, Logger } from '@nestjs/common';

import { ClaudeStatusService } from '../claude-status/claude-status.service.js';
import { loadEnv, mcpConfigPath, vaultDir } from '../env.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { RedisService } from '../redis.service.js';
import { enrichmentPromptFor } from './prompts.js';

export interface EnrichmentInput {
  dbJobId: string;
  documentId: string;
}

export interface EnrichmentOutcome {
  status: 'enriched' | 'rate-limited' | 'auth-error' | 'skipped' | 'failed';
  addedEntities: number;
  addedEdges: number;
  droppedLowConfidence: number;
  reason?: string;
}

const STRUCTURED_RE = /\{[\s\S]*"addedEntitiesCount"[\s\S]*\}/;

@Injectable()
export class EnrichmentPipeline {
  private readonly logger = new Logger(EnrichmentPipeline.name);

  constructor(
    private readonly documents: DocumentRepository,
    private readonly redis: RedisService,
    private readonly claudeStatus: ClaudeStatusService,
    private readonly rateLimit: RateLimitService,
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
    if (await this.rateLimit.isPaused()) {
      return {
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: 'queue-paused',
      };
    }

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

    await this.documents.update(input.documentId, { status: 'enriching' });

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
      return {
        status: 'rate-limited',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason,
      };
    }

    if (result.authError) {
      await this.claudeStatus.set({
        available: false,
        reason: result.authError === 'invalid-key' ? 'no-binary' : 'not-logged-in',
        checkedAt: new Date().toISOString(),
      });
      await this.documents.update(input.documentId, { status: 'parsed' });
      return {
        status: 'auth-error',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: result.authError,
      };
    }

    if (result.exitCode !== 0 || result.timedOut) {
      await this.documents.update(input.documentId, { status: 'failed' });
      return {
        status: 'failed',
        addedEntities: 0,
        addedEdges: 0,
        droppedLowConfidence: 0,
        reason: result.timedOut ? 'timeout' : `exit ${result.exitCode}`,
      };
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

    return {
      status: 'enriched',
      addedEntities: summary.addedEntitiesCount,
      addedEdges: summary.addedEdgesCount,
      droppedLowConfidence: summary.droppedLowConfidence,
    };
  }
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
