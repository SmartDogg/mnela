import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readRegistryValue } from '@mnela/core';
import {
  type CreateProjectInput,
  DocumentRepository,
  EntityRepository,
  JobRepository,
  ProjectRepository,
  SystemConfigRepository,
  type UpdateProjectInput,
} from '@mnela/db';
import { HybridSearchAdapter } from '@mnela/search';
import { readClaudeStatus } from '@mnela/queue';
import type { DocumentProjectLinkSource, Entity, Prisma, Project } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';

import { PrismaService } from '@mnela/db';
import { QueueService } from '../../queue/queue.service.js';
import { RedisService } from '../../redis.service.js';

export interface ProjectPreviewCandidate {
  documentId: string;
  title: string;
  score: number;
  snippet?: string;
}

export interface ProjectSuggestionSummary {
  slug: string;
  name: string;
  description: string | null;
  source: 'suggested_batch' | 'suggested_cluster';
  signature: string | null;
  docCount: number;
  topEntities: string[];
  createdAt: string;
}

const AUTO_SUGGESTIONS_GATE = 'projects.suggestions.enabled';

function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base.length > 0 ? base : `project-${randomUUID().slice(0, 8)}`;
}

/**
 * Projects domain service.
 *
 * Covers:
 *   - CRUD over Project rows (active / suggested / dismissed lifecycles)
 *   - Suggestion accept (flip status to active) / dismiss (status='dismissed'
 *     + unlink suggested rows)
 *   - Manual create with optional async autofill (linkSource=autoFill)
 *   - Synchronous candidate preview (no LLM, just embedding + entity match)
 *   - Rescan trigger (delegates to QueueService → orchestrator's projects
 *     queue)
 *   - Top-entities + document listings used by the project detail view
 *
 * Gating: every code path that would mint a new suggestion (rescan, batch
 * trigger) is checked against `projects.suggestions.enabled` upstream;
 * the autofill path is independent of that gate (manual create is always
 * available regardless of the suggestion gate).
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly search: HybridSearchAdapter;

  constructor(
    private readonly projects: ProjectRepository,
    private readonly entities: EntityRepository,
    private readonly documents: DocumentRepository,
    private readonly jobs: JobRepository,
    private readonly queue: QueueService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigRepository,
  ) {
    this.search = new HybridSearchAdapter(() => this.prisma.client);
  }

  // ---------------------------------------------------------------------
  // CRUD + lifecycle
  // ---------------------------------------------------------------------

  list(page?: number, limit?: number, status?: Project['status']) {
    return this.projects.list({ page, limit }, status ? { status } : {});
  }

  async findBySlug(slug: string): Promise<Project> {
    const p = await this.projects.findBySlug(slug);
    if (!p) throw new NotFoundException(`Project "${slug}" not found`);
    return p;
  }

  async create(input: {
    slug?: string;
    name: string;
    description?: string | null;
    status?: Project['status'];
    contextMd?: string | null;
    autoFill?: boolean;
    documentIds?: string[];
    acceptFromSlug?: string;
  }): Promise<Project> {
    if (input.acceptFromSlug) {
      return this.acceptSuggestion(input.acceptFromSlug, input);
    }

    const slug = await this.allocateSlug(input.slug ?? input.name);
    const data: CreateProjectInput = {
      slug,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? 'active',
      source: 'manual',
      autoFill: input.autoFill ?? false,
      contextMd: input.contextMd ?? null,
    };
    let project: Project;
    try {
      project = await this.projects.create(data);
    } catch (err) {
      if (err instanceof PrismaNs.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Project with slug "${slug}" already exists`);
      }
      throw err;
    }

    if (input.documentIds && input.documentIds.length > 0) {
      await this.projects.linkDocuments(project.id, input.documentIds, 'manual');
    }
    if (input.autoFill) {
      await this.queue.enqueueProjectAutofill(project.id).catch((err) => {
        this.logger.warn(
          `failed to enqueue autofill for ${project.slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    return project;
  }

  async update(slug: string, patch: UpdateProjectInput & { autoFill?: boolean }): Promise<Project> {
    const before = await this.findBySlug(slug);
    const next = await this.projects.update(slug, patch);
    // If autoFill flipped on, kick a one-shot autofill job (idempotent).
    if (patch.autoFill === true && !before.autoFill) {
      await this.queue.enqueueProjectAutofill(next.id).catch((err) => {
        this.logger.warn(
          `failed to enqueue autofill after toggle for ${next.slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    return next;
  }

  async delete(slug: string): Promise<{ slug: string; deleted: true }> {
    await this.findBySlug(slug);
    await this.projects.delete(slug);
    return { slug, deleted: true };
  }

  async dismiss(slug: string): Promise<Project> {
    const project = await this.findBySlug(slug);
    if (project.status !== 'suggested') {
      throw new BadRequestException(
        `Only suggested projects can be dismissed (slug="${slug}" is ${project.status})`,
      );
    }
    await this.projects.unlinkSuggested(project.id);
    return this.projects.updateById(project.id, { status: 'dismissed' });
  }

  /** Promote a `suggested` project to `active`. Preserves all existing links. */
  private async acceptSuggestion(
    slug: string,
    overrides: { name?: string; description?: string | null; autoFill?: boolean },
  ): Promise<Project> {
    const project = await this.findBySlug(slug);
    if (project.status !== 'suggested') {
      throw new BadRequestException(
        `acceptFromSlug expects a 'suggested' project (slug="${slug}" is ${project.status})`,
      );
    }
    const patch: UpdateProjectInput = { status: 'active' };
    if (overrides.name && overrides.name !== project.name) patch.name = overrides.name;
    if (overrides.description !== undefined) patch.description = overrides.description;
    if (overrides.autoFill !== undefined) patch.autoFill = overrides.autoFill;
    return this.projects.updateById(project.id, patch);
  }

  // ---------------------------------------------------------------------
  // Suggestions surface
  // ---------------------------------------------------------------------

  async listSuggestions(limit = 50): Promise<ProjectSuggestionSummary[]> {
    const page = await this.projects.list({ limit, page: 1 }, { status: 'suggested' });
    return Promise.all(page.items.map((p) => this.summariseSuggestion(p)));
  }

  async suggestionsEnabled(): Promise<boolean> {
    return readRegistryValue<boolean>(this.systemConfig, AUTO_SUGGESTIONS_GATE);
  }

  async enqueueRescan(): Promise<{ jobId: string; enabled: boolean }> {
    const enabled = await this.suggestionsEnabled();
    if (!enabled) {
      // Don't even create a DB job — surface the disabled state so the UI
      // can render the fallback rather than a fake "scan completed".
      return { jobId: '', enabled: false };
    }
    const res = await this.queue.enqueueProjectRescan();
    return { jobId: res.jobId, enabled: true };
  }

  private async summariseSuggestion(project: Project): Promise<ProjectSuggestionSummary> {
    const metrics =
      project.signatureMetrics &&
      typeof project.signatureMetrics === 'object' &&
      !Array.isArray(project.signatureMetrics)
        ? (project.signatureMetrics as Record<string, unknown>)
        : null;
    const meta =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? (project.metadata as Record<string, unknown>)
        : null;
    const docCount =
      typeof metrics?.['docCount'] === 'number'
        ? (metrics['docCount'] as number)
        : await this.projects.countDocuments(project.id);
    const topEntities = Array.isArray(meta?.['topEntityNames'])
      ? (meta!['topEntityNames'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    return {
      slug: project.slug,
      name: project.name,
      description: project.description,
      source: project.source === 'suggested_batch' ? 'suggested_batch' : 'suggested_cluster',
      signature: project.signature,
      docCount,
      topEntities,
      createdAt: project.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------
  // Manual create preview + linking
  // ---------------------------------------------------------------------

  /**
   * Synchronous candidate search for the /projects/new form. Returns top
   * documents matching `name + description` via the hybrid FTS adapter,
   * augmented with entity-name matches. No LLM, no background job.
   */
  async previewCandidates(
    name: string,
    description: string,
    limit = 50,
  ): Promise<ProjectPreviewCandidate[]> {
    const seedText = `${name}\n${description}`.trim();
    if (seedText.length === 0) return [];
    const ids = new Map<string, ProjectPreviewCandidate>();
    try {
      const result = await this.search.search({
        query: seedText.length > 600 ? seedText.slice(0, 600) : seedText,
        page: 1,
        limit,
      });
      for (const h of result.hits) {
        const candidate: ProjectPreviewCandidate = {
          documentId: h.documentId,
          title: h.title,
          score: h.score,
        };
        if (h.snippet) candidate.snippet = h.snippet;
        ids.set(h.documentId, candidate);
      }
    } catch (err) {
      this.logger.warn(
        `preview search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const byEntity = await this.docsByEntityMatch(seedText, limit);
    for (const doc of byEntity) {
      if (ids.has(doc.documentId)) continue;
      ids.set(doc.documentId, doc);
    }

    return Array.from(ids.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async linkDocument(
    slug: string,
    documentId: string,
    linkSource: DocumentProjectLinkSource = 'manual',
  ): Promise<{ ok: true }> {
    const project = await this.findBySlug(slug);
    await this.projects.linkDocument(project.id, documentId, linkSource);
    return { ok: true };
  }

  async unlinkDocument(slug: string, documentId: string): Promise<{ ok: true }> {
    const project = await this.findBySlug(slug);
    await this.prisma.client.documentProject
      .delete({ where: { documentId_projectId: { documentId, projectId: project.id } } })
      .catch(() => undefined);
    return { ok: true };
  }

  private async docsByEntityMatch(
    seedText: string,
    limit: number,
  ): Promise<ProjectPreviewCandidate[]> {
    const normalised = seedText.toLowerCase();
    const entities = await this.prisma.client.entity.findMany({
      where: { mergedIntoId: null, name: { not: '' } },
      take: 500,
      select: { id: true, name: true },
    });
    const hits: ProjectPreviewCandidate[] = [];
    const seen = new Set<string>();
    for (const e of entities) {
      if (hits.length >= limit) break;
      const needle = e.name.toLowerCase();
      if (needle.length < 3) continue;
      if (!normalised.includes(needle)) continue;
      const docs = await this.prisma.client.documentEntity.findMany({
        where: { entityId: e.id },
        select: { documentId: true, document: { select: { title: true } } },
        take: 5,
        orderBy: { document: { createdAt: 'desc' } },
      });
      for (const d of docs) {
        if (seen.has(d.documentId)) continue;
        seen.add(d.documentId);
        hits.push({
          documentId: d.documentId,
          title: d.document.title,
          score: 0.5,
        });
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  // ---------------------------------------------------------------------
  // Detail view helpers
  // ---------------------------------------------------------------------

  async getContext(slug: string): Promise<{ slug: string; contextMd: string | null }> {
    const p = await this.findBySlug(slug);
    return { slug: p.slug, contextMd: p.contextMd };
  }

  async listTopEntities(slug: string, limit = 50): Promise<Entity[]> {
    await this.findBySlug(slug);
    return this.entities.listTopForProject(slug, limit);
  }

  async listOpenQuestions(slug: string): Promise<string[]> {
    const project = await this.findBySlug(slug);
    const meta = project.metadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
    const value = (meta as Record<string, unknown>)['openQuestions'];
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }

  async refreshContext(slug: string): Promise<{ jobId: string }> {
    const project = await this.findBySlug(slug);
    const claude = await readClaudeStatus(this.redis.client);
    if (!claude.available) {
      throw new ServiceUnavailableException({
        title: 'AI Smart Mode disabled',
        reason: claude.reason ?? 'unknown',
        hint:
          claude.reason === 'no-binary'
            ? 'Install the Claude Code CLI on the server and run `claude login`.'
            : claude.reason === 'not-logged-in'
              ? 'Run `claude login` on the server to authenticate the orchestrator.'
              : claude.reason === 'orchestrator-not-running'
                ? 'Start the orchestrator app (or wait for the boot probe to finish).'
                : 'Claude rate limit hit — try again after the window resets.',
      });
    }
    const job = await this.jobs.create({
      type: 'refresh_project_context',
      payload: { projectSlug: project.slug, projectId: project.id },
    });
    await this.queue.enqueueEnrichment({ dbJobId: job.id, projectSlug: project.slug });
    return { jobId: job.id };
  }

  private async allocateSlug(input: string): Promise<string> {
    const base = slugify(input);
    for (let i = 1; i <= 12; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      const existing = await this.projects.findBySlug(candidate);
      if (!existing) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }
}
