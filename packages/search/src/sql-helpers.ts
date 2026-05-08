import { Prisma } from '@prisma/client';

import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  type SearchFilters,
  type SearchOptions,
} from './types.js';

export function buildFilterClause(filters: SearchFilters | undefined): Prisma.Sql {
  if (!filters) return Prisma.empty;
  const parts: Prisma.Sql[] = [];
  if (filters.status) {
    parts.push(Prisma.sql`d."status" = ${filters.status}::"DocumentStatus"`);
  }
  if (filters.source) {
    parts.push(Prisma.sql`d."source" = ${filters.source}::"SourceType"`);
  }
  if (filters.type) {
    parts.push(Prisma.sql`d."type" = ${filters.type}`);
  }
  if (filters.projectSlug) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "DocumentProject" dp JOIN "Project" p ON p.id = dp."projectId" WHERE dp."documentId" = d.id AND p.slug = ${filters.projectSlug})`,
    );
  }
  if (filters.dateFrom) {
    parts.push(Prisma.sql`d."createdAt" >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    parts.push(Prisma.sql`d."createdAt" <= ${filters.dateTo}`);
  }
  if (filters.languages && filters.languages.length > 0) {
    parts.push(Prisma.sql`d."language" = ANY(${filters.languages})`);
  }
  if (parts.length === 0) return Prisma.empty;
  return Prisma.sql`AND (${Prisma.join(parts, ' AND ')})`;
}

export function paginationSql(opts: SearchOptions): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const limit = Math.min(
    MAX_SEARCH_LIMIT,
    Math.max(1, Math.floor(opts.limit ?? DEFAULT_SEARCH_LIMIT)),
  );
  return { skip: (page - 1) * limit, take: limit, page, limit };
}
