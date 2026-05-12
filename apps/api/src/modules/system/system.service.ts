import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService, SystemConfigRepository } from '@mnela/db';
import type { Prisma, SystemConfig } from '@prisma/client';

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

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configRepo: SystemConfigRepository,
  ) {}

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
