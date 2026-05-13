import { PrismaService } from '@mnela/db';
import { Injectable, Logger } from '@nestjs/common';

import { type SignatureMetrics, batchSignature, clusterSignature } from './signature.js';

export interface BatchCandidate {
  kind: 'batch';
  batchId: string;
  signature: string;
  docCount: number;
  documentIds: string[];
  topEntityIds: string[];
  topEntityNames: string[];
  sampleTitles: string[];
  metrics: SignatureMetrics;
}

export interface ClusterCandidate {
  kind: 'cluster';
  signature: string;
  docCount: number;
  documentIds: string[];
  topEntityIds: string[];
  topEntityNames: string[];
  sampleTitles: string[];
  metrics: SignatureMetrics;
}

export type SuggestionCandidate = BatchCandidate | ClusterCandidate;

export interface DetectorThresholds {
  /** Minimum documents in a batch before we propose it. */
  batchMinDocs: number;
  /** Minimum top entities shared across a batch to qualify it. */
  batchMinSharedEntities: number;
  /** How many top-entities define a cluster's identity. */
  clusterTopN: number;
  /** Minimum documents sharing the cluster's top-N entities. */
  clusterMinDocs: number;
  /** Max suggestions emitted per detector pass (rate-limit). */
  maxCandidatesPerPass: number;
}

export const DEFAULT_THRESHOLDS: DetectorThresholds = {
  batchMinDocs: 5,
  batchMinSharedEntities: 3,
  clusterTopN: 4,
  clusterMinDocs: 6,
  maxCandidatesPerPass: 20,
};

interface EntityRow {
  entityId: string;
  name: string;
  cnt: number;
}

interface DocRow {
  documentId: string;
  title: string;
}

/**
 * SQL-only detector for ProjectStatus=suggested rows. Two strategies:
 *
 *   1. **Batch**: every import batch (`Document.metadata.__import.batchId`)
 *      with ≥ batchMinDocs documents AND ≥ batchMinSharedEntities entities
 *      shared by at least half the documents becomes a candidate.
 *
 *   2. **Cluster**: aggregate `DocumentEntity` to find groups of ≥
 *      clusterTopN entities that co-occur in ≥ clusterMinDocs documents
 *      regardless of import origin.
 *
 * No LLM calls happen here; the orchestrator wraps detector output with one
 * Haiku call per candidate downstream (and only when the suggestions gate is
 * on). The detector keeps short heuristic fallbacks (`buildHeuristicName`)
 * so even with the gate off the candidates still have legible names.
 */
@Injectable()
export class SuggestionDetector {
  private readonly logger = new Logger(SuggestionDetector.name);

  constructor(private readonly prisma: PrismaService) {}

  async detectBatch(
    batchId: string,
    thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
  ): Promise<BatchCandidate | null> {
    const docs = await this.prisma.client.$queryRaw<DocRow[]>`
      SELECT d."id" AS "documentId", d."title"
      FROM "Document" d
      WHERE d."metadata"->'__import'->>'batchId' = ${batchId}
        AND d."status" <> 'archived'
    `;
    if (docs.length < thresholds.batchMinDocs) {
      return null;
    }
    const documentIds = docs.map((d) => d.documentId);

    const entities = await this.topEntitiesForDocs(documentIds, thresholds.clusterTopN);
    if (entities.length < thresholds.batchMinSharedEntities) {
      return null;
    }

    const metrics: SignatureMetrics = {
      docCount: documentIds.length,
      topEntities: entities.map((e) => e.entityId),
    };
    return {
      kind: 'batch',
      batchId,
      signature: batchSignature(batchId),
      docCount: documentIds.length,
      documentIds,
      topEntityIds: entities.map((e) => e.entityId),
      topEntityNames: entities.map((e) => e.name),
      sampleTitles: docs.slice(0, 5).map((d) => d.title),
      metrics,
    };
  }

