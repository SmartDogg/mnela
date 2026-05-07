import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EdgeRepository,
  EntityRepository,
  type InboxListFilters,
  InboxRepository,
} from '@mnela/db';
import type { InboxItem, LinkStatus, Prisma } from '@prisma/client';

import type { Principal } from '../../auth/types.js';

interface LinkSuggestionPayload {
  fromId: string;
  toId: string;
  relationType: string;
  confidence?: number;
  evidenceDocumentId?: string;
}

interface MergeSuggestionPayload {
  sourceId: string;
  targetId: string;
}

@Injectable()
export class InboxService {
  constructor(
    private readonly inbox: InboxRepository,
    private readonly edges: EdgeRepository,
    private readonly entities: EntityRepository,
  ) {}

  list(filters: InboxListFilters, page?: number, limit?: number) {
    return this.inbox.list(filters, { page, limit });
  }

  async findById(id: string): Promise<InboxItem> {
    const item = await this.inbox.findById(id);
    if (!item) throw new NotFoundException(`Inbox item ${id} not found`);
    return item;
  }

  async accept(
    id: string,
    principal: Principal | undefined,
  ): Promise<{ item: InboxItem; sideEffect: unknown }> {
    const item = await this.findById(id);
    if (item.status !== 'pending') {
      throw new BadRequestException(`Inbox item ${id} is already ${item.status}`);
    }
    const sideEffect = await this.applyPayload(item);
    const resolved = await this.inbox.resolve(id, 'accepted', formatActor(principal));
    return { item: resolved, sideEffect };
  }

  async reject(id: string, principal: Principal | undefined): Promise<InboxItem> {
    const item = await this.findById(id);
    if (item.status !== 'pending') {
      throw new BadRequestException(`Inbox item ${id} is already ${item.status}`);
    }
    return this.inbox.resolve(id, 'rejected', formatActor(principal));
  }

  async edit(
    id: string,
    payload: Record<string, unknown>,
    principal: Principal | undefined,
  ): Promise<{ item: InboxItem; sideEffect: unknown }> {
    const item = await this.findById(id);
    if (item.status !== 'pending') {
      throw new BadRequestException(`Inbox item ${id} is already ${item.status}`);
    }
    const updated = await this.inbox.updatePayload(id, payload as Prisma.InputJsonValue);
    return this.accept(updated.id, principal);
  }

  private async applyPayload(item: InboxItem): Promise<unknown> {
    const payload = item.payload as unknown as Record<string, unknown>;
    switch (item.type) {
      case 'link_suggestion': {
        const p = payload as unknown as LinkSuggestionPayload;
        if (!p.fromId || !p.toId || !p.relationType) {
          throw new BadRequestException(
            'link_suggestion payload requires fromId, toId, relationType',
          );
        }
        return this.edges.create({
          fromId: p.fromId,
          toId: p.toId,
          relationType: p.relationType,
          confidence: typeof p.confidence === 'number' ? p.confidence : 1,
          status: 'manual' as LinkStatus,
          ...(p.evidenceDocumentId ? { evidenceDocumentId: p.evidenceDocumentId } : {}),
        });
      }
      case 'entity_merge_suggestion': {
        const p = payload as unknown as MergeSuggestionPayload;
        if (!p.sourceId || !p.targetId) {
          throw new BadRequestException(
            'entity_merge_suggestion payload requires sourceId, targetId',
          );
        }
        return this.entities.merge(p.sourceId, p.targetId);
      }
      case 'duplicate_detection':
      case 'enrichment_failed':
      case 'conflicting_decision':
        // These are reviewed-only — user marking them accepted means they acknowledged; no side effect.
        return null;
    }
  }
}

function formatActor(principal: Principal | undefined): string {
  if (!principal) return 'anonymous';
  return `${principal.kind}:${principal.name ?? principal.id}`;
}
