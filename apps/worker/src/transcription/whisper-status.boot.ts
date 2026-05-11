import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createWhisperClient } from '@mnela/ingestion';

import { loadEnv } from '../env.js';
import { WhisperStatusService } from './whisper-status.service.js';

/**
 * One-shot probe at worker boot. Mirrors apps/orchestrator's claude-status.boot
 * (per ADR-0029 single-source-of-truth pattern): the result lives in Redis and
 * every other subsystem reads through readWhisperStatus().
 *
 * Behaviour:
 *   MNELA_TRANSCRIPTION=disabled → writes { available:false, reason:'not-enabled' }
 *   enabled, container unreachable → writes { available:false, reason:'container-down' }
 *   enabled, healthcheck ok       → writes { available:true, model }
 */
@Injectable()
export class WhisperStatusBoot implements OnModuleInit {
  private readonly logger = new Logger(WhisperStatusBoot.name);

  constructor(private readonly status: WhisperStatusService) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    const checkedAt = new Date().toISOString();
    if (env.MNELA_TRANSCRIPTION === 'disabled') {
      await this.status.set({
        available: false,
        reason: 'not-enabled',
        checkedAt,
        model: env.MNELA_WHISPER_MODEL,
      });
      return;
    }

    const client = createWhisperClient({
      baseUrl: env.WHISPER_URL,
      timeoutMs: 5_000,
    });
    try {
      const health = await client.health();
      if (!health.ok) {
        await this.status.set({
          available: false,
          reason: 'container-down',
          checkedAt,
          model: env.MNELA_WHISPER_MODEL,
        });
        return;
      }
      await this.status.set({
        available: true,
        checkedAt,
        model: env.MNELA_WHISPER_MODEL,
        ...(health.version ? { version: health.version } : {}),
      });
    } catch (err) {
      this.logger.warn(
        `whisper boot probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.status.set({
        available: false,
        reason: 'container-down',
        checkedAt,
        model: env.MNELA_WHISPER_MODEL,
      });
    }
  }
}