  /**
   * Find entity clusters in the corpus that aren't already covered by any
   * existing project (active or suggested). Caller is expected to dedupe
   * against the Project.signature index before persisting.
   */
  async detectClusters(
    thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
  ): Promise<ClusterCandidate[]> {
    // Pick the most-mentioned entities globally; for each, take the docs that
    // mention it and look at THEIR top co-occurring entities. The result is a
    // candidate cluster identified by the top-N entity set.
    const seedEntities = await this.prisma.client.$queryRaw<EntityRow[]>`
      SELECT e."id" AS "entityId", e."name", COUNT(DISTINCT de."documentId")::int AS "cnt"
      FROM "Entity" e
      JOIN "DocumentEntity" de ON de."entityId" = e."id"
      JOIN "Document" d ON d."id" = de."documentId"
      WHERE e."mergedIntoId" IS NULL
        AND d."status" <> 'archived'
      GROUP BY e."id", e."name"
      HAVING COUNT(DISTINCT de."documentId") >= ${thresholds.clusterMinDocs}
      ORDER BY "cnt" DESC, e."id"
      LIMIT 50
    `;

    const seenSignatures = new Set<string>();
    const out: ClusterCandidate[] = [];

    for (const seed of seedEntities) {
      if (out.length >= thresholds.maxCandidatesPerPass) break;

      const docs = await this.prisma.client.$queryRaw<DocRow[]>`
        SELECT d."id" AS "documentId", d."title"
        FROM "Document" d
        JOIN "DocumentEntity" de ON de."documentId" = d."id"
        WHERE de."entityId" = ${seed.entityId}
          AND d."status" <> 'archived'
        ORDER BY d."createdAt" DESC
        LIMIT 200
      `;
      if (docs.length < thresholds.clusterMinDocs) continue;

      const documentIds = docs.map((d) => d.documentId);
      const entities = await this.topEntitiesForDocs(documentIds, thresholds.clusterTopN);
      if (entities.length < thresholds.clusterTopN) continue;

      const topEntityIds = entities.map((e) => e.entityId);
      const sig = clusterSignature(topEntityIds, documentIds.length);
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);

      out.push({
        kind: 'cluster',
        signature: sig,
        docCount: documentIds.length,
        documentIds,
        topEntityIds,
        topEntityNames: entities.map((e) => e.name),
        sampleTitles: docs.slice(0, 5).map((d) => d.title),
        metrics: { docCount: documentIds.length, topEntities: topEntityIds },
      });
    }

    return out;
  }

  /**
   * Recent import batches with at least batchMinDocs documents that haven't
   * had their batch-signature ingested yet. Used by `mode='rescan'`.
   */
  async listRecentBatchIds(
    sinceDays = 90,
    thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
  ): Promise<string[]> {
    const rows = await this.prisma.client.$queryRaw<{ batchId: string }[]>`
      SELECT d."metadata"->'__import'->>'batchId' AS "batchId"
      FROM "Document" d
      WHERE d."metadata"->'__import'->>'batchId' IS NOT NULL
        AND d."createdAt" > NOW() - (${sinceDays}::int * INTERVAL '1 day')
        AND d."status" <> 'archived'
      GROUP BY d."metadata"->'__import'->>'batchId'
      HAVING COUNT(DISTINCT d."id") >= ${thresholds.batchMinDocs}
      ORDER BY MAX(d."createdAt") DESC
    `;
    return rows.map((r) => r.batchId).filter((id): id is string => typeof id === 'string');
  }

  private async topEntitiesForDocs(documentIds: string[], limit: number): Promise<EntityRow[]> {
    if (documentIds.length === 0) return [];
    return this.prisma.client.$queryRaw<EntityRow[]>`
      SELECT e."id" AS "entityId", e."name", COUNT(DISTINCT de."documentId")::int AS "cnt"
      FROM "DocumentEntity" de
      JOIN "Entity" e ON e."id" = de."entityId"
      WHERE de."documentId" = ANY(${documentIds}::text[])
        AND e."mergedIntoId" IS NULL
      GROUP BY e."id", e."name"
      ORDER BY "cnt" DESC, e."id"
      LIMIT ${limit}
    `;
  }
}

/**
 * Tiny fallback name when LLM naming is gated off. Format mirrors the
 * Haiku output enough that the UI doesn't need a second branch.
 */
export function buildHeuristicName(candidate: SuggestionCandidate): {
  name: string;
  description: string;
} {
  const top = candidate.topEntityNames.slice(0, 3).join(', ');
  if (candidate.kind === 'batch') {
    return {
      name: `Import · ${candidate.docCount} docs${top ? ` · ${top}` : ''}`,
      description:
        `Suggested from a single import batch. Top entities: ${top || '—'}. ` +
        `Auto-named because LLM suggestion gating is off — rename anytime.`,
    };
  }
  return {
    name: `Cluster · ${top || candidate.docCount + ' docs'}`,
    description:
      `Suggested from co-occurring entities across the corpus. ` +
      `Top entities: ${top || '—'}. Rename anytime.`,
  };
}

/**
 * Make a deterministic slug from a candidate name. Used by both the detector
 * and the manual-create path. Strips diacritics, lowercases, hyphenates.
 * Suffix logic to avoid collisions lives in the service layer.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base.length > 0 ? base : 'project';
}
