import { readRegistryValue } from '@mnela/core';
import { ProjectRepository, SystemConfigRepository } from '@mnela/db';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Project } from '@prisma/client';

import { RedisService } from '../redis.service.js';
import {
  DEFAULT_THRESHOLDS,
  type SuggestionCandidate,
  SuggestionDetector,
  slugify,
} from './detector.js';
import { SuggestionNamer } from './naming.js';
import { isValidSignatureMetrics, shouldRevive } from './signature.js';

export interface SuggesterRunInput {
  mode: 'batch' | 'rescan';
  batchId?: string;
}

export interface SuggesterOutcome {
  status: 'ok' | 'disabled' | 'skipped' | 'budget-exhausted';
  emitted: number;
  skippedExisting: number;
  reason?: string;
  passesToday?: number;
  budget?: number;
}

const SUGGESTIONS_GATE = 'projects.suggestions.enabled';
const SUGGESTIONS_BUDGET_KEY = 'projects.suggestions.maxPassesPerDay';
const BUDGET_TTL_SECONDS = 26 * 3600; // a bit more than a UTC day; key auto-expires.

function todayUtcStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * High-level driver for the project_suggest job. Reads the master gate,
 * runs the detector for the requested scope, hits the namer once per new
 * candidate (≤ DEFAULT_THRESHOLDS.maxCandidatesPerPass per pass), and
 * persists ProjectStatus=suggested rows plus their DocumentProject links
 * (linkSource=suggested). The revival path lives here too: a dismissed
 * signature whose live metrics outgrew its snapshot ships as a new row.
 */
@Injectable()
export class ProjectsSuggesterService {
  private readonly logger = new Logger(ProjectsSuggesterService.name);

  constructor(
    private readonly detector: SuggestionDetector,
    private readonly namer: SuggestionNamer,
    private readonly projects: ProjectRepository,
    private readonly systemConfig: SystemConfigRepository,
    private readonly redis: RedisService,
  ) {}

  async run(input: SuggesterRunInput): Promise<SuggesterOutcome> {
    const enabled = await readRegistryValue<boolean>(this.systemConfig, SUGGESTIONS_GATE);
    if (!enabled) {
      return { status: 'disabled', emitted: 0, skippedExisting: 0, reason: 'gate-off' };
    }

    const budget = await readRegistryValue<number>(this.systemConfig, SUGGESTIONS_BUDGET_KEY);
    /*
     * Per-day pass budget. INCR returns the new count atomically; only
     * the first INCR of the UTC day needs the EXPIRE call. We over-shoot
     * the TTL by 2 h so the key always covers the full day even if the
     * server clock drifts slightly past midnight.
     */
    const stamp = todayUtcStamp();
    const counterKey = `mnela:suggester:passes:${stamp}`;
    const passesToday = await this.redis.client.incr(counterKey);
    if (passesToday === 1) {
      await this.redis.client.expire(counterKey, BUDGET_TTL_SECONDS);
    }
    if (passesToday > budget) {
      this.logger.warn(
        `suggester budget exhausted (${passesToday}/${budget}); skipping pass until ${stamp} rolls over`,
      );
      return {
        status: 'budget-exhausted',
        emitted: 0,
        skippedExisting: 0,
        reason: 'budget-exhausted',
        passesToday,
        budget,
      };
    }

    const candidates =
      input.mode === 'batch'
        ? await this.collectBatchCandidates(input.batchId)
        : await this.collectRescanCandidates();

    if (candidates.length === 0) {
      return { status: 'skipped', emitted: 0, skippedExisting: 0, reason: 'no-candidates' };
    }

    const signatures = candidates.map((c) => c.signature);
    const existing = await this.projects.findBySignatures(signatures);
    const existingBySig = new Map(existing.map((p) => [p.signature ?? '', p]));

    let emitted = 0;
    let skippedExisting = 0;
    for (const candidate of candidates) {
      const prev = existingBySig.get(candidate.signature);
      if (prev && !this.shouldReplaceExisting(prev, candidate)) {
        skippedExisting += 1;
        continue;
      }
      try {
        await this.persistCandidate(candidate);
        emitted += 1;
      } catch (err) {
        this.logger.warn(
          `failed to persist suggestion ${candidate.signature}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { status: 'ok', emitted, skippedExisting, passesToday, budget };
  }

  private async collectBatchCandidates(batchId?: string): Promise<SuggestionCandidate[]> {
    if (!batchId) return [];
    const candidate = await this.detector.detectBatch(batchId, DEFAULT_THRESHOLDS);
    return candidate ? [candidate] : [];
  }

  private async collectRescanCandidates(): Promise<SuggestionCandidate[]> {
    const out: SuggestionCandidate[] = [];

    const batchIds = await this.detector.listRecentBatchIds(90, DEFAULT_THRESHOLDS);
    for (const batchId of batchIds.slice(0, DEFAULT_THRESHOLDS.maxCandidatesPerPass)) {
      const b = await this.detector.detectBatch(batchId, DEFAULT_THRESHOLDS);
      if (b) out.push(b);
    }

    const clusters = await this.detector.detectClusters(DEFAULT_THRESHOLDS);
    out.push(...clusters);

    return out.slice(0, DEFAULT_THRESHOLDS.maxCandidatesPerPass);
  }

  private shouldReplaceExisting(prev: Project, candidate: SuggestionCandidate): boolean {
    if (prev.status === 'active') {
      // User already accepted this; never auto-mutate.
      return false;
    }
    if (prev.status === 'suggested') {
      // Open suggestion exists; skip until the user acts on it.
      return false;
    }
    // status === 'dismissed' — check revival against the snapshot.
    if (!isValidSignatureMetrics(prev.signatureMetrics)) return false;
    return shouldRevive(prev.signatureMetrics, candidate.metrics);
  }

  private async persistCandidate(candidate: SuggestionCandidate): Promise<void> {
    const named = await this.namer.nameCandidate(candidate);
    const slug = await this.allocateSlug(named.name);

    const created = await this.projects.create({
      slug,
      name: named.name,
      description: named.description,
      status: 'suggested',
      source: candidate.kind === 'batch' ? 'suggested_batch' : 'suggested_cluster',
      autoFill: false,
      signature: candidate.signature,
      signatureMetrics: {
        docCount: candidate.metrics.docCount,
        topEntities: candidate.metrics.topEntities,
      } as Prisma.InputJsonValue,
      batchId: candidate.kind === 'batch' ? candidate.batchId : null,
      metadata: {
        topEntityNames: candidate.topEntityNames,
        namedByLlm: named.fromLlm,
      } as Prisma.InputJsonValue,
    });

    await this.projects.linkDocuments(created.id, candidate.documentIds, 'suggested');
    this.logger.log(
      `suggested project ${created.slug} (sig=${candidate.signature}, docs=${candidate.docCount}, llm=${named.fromLlm})`,
    );
  }

  /**
   * Allocate a unique slug. Append `-2`, `-3`, … until one sticks. Capped at
   * 12 attempts because beyond that the input name was probably empty.
   */
  private async allocateSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let i = 1; i <= 12; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      const existing = await this.projects.findBySlug(candidate);
      if (!existing) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
