import { Prisma } from '@prisma/client';
import type { PrismaProvider } from '@mnela/db';

import { buildFilterClause, paginationSql } from '../sql-helpers.js';
import {
  type SearchAdapter,
  type SearchHit,
  type SearchMode,
  type SearchOptions,
  type SearchResult,
} from '../types.js';

interface TrigramRow {
  documentId: string;
  title: string;
  similarity: number;
  total: bigint;
}

export class TrigramSearchAdapter implements SearchAdapter {
  readonly mode: SearchMode = 'fuzzy';

  constructor(
    private readonly getPrisma: PrismaProvider,
    private readonly threshold = 0.3,
  ) {}

  async search(opts: SearchOptions): Promise<SearchResult> {
    const params = paginationSql(opts);
    const filter = buildFilterClause(opts.filters);

    const rows = await this.getPrisma().$queryRaw<TrigramRow[]>(Prisma.sql`
      SELECT
        d.id AS "documentId",
        d.title AS "title",
        similarity(d.title, ${opts.query}) AS "similarity",
        COUNT(*) OVER () AS "total"
      FROM "Document" d
      WHERE similarity(d.title, ${opts.query}) > ${this.threshold}
        ${filter}
      ORDER BY "similarity" DESC, d."createdAt" DESC
      LIMIT ${params.take} OFFSET ${params.skip}
    `);

    const hits: SearchHit[] = rows.map((r) => ({
      documentId: r.documentId,
      title: r.title,
      score: Number(r.similarity),
      trigramSimilarity: Number(r.similarity),
    }));

    const total = rows[0]?.total !== undefined ? Number(rows[0].total) : 0;

    return { mode: this.mode, hits, total, page: params.page, limit: params.limit };
  }
}
