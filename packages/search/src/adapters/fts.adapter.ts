import { Prisma } from '@prisma/client';
import type { PrismaProvider } from '@mnela/db';

import { buildFilterClause, paginationSql } from '../sql-helpers.js';
import {
  FTS_LANGUAGE,
  type SearchAdapter,
  type SearchHit,
  type SearchMode,
  type SearchOptions,
  type SearchResult,
} from '../types.js';

interface FtsRow {
  documentId: string;
  title: string;
  snippet: string;
  rank: number;
  total: bigint;
}

export class FtsSearchAdapter implements SearchAdapter {
  readonly mode: SearchMode = 'fts';

  constructor(private readonly getPrisma: PrismaProvider) {}

  async search(opts: SearchOptions): Promise<SearchResult> {
    const params = paginationSql(opts);
    const filter = buildFilterClause(opts.filters);
    const lang = Prisma.raw(`'${FTS_LANGUAGE}'`);

    const rows = await this.getPrisma().$queryRaw<FtsRow[]>(Prisma.sql`
      WITH q AS (
        SELECT websearch_to_tsquery(${lang}, ${opts.query}) AS tsq
      )
      SELECT
        d.id AS "documentId",
        d.title AS "title",
        ts_headline(${lang}, COALESCE(d."rawText", ''), q.tsq,
          'MaxFragments=2,MinWords=8,MaxWords=20,StartSel=<mark>,StopSel=</mark>') AS "snippet",
        ts_rank_cd(d.search_vector, q.tsq) AS "rank",
        COUNT(*) OVER () AS "total"
      FROM "Document" d, q
      WHERE d.search_vector @@ q.tsq
        ${filter}
      ORDER BY "rank" DESC, d."createdAt" DESC
      LIMIT ${params.take} OFFSET ${params.skip}
    `);

    const hits: SearchHit[] = rows.map((r) => ({
      documentId: r.documentId,
      title: r.title,
      snippet: r.snippet,
      score: Number(r.rank),
      ftsRank: Number(r.rank),
    }));

    const total = rows[0]?.total !== undefined ? Number(rows[0].total) : 0;

    return { mode: this.mode, hits, total, page: params.page, limit: params.limit };
  }
}
