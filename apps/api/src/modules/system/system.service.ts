import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService, SystemConfigRepository } from '@mnela/db';
import { type MnelaEvent, publishEvent, subscribeEvents } from '@mnela/queue';
import type { Prisma, SystemConfig } from '@prisma/client';

import { RedisService } from '../../redis.service.js';
import {
  CONFIG_REGISTRY,
  type ConfigSpec,
  resolveConfigValue,
  validateConfigValue,
} from './registry.js';

export interface SystemStats {
  documents: number;
  entities: number;
  edges: number;
  projects: number;
  decisions: number;
  inboxPending: number;
  jobsQueued: number;
  dbSizeBytes: number;
}

/**
 * Merged config entry returned by GET /system/config. The admin UI uses
 * `spec` to pick a control type and validate before saving; `value` is the
 * effective value (default unless overridden); `overridden` lets the UI
 * show a badge + reset-to-default action.
 */
export interface MergedConfigEntry {
  spec: ConfigSpec;
  value: unknown;
  overridden: boolean;
  updatedAt: string | null;
}

export interface ReloadAck {
  service: 'api' | 'worker' | 'orchestrator';
  subscriber: string;
  status: 'ok' | 'error' | 'noop';
  durationMs: number;
  error?: string;
  note?: string;
}

export interface RestartResponse {
  accepted: true;
  requestId: string;
  windowMs: number;
  acks: ReloadAck[];
}

