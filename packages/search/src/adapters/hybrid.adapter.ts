import { Prisma } from '@prisma/client';
import type { PrismaProvider } from '@mnela/db';

import { buildFilterClause, paginationSql } from '../sql-helpers.js';
import {
  DEFAULT_HYBRID_CONFIG,
  FTS_LANGUAGE,
  type HybridSearchConfig,
  type SearchAdapter,
  type SearchHit,
  type SearchMode,
  type SearchOptions,
  type SearchResult,
} from '../types.js';

interface HybridRow {
  documentId: string;
  title: string;
  snippet: string | null;
  ftsRank: number;
  trigramSimilarity: number;
  score: number;
  total: bigint;
}

export class HybridSearchAdapter implements SearchAdapter {
  readonly mode: SearchMode = 'hybrid';
  private readonly config: HybridSearchConfig;

  constructor(
    private readonly getPrisma: PrismaProvider,
    config: Partial<HybridSearchConfig> = {},
  ) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
  }

  async search(opts: SearchOptions): Promise<SearchResult> {
    const params = paginationSql(opts);
    const filter = buildFilterClause(opts.filters);
    const lang = Prisma.raw(`'${FTS_LANGUAGE}'`);
    const { ftsWeight, trigramWeight, trigramThreshold } = this.config;

    const rows = await this.getPrisma().$queryRaw<HybridRow[]>(Prisma.sql`
      WITH q AS (
        SELECT websearch_to_tsquery(${lang}, ${opts.query}) AS tsq
      ),
      fts AS (
        SELECT d.id, ts_rank_cd(d.search_vector, q.tsq) AS rank,
               ts_headline(${lang}, COALESCE(d."rawText", ''), q.tsq,
                 'MaxFragments=2,MinWords=8,MaxWords=20,StartSel=<mark>,StopSel=</mark>') AS snippet
        FROM "Document" d, q
        WHERE d.search_vector @@ q.tsq
      ),
      trg AS (
        SELECT d.id, similarity(d.title, ${opts.query}) AS sim
        FROM "Document" d
        WHERE similarity(d.title, ${opts.query}) > ${trigramThreshold}
      )
      SELECT
        d.id AS "documentId",
        d.title AS "title",
        fts.snippet AS "snippet",
        COALESCE(fts.rank, 0)::float AS "ftsRank",
        COALESCE(trg.sim, 0)::float AS "trigramSimilarity",
        (COALESCE(fts.rank, 0) * ${ftsWeight} + COALESCE(trg.sim, 0) * ${trigramWeight})::float AS "score",
        COUNT(*) OVER () AS "total"
      FROM "Document" d
      LEFT JOIN fts ON fts.id = d.id
      LEFT JOIN trg ON trg.id = d.id
      WHERE (fts.rank IS NOT NULL OR trg.sim IS NOT NULL)
        ${filter}
      ORDER BY "score" DESC, d."createdAt" DESC
      LIMIT ${params.take} OFFSET ${params.skip}
    `);

    const hits: SearchHit[] = rows.map((r) => ({
      documentId: r.documentId,
      title: r.title,
      ...(r.snippet ? { snippet: r.snippet } : {}),
      score: Number(r.score),
      ftsRank: Number(r.ftsRank),
      trigramSimilarity: Number(r.trigramSimilarity),
    }));

    const total = rows[0]?.total !== undefined ? Number(rows[0].total) : 0;

    return { mode: this.mode, hits, total, page: params.page, limit: params.limit };
  }
}
