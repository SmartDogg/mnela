import { PrismaService, ProjectRepository } from '@mnela/db';
import { Injectable, Logger } from '@nestjs/common';

import { SearchBridge } from '../search-bridge.js';

export interface AutofillOutcome {
  status: 'ok' | 'skipped';
  linked: number;
  reason?: string;
}

/** Cap candidates per autofill pass — keeps runtime predictable on huge corpora. */
const MAX_AUTOFILL_LINKS = 100;

/**
 * Project_autofill driver. Given a manual project flagged `autoFill=true`,
 * resolve candidate documents via:
 *   1. Full-text / similarity search over name + description (SearchBridge)
 *   2. Entity-name match: any Entity whose `name` (normalised) appears in the
 *      description gets its top documents pulled in.
 *
 * Both sources are union'd and the top `MAX_AUTOFILL_LINKS` are linked with
 * linkSource=autoFill. Idempotent: re-running on the same project doesn't
 * duplicate links (DocumentProject is keyed on (documentId, projectId)).
 */
@Injectable()
export class ProjectsAutofillService {
  private readonly logger = new Logger(ProjectsAutofillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectRepository,
    private readonly search: SearchBridge,
  ) {}

  async run(projectId: string): Promise<AutofillOutcome> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      return { status: 'skipped', linked: 0, reason: 'project-not-found' };
    }
    if (!project.autoFill) {
      return { status: 'skipped', linked: 0, reason: 'autofill-disabled' };
    }

    const seedText = `${project.name}\n${project.description ?? ''}`.trim();
    if (seedText.length === 0) {
      return { status: 'skipped', linked: 0, reason: 'empty-seed' };
    }

    const ids = new Set<string>();
    try {
      const hits = await this.search.findSimilar(seedText, MAX_AUTOFILL_LINKS);
      for (const h of hits) ids.add(h.documentId);
    } catch (err) {
      this.logger.warn(
        `search bridge failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const byEntity = await this.docsByEntityMatch(seedText, MAX_AUTOFILL_LINKS);
    for (const id of byEntity) ids.add(id);

    const list = Array.from(ids).slice(0, MAX_AUTOFILL_LINKS);
    if (list.length === 0) {
      return { status: 'ok', linked: 0 };
    }

    const linked = await this.projects.linkDocuments(project.id, list, 'autoFill');
    this.logger.log(`autofilled project ${project.slug}: linked=${linked}/${list.length}`);
    return { status: 'ok', linked };
  }

  /**
   * Pull a few candidate documents by entity-name match: any Entity whose
   * `name` appears in the seed text contributes its top documents (most
   * recent). Skips merged-into entities. Bounded at 50 entities × 5 docs.
   */
  private async docsByEntityMatch(seedText: string, limit: number): Promise<string[]> {
    const normalised = seedText.toLowerCase();
    const entities = await this.prisma.client.entity.findMany({
      where: {
        mergedIntoId: null,
        name: { not: '' },
      },
      take: 500,
      select: { id: true, name: true },
    });
    const hits: string[] = [];
    const seen = new Set<string>();
    for (const e of entities) {
      if (hits.length >= limit) break;
      const needle = e.name.toLowerCase();
      if (needle.length < 3) continue;
      if (!normalised.includes(needle)) continue;
      const docs = await this.prisma.client.documentEntity.findMany({
        where: { entityId: e.id },
        select: { documentId: true },
        take: 5,
        orderBy: { document: { createdAt: 'desc' } },
      });
      for (const d of docs) {
        if (seen.has(d.documentId)) continue;
        seen.add(d.documentId);
        hits.push(d.documentId);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }
}
