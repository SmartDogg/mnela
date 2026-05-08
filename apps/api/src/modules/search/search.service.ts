import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@mnela/db';
import {
  FtsSearchAdapter,
  HybridSearchAdapter,
  type SearchAdapter,
  type SearchMode,
  type SearchOptions,
  type SearchResult,
  TrigramSearchAdapter,
} from '@mnela/search';

import { loadEnv } from '../../env.js';

@Injectable()
export class SearchService implements OnModuleInit {
  private fts!: FtsSearchAdapter;
  private trigram!: TrigramSearchAdapter;
  private hybrid!: HybridSearchAdapter;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const env = loadEnv();
    const provider = (): ReturnType<PrismaService['active']> => this.prisma.active();
    this.fts = new FtsSearchAdapter(provider);
    this.trigram = new TrigramSearchAdapter(provider, env.SEARCH_TRIGRAM_THRESHOLD);
    this.hybrid = new HybridSearchAdapter(provider, {
      ftsWeight: env.SEARCH_FTS_WEIGHT,
      trigramWeight: env.SEARCH_TRIGRAM_WEIGHT,
      trigramThreshold: env.SEARCH_TRIGRAM_THRESHOLD,
    });
  }

  search(opts: SearchOptions & { mode: SearchMode }): Promise<SearchResult> {
    return this.adapterFor(opts.mode).search(opts);
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
