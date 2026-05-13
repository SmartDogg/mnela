import { Injectable, OnModuleInit } from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import { PrismaService, SystemConfigRepository } from '@mnela/db';
import {
  FtsSearchAdapter,
  HybridSearchAdapter,
  type SearchAdapter,
  type SearchMode,
  type SearchOptions,
  type SearchResult,
  TrigramSearchAdapter,
} from '@mnela/search';

/**
 * Search blend tuning lives in SystemConfig (`search.*` registry keys);
 * `onModuleInit` reads the live values and rebuilds the adapters. The
 * "Restart services" button on /admin/system re-bootstraps the api so
 * post-toggle adapters reflect the new weights without process-level
 * restart (see ReloadService).
 */
@Injectable()
export class SearchService implements OnModuleInit {
  private fts!: FtsSearchAdapter;
  private trigram!: TrigramSearchAdapter;
  private hybrid!: HybridSearchAdapter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.buildAdapters();
  }

  /** Re-read registry and rebuild the three adapters. Idempotent. */
  async buildAdapters(): Promise<void> {
    const [ftsPct, trigramPct, thresholdPct] = await Promise.all([
      readRegistryValue<number>(this.systemConfig, 'search.fts.weight'),
      readRegistryValue<number>(this.systemConfig, 'search.trigram.weight'),
      readRegistryValue<number>(this.systemConfig, 'search.trigram.threshold'),
    ]);
    // Registry stores integer percentages 0-100; the adapter math expects 0-1.
    const ftsWeight = ftsPct / 100;
    const trigramWeight = trigramPct / 100;
    const trigramThreshold = thresholdPct / 100;
    const provider = (): ReturnType<PrismaService['active']> => this.prisma.active();
    this.fts = new FtsSearchAdapter(provider);
    this.trigram = new TrigramSearchAdapter(provider, trigramThreshold);
    this.hybrid = new HybridSearchAdapter(provider, {
      ftsWeight,
      trigramWeight,
      trigramThreshold,
    });
  }

  search(opts: SearchOptions & { mode: SearchMode }): Promise<SearchResult> {
    return this.adapterFor(opts.mode).search(opts);
  }

  /**
   * FTS-only path used by Ask Brain Dumb Mode fallback (ADR-0029).
   * Hybrid + trigram would require Claude to interpret the results;
   * pure FTS is honest about being keyword-only.
   */
  searchFts(opts: SearchOptions): Promise<SearchResult> {
    return this.fts.search(opts);
  }

  private adapterFor(mode: SearchMode): SearchAdapter {
    switch (mode) {
      case 'fts':
        return this.fts;
      case 'fuzzy':
        return this.trigram;
      case 'hybrid':
        return this.hybrid;
    }
  }
}
