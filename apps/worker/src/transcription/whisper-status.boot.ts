import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import { SystemConfigRepository } from '@mnela/db';
import { createWhisperClient } from '@mnela/ingestion';

import { loadEnv } from '../env.js';
import { ReloadService } from '../reload/reload.service.js';
import { WhisperStatusService } from './whisper-status.service.js';

/**
 * One-shot probe at worker boot. Mirrors apps/orchestrator's claude-status.boot
 * (per ADR-0029 single-source-of-truth pattern): the result lives in Redis and
 * every other subsystem reads through readWhisperStatus().
 *
 * Behaviour:
 *   transcription.enabled=false (registry) → writes { available:false, reason:'not-enabled' }
 *   enabled, container unreachable          → writes { available:false, reason:'container-down' }
 *   enabled, healthcheck ok                 → writes { available:true, model }
 *
 * The boot probe is one-shot; the ingestion consumer ALSO re-reads
 * `transcription.enabled` directly from SystemConfig on every upload, so
 * toggling the flag in /admin/system takes effect on the next ingest
 * without restarting the worker. The status row above is what the UI
 * reads to render a green/red badge.
 */
@Injectable()
export class WhisperStatusBoot implements OnModuleInit {
  private readonly logger = new Logger(WhisperStatusBoot.name);

  constructor(
    private readonly status: WhisperStatusService,
    private readonly systemConfig: SystemConfigRepository,
    private readonly reload: ReloadService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.probe();
    this.reload.register('whisper.status', () => this.probe());
  }

  /** Re-probes whisper.cpp and writes the result to the shared status. */
  private async probe(): Promise<void> {
    const env = loadEnv();
    const checkedAt = new Date().toISOString();
    const enabled = await readRegistryValue<boolean>(this.systemConfig, 'transcription.enabled');
    const model = await readRegistryValue<string>(this.systemConfig, 'transcription.model');
    if (!enabled) {
      await this.status.set({
        available: false,
        reason: 'not-enabled',
        checkedAt,
        model,
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
          model,
        });
        return;
      }
      await this.status.set({
        available: true,
        checkedAt,
        model,
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
        model,
      });
    }
  }
}