const RELOAD_ACK_WINDOW_MS = 2500;

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configRepo: SystemConfigRepository,
    private readonly redis: RedisService,
  ) {}

  /**
   * Publishes `system.service_reload` on the shared Redis pubsub and
   * collects the per-subscriber `system.service_reload_ack` replies for
   * `RELOAD_ACK_WINDOW_MS` so the /admin/system overlay can render
   * honest "✅ worker.ingestion 240ms / ❌ orchestrator.enrichment
   * timeout / ⚠️ api.throttler noop" instead of a blind 2.5s timer.
   *
   * Subscribers (worker/orchestrator/api ReloadService) reply
   * asynchronously; the window is short on purpose — restart handlers
   * should be quick (close + recreate BullMQ Worker, re-read registry).
   * Anything longer is a bug in the handler, not a reason to wait.
   */
  async requestRestart(reason: string): Promise<RestartResponse> {
    const requestId = randomUUID();
    const subscriber = this.redis.client.duplicate();
    const acks: ReloadAck[] = [];

    await subscriber.connect();
    const ackPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), RELOAD_ACK_WINDOW_MS);
      void subscribeEvents(subscriber, (event: MnelaEvent) => {
        if (event.type !== 'system.service_reload_ack') return;
        if (event.payload.requestId !== requestId) return;
        acks.push({
          service: event.payload.service,
          subscriber: event.payload.subscriber,
          status: event.payload.status,
          durationMs: event.payload.durationMs,
          error: event.payload.error,
          note: event.payload.note,
        });
      }).catch(() => clearTimeout(timer));
    });

    await publishEvent(this.redis.client, {
      type: 'system.service_reload',
      payload: { service: 'all', reason, requestId },
    });
    this.logger.log(`service_reload published (reason=${reason}, requestId=${requestId})`);

    try {
      await ackPromise;
    } finally {
      await subscriber.quit().catch(() => undefined);
    }

    this.logger.log(`service_reload acks received (requestId=${requestId}): ${acks.length}`);
    return { accepted: true, requestId, windowMs: RELOAD_ACK_WINDOW_MS, acks };
  }

  /**
   * Aggregated provider spend over the last 7 / 30 days. The query is
   * raw SQL so we can group by provider+model in one round-trip and
   * dodge Decimal-to-number coercion gotchas — Prisma's
   * `groupBy({ _sum })` returns Decimal objects that don't JSON.stringify
   * cleanly. Null `costUsd` rows (CLI turns, pre-Phase-11 messages) are
   * filtered out so they don't show as `$0.00 unpriced` clutter.
   */
  async costStats(): Promise<{
    last7d: number;
    last30d: number;
    byProvider: { providerId: string | null; model: string | null; costUsd: number }[];
  }> {
    const client = this.prisma.client;
    const rows = await client.$queryRaw<
      { providerId: string | null; model: string | null; sum: string | null }[]
    >`SELECT "providerId", "model", SUM("costUsd")::text AS sum
        FROM "Message"
       WHERE "costUsd" IS NOT NULL
         AND "createdAt" >= NOW() - INTERVAL '30 days'
       GROUP BY "providerId", "model"
       ORDER BY SUM("costUsd") DESC
       LIMIT 50`;
    const totals = await client.$queryRaw<{ last7: string | null; last30: string | null }[]>`
      SELECT
        COALESCE(SUM("costUsd") FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days'),  0)::text AS last7,
        COALESCE(SUM("costUsd") FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days'), 0)::text AS last30
      FROM "Message"
      WHERE "costUsd" IS NOT NULL`;
    return {
      last7d: Number(totals[0]?.last7 ?? 0),
      last30d: Number(totals[0]?.last30 ?? 0),
      byProvider: rows.map((r) => ({
        providerId: r.providerId,
        model: r.model,
        costUsd: Number(r.sum ?? 0),
      })),
    };
  }

  async stats(): Promise<SystemStats> {
    const client = this.prisma.client;
    const [documents, entities, edges, projects, decisions, inboxPending, jobsQueued, sizeRows] =
      await Promise.all([
        client.document.count(),
        client.entity.count(),
        client.edge.count(),
        client.project.count(),
        client.decision.count(),
        client.inboxItem.count({ where: { status: 'pending' } }),
        client.job.count({ where: { status: 'queued' } }),
        client.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
      ]);
    const dbSizeBytes = sizeRows[0]?.size !== undefined ? Number(sizeRows[0].size) : 0;
    return {
      documents,
      entities,
      edges,
      projects,
      decisions,
      inboxPending,
      jobsQueued,
      dbSizeBytes,
    };
  }

  /**
   * List every registered spec merged with its DB override (if any). Keys not
   * present in the registry are skipped — they're treated as stale rows from
   * a prior schema and won't surface in the UI.
   */
  async listConfig(): Promise<MergedConfigEntry[]> {
    const rows = await this.configRepo.list();
    const overrides = new Map(rows.map((r) => [r.key, r]));
    return Object.values(CONFIG_REGISTRY).map((spec) => {
      const row = overrides.get(spec.key);
      const value = resolveConfigValue(spec, row?.value);
      return {
        spec,
        value,
        overridden: row !== undefined,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  /** Strongly-typed reader used by other services (parsers, pipelines, ...). */
  async getConfig<T = unknown>(key: string): Promise<T> {
    const spec = CONFIG_REGISTRY[key];
    if (!spec) throw new Error(`Unknown config key: ${key}`);
    const row = await this.configRepo.get(key);
    return resolveConfigValue(spec, row?.value) as T;
  }

  async setConfig(key: string, value: unknown): Promise<SystemConfig> {
    const spec = CONFIG_REGISTRY[key];
    if (!spec) {
      throw new BadRequestException(`Unknown config key: ${key}`);
    }
    let coerced: unknown;
    try {
      coerced = validateConfigValue(spec, value);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    return this.configRepo.set(key, coerced as Prisma.InputJsonValue);
  }

  /**
   * Drop a DB override so the key falls back to its registry default.
   * Implemented as `delete` rather than `set(default)` so the row's
   * `updatedAt` doesn't tick on every reset and so the UI's overridden
   * badge clears cleanly.
   */
  async resetConfig(key: string): Promise<{ key: string; deleted: boolean }> {
    if (!CONFIG_REGISTRY[key]) {
      throw new BadRequestException(`Unknown config key: ${key}`);
    }
    const deleted = await this.configRepo.delete(key);
    return { key, deleted };
  }
}
